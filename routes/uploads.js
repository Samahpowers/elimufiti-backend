const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { authenticateToken, requireRole } = require('../middleware/auth');

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
    else cb(new Error('Invalid file type.'));
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
        return res.status(400).json({ success: false, message: 'No files uploaded' });
      }

      const uploadPromises = req.files.map(async (file) => {
        const key = `resources/${Date.now()}-${file.originalname}`;

        await r2.send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
          })
        );

        return {
          name: file.originalname,
          url: `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${key}`,
          size: file.size,
          type: 'main_file',
          key
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
  '/files/:key',
  authenticateToken,
  requireRole(['staff', 'admin']),
  async (req, res) => {
    try {
      const { key } = req.params;

      await r2.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key
        })
      );

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

module.exports = router;
