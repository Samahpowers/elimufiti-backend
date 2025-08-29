const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// M-Pesa configuration
const MPESA_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://api.safaricom.co.ke' 
  : 'https://sandbox.safaricom.co.ke';

// Generate M-Pesa access token
const getMpesaAccessToken = async () => {
  try {
    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error('M-Pesa token error:', error);
    throw new Error('Failed to get M-Pesa access token');
  }
};

// Generate M-Pesa password
const generateMpesaPassword = () => {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString('base64');
  
  return { password, timestamp };
};

// Initiate M-Pesa STK Push
router.post('/mpesa/initiate', authenticateToken, [
  body('phone_number').matches(/^254[0-9]{9}$/),
  body('amount').isFloat({ min: 1 }),
  body('plan_id').isIn(['basic', 'premium', 'institution'])
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

    const { phone_number, amount, plan_id } = req.body;

    // Create payment record
    const paymentResult = await db.query(`
      INSERT INTO payments (
        user_id, amount, currency, plan_id, phone_number, status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.user.id, amount, 'KSH', plan_id, phone_number, 'pending']);

    const payment = paymentResult.rows[0];

    try {
      // Get M-Pesa access token
      const accessToken = await getMpesaAccessToken();
      const { password, timestamp } = generateMpesaPassword();

      // STK Push request
      const stkPushResponse = await axios.post(
        `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
        {
          BusinessShortCode: process.env.MPESA_SHORTCODE,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.round(amount),
          PartyA: phone_number,
          PartyB: process.env.MPESA_SHORTCODE,
          PhoneNumber: phone_number,
          CallBackURL: `${process.env.MPESA_CALLBACK_URL}`,
          AccountReference: `ELIMUFITI-${payment.id}`,
          TransactionDesc: `Elimufiti ${plan_id} subscription`
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Update payment with M-Pesa checkout request ID
      await db.query(
        'UPDATE payments SET mpesa_checkout_request_id = $1 WHERE id = $2',
        [stkPushResponse.data.CheckoutRequestID, payment.id]
      );

      res.json({
        success: true,
        message: 'Payment initiated successfully',
        data: {
          payment_id: payment.id,
          checkout_request_id: stkPushResponse.data.CheckoutRequestID,
          merchant_request_id: stkPushResponse.data.MerchantRequestID
        }
      });
    } catch (mpesaError) {
      console.error('M-Pesa STK Push error:', mpesaError);
      
      // Update payment status to failed
      await db.query(
        'UPDATE payments SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', mpesaError.message, payment.id]
      );

      res.status(400).json({
        success: false,
        message: 'Failed to initiate M-Pesa payment',
        error: mpesaError.response?.data || mpesaError.message
      });
    }
  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment'
    });
  }
});

// M-Pesa callback endpoint
router.post('/mpesa/callback', async (req, res) => {
  try {
    console.log('M-Pesa Callback received:', JSON.stringify(req.body, null, 2));

    const { Body } = req.body;
    const { stkCallback } = Body;

    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;

    // Find payment by checkout request ID
    const paymentResult = await db.query(
      'SELECT * FROM payments WHERE mpesa_checkout_request_id = $1',
      [checkoutRequestId]
    );

    if (paymentResult.rows.length === 0) {
      console.error('Payment not found for checkout request ID:', checkoutRequestId);
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];

    if (resultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata;
      const items = callbackMetadata.Item;

      const mpesaReceiptNumber = items.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = items.find(item => item.Name === 'TransactionDate')?.Value;
      const phoneNumber = items.find(item => item.Name === 'PhoneNumber')?.Value;

      // Start transaction
      await db.query('BEGIN');

      try {
        // Update payment status
        await db.query(`
          UPDATE payments 
          SET 
            status = 'completed',
            mpesa_receipt_number = $1,
            transaction_date = $2,
            updated_at = NOW()
          WHERE id = $3
        `, [mpesaReceiptNumber, new Date(transactionDate.toString()), payment.id]);

        // Create subscription
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);

        await db.query(`
          INSERT INTO subscriptions (
            user_id, plan, status, start_date, end_date, payment_id
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [payment.user_id, payment.plan_id, 'active', startDate, endDate, payment.id]);

        // Update user subscription status
        await db.query(
          'UPDATE users SET subscription_status = $1 WHERE id = $2',
          ['active', payment.user_id]
        );

        await db.query('COMMIT');

        console.log('Payment completed successfully:', mpesaReceiptNumber);
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    } else {
      // Payment failed
      await db.query(
        'UPDATE payments SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', resultDesc, payment.id]
      );

      console.log('Payment failed:', resultDesc);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('M-Pesa callback error:', error);
    res.status(500).json({ success: false, message: 'Callback processing failed' });
  }
});

// Check payment status
router.get('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'SELECT * FROM payments WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment status'
    });
  }
});

// Get user payment history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(`
      SELECT 
        id, amount, currency, plan_id, status, 
        mpesa_receipt_number, created_at
      FROM payments 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    const countResult = await db.query(
      'SELECT COUNT(*) FROM payments WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        payments: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count),
          pages: Math.ceil(countResult.rows[0].count / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
});

module.exports = router;