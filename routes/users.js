const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, email, full_name, role, school_name, 
        subscription_status, created_at, last_login,
        (SELECT COUNT(*) FROM downloads WHERE user_id = $1) as download_count
      FROM users 
      WHERE id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, [
  body('full_name').optional().trim().isLength({ min: 2 }),
  body('school_name').optional().trim().isLength({ max: 100 })
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

    const { full_name, school_name } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (full_name !== undefined) {
      paramCount++;
      updates.push(`full_name = $${paramCount}`);
      values.push(full_name);
    }

    if (school_name !== undefined) {
      paramCount++;
      updates.push(`school_name = $${paramCount}`);
      values.push(school_name);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    values.push(req.user.id);
    const query = `
      UPDATE users 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount + 1}
      RETURNING id, email, full_name, role, school_name, subscription_status
    `;

    const result = await db.query(query, values);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// Get user download history
router.get('/downloads', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(`
      SELECT 
        d.downloaded_at,
        r.id, r.title, r.subject, r.grade, r.resource_type
      FROM downloads d
      JOIN resources r ON d.resource_id = r.id
      WHERE d.user_id = $1
      ORDER BY d.downloaded_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    const countResult = await db.query(
      'SELECT COUNT(*) FROM downloads WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        downloads: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count),
          pages: Math.ceil(countResult.rows[0].count / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get downloads error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch download history'
    });
  }
});

// Admin: Get all users
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { page = 1, limit = 50, role, subscription_status } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = [];
    let queryParams = [];
    let paramCount = 0;

    if (role) {
      paramCount++;
      whereConditions.push(`role = $${paramCount}`);
      queryParams.push(role);
    }

    if (subscription_status) {
      paramCount++;
      whereConditions.push(`subscription_status = $${paramCount}`);
      queryParams.push(subscription_status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT 
        id, email, full_name, role, school_name, 
        subscription_status, created_at, last_login,
        (SELECT COUNT(*) FROM downloads WHERE user_id = users.id) as download_count
      FROM users 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, limit, offset]);

    const countResult = await db.query(`
      SELECT COUNT(*) FROM users ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        users: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count),
          pages: Math.ceil(countResult.rows[0].count / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// Admin: Update user subscription status
router.put('/:id/subscription', authenticateToken, requireRole(['admin']), [
  body('subscription_status').isIn(['active', 'inactive', 'pending'])
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
    const { subscription_status } = req.body;

    const result = await db.query(`
      UPDATE users 
      SET subscription_status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, email, full_name, subscription_status
    `, [subscription_status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User subscription status updated',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subscription status'
    });
  }
});

module.exports = router;