const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get subscription plans
router.get('/plans', async (req, res) => {
  try {
    const plans = [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        currency: 'KSH',
        interval: 'lifetime',
        features: [
          'Access to basic resources',
          'Limited downloads (5 per month)',
          'Community support',
          'Basic search filters'
        ],
        limitations: [
          'No premium resources',
          'Limited download quota',
          'No priority support'
        ]
      },
      {
        id: 'basic',
        name: 'Basic',
        price: 500,
        currency: 'KSH',
        interval: 'month',
        features: [
          'Access to all basic resources',
          'Unlimited downloads',
          'Email support',
          'Advanced search filters',
          'Resource bookmarking'
        ]
      },
      {
        id: 'premium',
        name: 'Premium',
        price: 1200,
        currency: 'KSH',
        interval: 'month',
        features: [
          'Access to ALL resources',
          'Premium exclusive content',
          'Priority support',
          'Bulk download options',
          'Custom resource requests',
          'Early access to new materials'
        ],
        popular: true
      },
      {
        id: 'institution',
        name: 'Institution',
        price: 5000,
        currency: 'KSH',
        interval: 'month',
        features: [
          'Everything in Premium',
          'Multi-user access (up to 50 users)',
          'Institution branding',
          'Dedicated account manager',
          'Custom integrations',
          'Training sessions',
          'Analytics dashboard'
        ]
      }
    ];

    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans'
    });
  }
});

// Get user's current subscription
router.get('/current', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        s.*,
        u.subscription_status
      FROM subscriptions s
      RIGHT JOIN users u ON s.user_id = u.id
      WHERE u.id = $1
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [req.user.id]);

    const subscription = result.rows[0] || {
      plan: 'free',
      status: req.user.subscription_status || 'inactive',
      user_id: req.user.id
    };

    res.json({
      success: true,
      data: subscription
    });
  } catch (error) {
    console.error('Get current subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch current subscription'
    });
  }
});

// Create subscription (after successful payment)
router.post('/', authenticateToken, [
  body('plan').isIn(['basic', 'premium', 'institution']),
  body('payment_id').isLength({ min: 1 })
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

    const { plan, payment_id } = req.body;

    // Verify payment exists and is successful
    const paymentResult = await db.query(
      'SELECT * FROM payments WHERE id = $1 AND user_id = $2 AND status = $3',
      [payment_id, req.user.id, 'completed']
    );

    if (paymentResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment required'
      });
    }

    const payment = paymentResult.rows[0];

    // Calculate subscription dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1); // 1 month subscription

    // Start transaction
    await db.query('BEGIN');

    try {
      // Create subscription
      const subscriptionResult = await db.query(`
        INSERT INTO subscriptions (
          user_id, plan, status, start_date, end_date, payment_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [req.user.id, plan, 'active', startDate, endDate, payment_id]);

      // Update user subscription status
      await db.query(
        'UPDATE users SET subscription_status = $1 WHERE id = $2',
        ['active', req.user.id]
      );

      await db.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Subscription created successfully',
        data: subscriptionResult.rows[0]
      });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription'
    });
  }
});

// Cancel subscription
router.post('/cancel', authenticateToken, async (req, res) => {
  try {
    // Get current active subscription
    const result = await db.query(`
      SELECT * FROM subscriptions 
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    const subscription = result.rows[0];

    // Start transaction
    await db.query('BEGIN');

    try {
      // Update subscription status
      await db.query(
        'UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE id = $2',
        ['cancelled', subscription.id]
      );

      // Update user subscription status
      await db.query(
        'UPDATE users SET subscription_status = $1 WHERE id = $2',
        ['inactive', req.user.id]
      );

      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'Subscription cancelled successfully'
      });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel subscription'
    });
  }
});

module.exports = router;