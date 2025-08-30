const express = require('express');
const { body, validationResult, query } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================
// GET ALL RESOURCES WITH FILTERING & PAGINATION
// ============================================
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('grade').optional().isIn([
    'preprimary', 'grade1', 'grade2', 'grade3', 'grade4', 'grade5',
    'grade6', 'grade7', 'grade8', 'grade9', 'grade10', 'grade11', 'grade12'
  ]),
  query('subject').optional().isLength({ min: 1 }),
  query('year').optional().isInt({ min: 2020, max: 2030 }),
  query('term').optional().isIn(['1', '2', '3']),
  query('resource_type').optional().isIn([
    'lesson_plan', 'worksheet', 'assessment', 'marking_scheme', 'question_paper',
    'teaching_aid', 'mocks', 'schemes', 'curriculum_design', 'notes', 'holiday_assignment'
  ]),
  query('search').optional().isLength({ min: 1 }),
  query('school').optional().isLength({ min: 1 })
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
      is_premium,
      school
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = ['r.status = $1'];
    let queryParams = ['active'];
    let paramCount = 1;

    // Build dynamic WHERE clauses
    if (grade) {
      paramCount++;
      whereConditions.push(`r.grade = $${paramCount}`);
      queryParams.push(grade);
    }

    if (subject) {
      paramCount++;
      whereConditions.push(`r.subject = $${paramCount}`);
      queryParams.push(subject);
    }

    if (year) {
      paramCount++;
      whereConditions.push(`r.year = $${paramCount}`);
      queryParams.push(year);
    }

    if (term) {
      paramCount++;
      whereConditions.push(`r.term = $${paramCount}`);
      queryParams.push(term);
    }

    if (resource_type) {
      paramCount++;
      whereConditions.push(`r.resource_type = $${paramCount}`);
      queryParams.push(resource_type);
    }

    if (is_premium !== undefined) {
      paramCount++;
      whereConditions.push(`r.is_premium = $${paramCount}`);
      queryParams.push(is_premium === 'true');
    }

    if (search) {
      paramCount++;
      whereConditions.push(`(r.title ILIKE $${paramCount} OR r.description ILIKE $${paramCount})`);
      queryParams.push(`%${search}%`);
    }

    if (school) {
      paramCount++;
      whereConditions.push(`r.school ILIKE $${paramCount}`);
      queryParams.push(`%${school}%`);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Fetch resources with files in one query
    const resourcesQuery = `
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
              'type', rf.file_type,
              'mime_type', rf.mime_type,
              'r2_key', rf.r2_key
            ) ORDER BY rf.file_order, rf.created_at
          ) FILTER (WHERE rf.id IS NOT NULL AND rf.is_active = true), 
          '[]'::json
        ) as files
      FROM resources r
      LEFT JOIN resource_files rf ON r.id = rf.resource_id AND rf.is_active = true
      LEFT JOIN users u ON r.uploaded_by = u.id
      ${whereClause}
      GROUP BY r.id, u.full_name
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

// ============================================
// GET SINGLE RESOURCE BY ID
// ============================================
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
              'type', rf.file_type,
              'mime_type', rf.mime_type,
              'r2_key', rf.r2_key
            ) ORDER BY rf.file_order
          ) FILTER (WHERE rf.id IS NOT NULL AND rf.is_active = true), 
          '[]'::json
        ) as files
      FROM resources r
      LEFT JOIN resource_files rf ON r.id = rf.resource_id AND rf.is_active = true
      LEFT JOIN users u ON r.uploaded_by = u.id
      WHERE r.id = $1 AND r.status = 'active'
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

// ============================================
// CREATE NEW RESOURCE (FILLS 2 TABLES)
// ============================================
router.post('/', authenticateToken, requireRole(['staff', 'admin']), [
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
      school,
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

    await db.query('BEGIN');

    try {
      // Calculate file statistics
      const fileCount = files.length;
      const totalFileSize = files.reduce((sum, file) => sum + (file.size || 0), 0);

      // Insert into resources table
      const resourceResult = await db.query(`
        INSERT INTO resources (
          school, title, description, subject, grade, year, term, 
          resource_type, is_premium, uploaded_by, file_count, total_file_size
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [school, title, description, subject, grade, year, term, resource_type, is_premium, req.user.id, fileCount, totalFileSize]);

      const resource = resourceResult.rows[0];

      // Insert into resource_files table
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await db.query(`
          INSERT INTO resource_files (
            resource_id, file_name, file_url, file_size, file_type, 
            mime_type, r2_key, r2_bucket, file_order
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          resource.id,
          file.name,
          file.url,
          file.size,
          file.type || 'main_file',
          file.mime_type || 'application/pdf',
          file.key,
          'elimufiti-resources',
          i + 1
        ]);
      }

      await db.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Resource created successfully',
        data: resource,
        tables_filled: {
          resources: 1,
          resource_files: files.length
        }
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

// ============================================
// TRACK DOWNLOAD (FILLS 1 TABLE + UPDATES 1 TABLE)
// ============================================
router.post('/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const resourceResult = await db.query(
      'SELECT * FROM resources WHERE id = $1 AND status = $2',
      [id, 'active']
    );

    if (resourceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found'
      });
    }

    const resource = resourceResult.rows[0];

    if (resource.is_premium && req.user.subscription_status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Premium subscription required to download this resource'
      });
    }

    await db.query('BEGIN');

    try {
      await db.query(`
        INSERT INTO downloads (user_id, resource_id, download_ip, user_agent)
        VALUES ($1, $2, $3, $4)
      `, [req.user.id, id, req.ip, req.get('User-Agent')]);

      await db.query(`
        UPDATE resources 
        SET download_count = download_count + 1 
        WHERE id = $1
      `, [id]);

      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'Download recorded successfully',
        tables_affected: {
          downloads: 'inserted 1 row',
          resources: 'updated download_count'
        }
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Download resource error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record download'
    });
  }
});

// ============================================
// UPDATE RESOURCE (STAFF / ADMIN)
// ============================================
router.put('/:id', authenticateToken, requireRole(['staff', 'admin']), [
  body('school').optional().trim().isLength({ min: 5, max: 500 }),
  body('title').optional().trim().isLength({ min: 5, max: 500 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('subject').optional().isLength({ min: 1 }),
  body('is_premium').optional().isBoolean()
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

    const { id } = req.params;
    const updates = req.body;

    const updateFields = [];
    const values = [];
    let paramCount = 0;

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        paramCount++;
        updateFields.push(`${key} = $${paramCount}`);
        values.push(updates[key]);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    values.push(id);
    const query = `
      UPDATE resources 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount + 1} AND status = 'active'
      RETURNING *
    `;

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found'
      });
    }

    res.json({
      success: true,
      message: 'Resource updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update resource error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update resource'
    });
  }
});

// ============================================
// DELETE RESOURCE (SOFT DELETE)
// ============================================
router.delete('/:id', authenticateToken, requireRole(['staff', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      UPDATE resources 
      SET status = 'inactive', updated_at = NOW()
      WHERE id = $1 AND status = 'active'
      RETURNING id, title
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found'
      });
    }

    res.json({
      success: true,
      message: 'Resource deleted successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Delete resource error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete resource'
    });
  }
});

module.exports = router;
