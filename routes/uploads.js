const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// Configure S3 client for Cloudflare R2
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

// Configure multer (store files in memory)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only PDF, DOC, DOCX, PPT, and PPTX files are allowed.'));
  }
});

// Upload files to R2
router.post(
  '/files',
  authenticateToken,
  requireRole(['staff', 'admin']),
  upload.array('files', 10),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'No files uploaded' 
        });
      }

      const uploadPromises = req.files.map(async (file) => {
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `resources/${timestamp}-${sanitizedName}`;

        // Upload to R2
        await r2.send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
            Metadata: {
              'original-name': file.originalname,
              'uploaded-by': req.user.id,
              'upload-timestamp': timestamp.toString()
            }
          })
        );

        // Construct public URL
       // const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

        return {
          name: file.originalname,
          //url: publicUrl,
          size: file.size,
          type: 'main_file',
          key: key,
          mime_type: file.mimetype,
          r2_key: key
        };
      });

      const uploadedFiles = await Promise.all(uploadPromises);

      res.json({
        success: true,
        message: 'Files uploaded successfully',
        data: uploadedFiles
      });
    } catch (error) {
      console.error('File upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload files',
        error: error.message
      });
    }
  }
);

// Delete file from R2
router.delete(
  '/files/:key(*)',
  authenticateToken,
  requireRole(['staff', 'admin']),
  async (req, res) => {
    try {
      const { key } = req.params;

      // Delete from R2
      await r2.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key
        })
      );

      // Also remove from database if it exists
      try {
        await db.query(
          'UPDATE resource_files SET is_active = false WHERE r2_key = $1',
          [key]
        );
      } catch (dbError) {
        console.warn('Could not update database record:', dbError.message);
      }

      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } catch (error) {
      console.error('File deletion error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete file',
        error: error.message
      });
    }
  }
);

// Get file info (for verification)
router.get(
  '/files/:key(*)/info',
  authenticateToken,
  async (req, res) => {
    try {
      const { key } = req.params;

      // Check if file exists in database
      const result = await db.query(
        'SELECT * FROM resource_files WHERE r2_key = $1 AND is_active = true',
        [key]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'File not found'
        });
      }

      res.json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Get file info error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get file info'
      });
    }
  }
);

module.exports = router;