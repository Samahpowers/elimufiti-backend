const express = require('express');
const { body, validationResult, query } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all resources with filtering
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('grade').optional().isIn(['preprimary', 'grade1', 'grade2', 'grade3', 'grade4', 'grade5', 'grade6', 'grade7', 'grade8', 'grade9', 'grade10', 'grade11', 'grade12']),
  query('subject').optional().isLength({ min: 1 }),
  query('year').optional().isInt({ min: 2020, max: 2030 }),
  query('term').optional().isIn(['1', '2', '3']),
  query('resource_type').optional().isIn(['lesson_plan', 'worksheet', 'assessment', 'marking_scheme', 'question_paper', 'teaching_aid', 'mocks', 'schemes', 'curriculum_design', 'notes', 'holiday_assignment']),
  query('search').optional().isLength({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const {
      page = 1,
      limit = 20,
      grade,
      subject,
      year,
      term,
      resource_type,
      search,
      is_premium
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 0;

    // Build WHERE conditions
    if (grade) {
      paramCount++;
      whereConditions.push(`grade = $${paramCount}`);
      queryParams.push(grade);
    }

    if (subject) {
      paramCount++;
      whereConditions.push(`subject = $${paramCount}`);
      queryParams.push(subject);
    }

    if (year) {
      paramCount++;
      whereConditions.push(`year = $${paramCount}`);
      queryParams.push(year);
    }

    if (term) {
      paramCount++;
      whereConditions.push(`term = $${paramCount}`);
      queryParams.push(term);
    }

    if (resource_type) {
      paramCount++;
      whereConditions.push(`resource_type = $${paramCount}`);
      queryParams.push(resource_type);
    }

    if (is_premium !== undefined) {
      paramCount++;
      whereConditions.push(`is_premium = $${paramCount}`);
      queryParams.push(is_premium === 'true');
    }

    if (search) {
      paramCount++;
      whereConditions.push(`(title ILIKE $${paramCount} OR description ILIKE $${paramCount})`);
      queryParams.push(`%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get resources with files
    const resourcesQuery = `
      SELECT 
        r.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', rf.id,
              'name', rf.file_name,
              'url', rf.file_url,
              'size', rf.file_size,
              'type', rf.file_type
            )
          ) FILTER (WHERE rf.id IS NOT NULL), 
          '[]'
        ) as files
      FROM resources r
      LEFT JOIN resource_files rf ON r.id = rf.resource_id
      ${whereClause}
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(limit, offset);

    const result = await db.query(resourcesQuery, queryParams);

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) FROM resources r ${whereClause}`;
    const countResult = await db.query(countQuery, queryParams.slice(0, -2));
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: {
        resources: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get resources error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch resources'
    });
  }
});

// Get single resource
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT 
        r.*,
        u.full_name as uploaded_by_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', rf.id,
              'name', rf.file_name,
              'url', rf.file_url,
              'size', rf.file_size,
              'type', rf.file_type
            )
          ) FILTER (WHERE rf.id IS NOT NULL), 
          '[]'
        ) as files
      FROM resources r
      LEFT JOIN resource_files rf ON r.id = rf.resource_id
      LEFT JOIN users u ON r.uploaded_by = u.id
      WHERE r.id = $1
      GROUP BY r.id, u.full_name
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get resource error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch resource'
    });
  }
});

// Create new resource (staff/admin only)
router.post('/', authenticateToken, requireRole(['staff', 'admin']), [
  body('title').trim().isLength({ min: 5, max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('subject').isLength({ min: 1 }),
  body('grade').isIn(['preprimary', 'grade1', 'grade2', 'grade3', 'grade4', 'grade5', 'grade6', 'grade7', 'grade8', 'grade9', 'grade10', 'grade11', 'grade12']),
  body('year').isInt({ min: 2020, max: 2030 }),
  body('term').isIn(['1', '2', '3']),
  body('resource_type').isIn(['lesson_plan', 'worksheet', 'assessment', 'marking_scheme', 'question_paper', 'teaching_aid', 'mocks', 'schemes', 'curriculum_design', 'notes', 'holiday_assignment']),
  body('is_premium').isBoolean(),
  body('files').isArray({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const {
      title,
      description,
      subject,
      grade,
      year,
      term,
      resource_type,
      is_premium,
      files
    } = req.body;

    // Start transaction
    await db.query('BEGIN');

    try {
      // Insert resource
      const resourceResult = await db.query(`
        INSERT INTO resources (
          title, description, subject, grade, year, term, 
          resource_type, is_premium, uploaded_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [title, description, subject, grade, year, term, resource_type, is_premium, req.user.id]);

      const resource = resourceResult.rows[0];

      // Insert files
      for (const file of files) {
        await db.query(`
          INSERT INTO resource_files (
            resource_id, file_name, file_url, file_size, file_type
          )
          VALUES ($1, $2, $3, $4, $5)
        `, [resource.id, file.name, file.url, file.size, file.type]);
      }

      await db.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Resource created successfully',
        data: resource
      });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Create resource error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create resource'
    });
  }
});

// Download resource (track downloads)
router.post('/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get resource
    const resourceResult = await db.query(
      'SELECT * FROM resources WHERE id = $1',
      [id]
    );

    if (resourceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found'
      });
    }

    const resource = resourceResult.rows[0];

    // Check if user can download premium resources
    if (resource.is_premium && req.user.subscription_status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Premium subscription required to download this resource'
      });
    }

    // Record download
    await db.query(`
      INSERT INTO downloads (user_id, resource_id)
      VALUES ($1, $2)
    `, [req.user.id, id]);

    // Update download count
    await db.query(`
      UPDATE resources 
      SET download_count = download_count + 1 
      WHERE id = $1
    `, [id]);

    res.json({
      success: true,
      message: 'Download recorded successfully'
    });
  } catch (error) {
    console.error('Download resource error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record download'
    });
  }
});

module.exports = router;