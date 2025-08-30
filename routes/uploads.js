const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
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

// Upload resource (files + metadata)
router.post(
  '/files',
  authenticateToken,
  requireRole(['staff', 'admin']),
  upload.array('files', 10),
  [
    body('school').trim().isLength({ min: 1 }).withMessage('School is required'),
    body('title').trim().isLength({ min: 5, max: 500 }),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('subject').isLength({ min: 1 }),
    body('grade').isIn([
      'preprimary', 'grade1', 'grade2', 'grade3', 'grade4', 'grade5',
      'grade6', 'grade7', 'grade8', 'grade9', 'grade10', 'grade11', 'grade12'
    ]),
    body('year').isInt({ min: 2020, max: 2030 }),
    body('term').isIn(['1', '2', '3']),
    body('resource_type').isIn([
      'lesson_plan', 'worksheet', 'assessment', 'marking_scheme', 'question_paper',
      'teaching_aid', 'mocks', 'schemes', 'curriculum_design', 'notes', 'holiday_assignment'
    ]),
    body('is_premium').isBoolean()
  ],
  async (req, res) => {
    try {
      // Check validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'No files uploaded' });
      }

      const {
        school,
        title,
        description,
        subject,
        grade,
        year,
        term,
        resource_type,
        is_premium
      } = req.body;

      await db.query('BEGIN');

      try {
        // Upload all files to R2
        const uploadPromises = req.files.map(async (file) => {
          const timestamp = Date.now();
          const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
          const key = `resources/${timestamp}-${sanitizedName}`;

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

          return {
            name: file.originalname,
            size: file.size,
            type: 'main_file',
            key: key,
            mime_type: file.mimetype,
            r2_key: key
          };
        });

        const uploadedFiles = await Promise.all(uploadPromises);

        // Insert into resources
        const fileCount = uploadedFiles.length;
        const totalFileSize = uploadedFiles.reduce((sum, f) => sum + (f.size || 0), 0);

        const resourceResult = await db.query(`
          INSERT INTO resources (
            school, title, description, subject, grade, year, term, 
            resource_type, is_premium, uploaded_by, file_count, total_file_size
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          RETURNING *
        `, [school, title, description, subject, grade, year, term, resource_type, is_premium, req.user.id, fileCount, totalFileSize]);

        const resource = resourceResult.rows[0];

        // Insert each file into resource_files
        for (let i = 0; i < uploadedFiles.length; i++) {
          const file = uploadedFiles[i];
          await db.query(`
            INSERT INTO resource_files (
              resource_id, file_name, file_size, file_type, mime_type, 
              r2_key, r2_bucket, file_order
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `, [
            resource.id,
            file.name,
            file.size,
            file.type,
            file.mime_type,
            file.key,
            process.env.R2_BUCKET_NAME,
            i + 1
          ]);
        }

        await db.query('COMMIT');

        res.status(201).json({
          success: true,
          message: 'Resource created successfully',
          data: {
            resource,
            files: uploadedFiles
          }
        });

      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    } catch (error) {
      console.error('Upload + DB error:', error);
      res.status(500).json({ success: false, message: 'Failed to create resource', error: error.message });
    }
  }
);

// Delete file from R2 + DB
router.delete(
  '/files/:key(*)',
  authenticateToken,
  requireRole(['staff', 'admin']),
  async (req, res) => {
    try {
      const { key } = req.params;

      await r2.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key
      }));

      await db.query(
        'UPDATE resource_files SET is_active = false WHERE r2_key = $1',
        [key]
      );

      res.json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
      console.error('File deletion error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete file', error: error.message });
    }
  }
);

module.exports = router;
