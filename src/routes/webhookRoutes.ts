import express = require('express');
import admin = require('firebase-admin');
import {logger} from '../utils/logger';
import {confirmBooking, cancelBooking} from '../services/bookingService';
import {CallbackType, CallbackResponse, CallbackData} from 'pg-sdk-node';

// Extend Express Request type for PhonePe auth data
declare module 'express-serve-static-core' {
  interface Request {
    phonepeAuth?: {
      authorization: string;
      responseBody: string;
    };
  }
}

const router = express.Router();
const db = admin.firestore();

/**
 * PhonePe Webhook Authentication Middleware (SDK-based)
 */
const authenticateWebhook = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void => {
  // Minimal logging for production
  const isProduction = process.env.NODE_ENV === 'production';
  const enableDebugLogs = process.env.ENABLE_DEBUG_LOGS === 'true';

  if (!isProduction || enableDebugLogs) {
    logger.log('[WEBHOOK] Webhook attempt received');
    logger.log('[WEBHOOK] Method:', req.method);
    logger.log('[WEBHOOK] IP:', req.ip);
  }

  // PhonePe sends authorization header (not Basic Auth)
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader) {
    logger.error('[WEBHOOK] Missing authorization header');
    res.status(401).json({error: 'Missing authorization header'});
    return;
  }

  try {
    // Store for validation in the main webhook handler
    req.phonepeAuth = {
      authorization: authorizationHeader,
      responseBody: JSON.stringify(req.body),
    };

    if (!isProduction || enableDebugLogs) {
      logger.log(
        '[WEBHOOK] Authorization header received, proceeding to validation',
      );
    }
    next();
  } catch (error) {
    logger.error('[WEBHOOK] Error parsing credentials:', error);
    res.status(401).json({error: 'Invalid authorization format'});
    return;
  }
};

/**
 * Cleanup old webhook logs (keep only last 30 days to save storage)
 */
const cleanupOldWebhookLogs = async (): Promise<void> => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const oldLogsQuery = await db
      .collection('webhook_logs')
      .where('timestamp', '<', thirtyDaysAgo)
      .limit(50) // Process in batches
      .get();

    if (oldLogsQuery.empty) return;

    const batch = db.batch();
    oldLogsQuery.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    logger.log(
      `[WEBHOOK-CLEANUP] Deleted ${oldLogsQuery.size} old webhook logs`,
    );
  } catch (error) {
    logger.error('[WEBHOOK-CLEANUP] Error cleaning up old logs:', error);
  }
};

/**
 * POST /payment/webhook
 * Handle PhonePe webhook notifications (called via frontend proxy)
 */
router.post('/webhook', authenticateWebhook, async (req, res) => {
  // Environment variables for logging control
  const isProduction = process.env.NODE_ENV === 'production';
  const enableDebugLogs = process.env.ENABLE_DEBUG_LOGS === 'true';

  try {
    // Import PhonePe validation function
    const {validateWebhookCallback} = require('../services/phonePeService');

    // Get auth data from middleware
    const authData = req.phonepeAuth;
    const webhookData = req.body;

    if (!authData) {
      logger.error('[WEBHOOK] Missing auth data from middleware');
      return res.status(401).json({error: 'Missing authentication data'});
    }

    logger.log('[WEBHOOK] Validating webhook with PhonePe SDK');

    // Validate webhook using PhonePe SDK
    let callbackResponse: CallbackResponse | null = null;
    let validatedData: CallbackData | null = null;

    try {
      callbackResponse = validateWebhookCallback(
        process.env.PHONEPE_WEBHOOK_USERNAME!,
        process.env.PHONEPE_WEBHOOK_PASSWORD!,
        authData.authorization,
        authData.responseBody,
      );

      if (callbackResponse) {
        logger.log('[WEBHOOK] SDK validation successful');

        if (!isProduction || enableDebugLogs) {
          logger.log('[WEBHOOK] Callback type:', callbackResponse.type);
        }

        // Use validated data from SDK
        validatedData = callbackResponse.payload;

        // Log transaction ID only (minimal logging)
        logger.log(
          '[WEBHOOK] Processing transaction:',
          validatedData.originalMerchantOrderId || validatedData.orderId,
        );

        // Update webhookData to use validated data with proper typing
        Object.assign(webhookData, {
          type: callbackResponse.type, // This is the CallbackType enum number
          ...validatedData,
        });
      }
    } catch (validationError) {
      logger.error('[WEBHOOK] SDK validation failed');

      if (!isProduction || enableDebugLogs) {
        logger.error('[WEBHOOK] Validation error:', validationError);
        logger.error(
          '[WEBHOOK] Raw webhook data:',
          JSON.stringify(webhookData),
        );
      }

      // In test mode, be more lenient for debugging
      if (process.env.PHONEPE_ENV === 'SANDBOX') {
        logger.log('[WEBHOOK] Test mode - proceeding without SDK validation');
        // Use raw webhook data in test mode with fallback type
        const webhookDataTyped = webhookData as Record<string, unknown>;
        webhookDataTyped.type =
          webhookDataTyped.type || CallbackType.CHECKOUT_ORDER_COMPLETED;
      } else {
        return res.status(401).json({error: 'Invalid webhook signature'});
      }
    }

    // Run cleanup occasionally (every 100th webhook to avoid overhead)
    if (Math.random() < 0.01) {
      // 1% chance
      cleanupOldWebhookLogs().catch(error =>
        logger.error('[WEBHOOK-CLEANUP] Cleanup failed:', error),
      );
    }

    // Extract event type and transaction data (PhonePe SDK format)
    const webhookDataTyped = webhookData as Record<string, unknown>;
    const eventType: CallbackType | string = webhookDataTyped.type as
      | CallbackType
      | string; // SDK provides CallbackType enum
    const transactionId: string =
      (webhookDataTyped.originalMerchantOrderId as string) ||
      (webhookDataTyped.orderId as string);
    const status: string = webhookDataTyped.state as string;

    if (!eventType || !transactionId) {
      logger.error('[WEBHOOK] Missing required fields:', {
        eventType,
        transactionId,
      });
      return res.status(400).json({error: 'Missing required fields'});
    }

    // Check for duplicate webhook (idempotency)
    const existingWebhookQuery = await db
      .collection('webhook_logs')
      .where('transactionId', '==', transactionId)
      .where('eventType', '==', eventType)
      .limit(1)
      .get();

    if (!existingWebhookQuery.empty) {
      logger.log(
        `[WEBHOOK] Duplicate webhook ignored: ${transactionId} - ${eventType}`,
      );
      return res.status(200).json({
        success: true,
        message: 'Webhook already processed',
      });
    }

    // Log webhook event for debugging and tracking (minimal data for free plan)
    const webhookLogRef = await db.collection('webhook_logs').add({
      eventType,
      transactionId,
      status,
      // Only store essential data to save Firestore storage
      paymentMethod:
        (webhookData as Record<string, unknown>).paymentMethod || 'unknown',
      amount: (webhookData as Record<string, unknown>).amount || 0,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      processed: false,
      // Skip IP and user agent in production to save space
      ...(isProduction
        ? {}
        : {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']?.substring(0, 100), // Limit length
          }),
    });

    // Handle different webhook events (PhonePe SDK callback types - ENUM NUMBERS)
    const eventTypeNum = Number(eventType);

    if (!isProduction || enableDebugLogs) {
      logger.log(`[WEBHOOK] Processing event type: ${eventType}`);
    }

    // Use numeric comparison for enum values
    if (
      eventTypeNum === CallbackType.CHECKOUT_ORDER_COMPLETED ||
      eventType === 'CHECKOUT_ORDER_COMPLETED'
    ) {
      logger.log('[WEBHOOK] Processing payment success');
      await handlePaymentSuccess(
        transactionId,
        validatedData || webhookDataTyped,
      );
    } else if (
      eventTypeNum === CallbackType.CHECKOUT_ORDER_FAILED ||
      eventType === 'CHECKOUT_ORDER_FAILED'
    ) {
      logger.log('[WEBHOOK] Processing payment failure');
      await handlePaymentFailure(
        transactionId,
        validatedData || webhookDataTyped,
      );
    } else if (eventTypeNum === CallbackType.PG_ORDER_COMPLETED) {
      logger.log('[WEBHOOK] Processing payment success (PG)');
      await handlePaymentSuccess(
        transactionId,
        validatedData || webhookDataTyped,
      );
    } else if (eventTypeNum === CallbackType.PG_ORDER_FAILED) {
      logger.log('[WEBHOOK] Processing payment failure (PG)');
      await handlePaymentFailure(
        transactionId,
        validatedData || webhookDataTyped,
      );
    } else if (
      eventTypeNum === CallbackType.PG_REFUND_COMPLETED ||
      eventType === 'PG_REFUND_COMPLETED'
    ) {
      logger.log('[WEBHOOK] Processing refund completed');
      await handleRefundCompleted(
        transactionId,
        validatedData || webhookDataTyped,
      );
    } else if (
      eventTypeNum === CallbackType.PG_REFUND_FAILED ||
      eventTypeNum === CallbackType.PG_REFUND_ACCEPTED ||
      eventType === 'PG_REFUND_FAILED' ||
      eventType === 'PG_REFUND_ACCEPTED'
    ) {
      logger.log('[WEBHOOK] Processing refund failed/accepted');
      await handleRefundFailed(
        transactionId,
        validatedData || webhookDataTyped,
      );
    } else {
      logger.log(`[WEBHOOK] Unhandled event type: ${eventType}`);
      if (!isProduction || enableDebugLogs) {
        logger.log('[WEBHOOK] Available CallbackType values:', {
          CHECKOUT_ORDER_COMPLETED: CallbackType.CHECKOUT_ORDER_COMPLETED,
          CHECKOUT_ORDER_FAILED: CallbackType.CHECKOUT_ORDER_FAILED,
          PG_ORDER_COMPLETED: CallbackType.PG_ORDER_COMPLETED,
          PG_ORDER_FAILED: CallbackType.PG_ORDER_FAILED,
        });
      }
    }

    // Mark webhook as processed
    await webhookLogRef.update({
      processed: true,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Respond to PhonePe (must respond within 10 seconds)
    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
    });
  } catch (error) {
    logger.error('[WEBHOOK] Error processing webhook:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Handle successful payment webhook
 */
async function handlePaymentSuccess(
  transactionId: string,
  webhookData: CallbackData | Record<string, unknown>,
) {
  try {
    logger.log(`[WEBHOOK] Processing payment success for: ${transactionId}`);

    // Check if booking already confirmed (prevent duplicate processing)
    const pendingBookingRef = db
      .collection('pending_bookings')
      .doc(transactionId);
    const pendingBookingSnap = await pendingBookingRef.get();

    if (!pendingBookingSnap.exists) {
      logger.log(`[WEBHOOK] No pending booking found for: ${transactionId}`);
      return;
    }

    const pendingData = pendingBookingSnap.data();
    if (pendingData?.status === 'completed') {
      logger.log(`[WEBHOOK] Booking already confirmed for: ${transactionId}`);
      return;
    }

    // Extract payment details from validated webhook data
    let paymentMethod = 'UPI';
    let paymentId = transactionId;

    if (
      'paymentDetails' in webhookData &&
      Array.isArray(webhookData.paymentDetails)
    ) {
      const paymentDetail = webhookData.paymentDetails[0];
      if (paymentDetail) {
        paymentMethod = paymentDetail.paymentMode || 'UPI';
        paymentId = paymentDetail.transactionId || transactionId;
      }
    }

    // Confirm the booking
    const bookingResult = await confirmBooking(transactionId, paymentId, {
      method: paymentMethod,
    });

    if (bookingResult.success) {
      logger.log(
        `[WEBHOOK] Booking confirmed via webhook: ${transactionId}, Slot: ${bookingResult.slotNumber}`,
      );

      // Delete pending booking after successful confirmation
      await pendingBookingRef.delete();
    } else {
      logger.error(
        `[WEBHOOK] Failed to confirm booking: ${transactionId}`,
        bookingResult.error,
      );
    }
  } catch (error) {
    logger.error(
      `[WEBHOOK] Error handling payment success for ${transactionId}:`,
      error,
    );
  }
}

/**
 * Handle failed payment webhook
 */
async function handlePaymentFailure(
  transactionId: string,
  webhookData: CallbackData | Record<string, unknown>,
) {
  try {
    logger.log(`[WEBHOOK] Processing payment failure for: ${transactionId}`);

    // Log failure details for debugging
    if ('errorCode' in webhookData) {
      logger.log(`[WEBHOOK] Error code: ${webhookData.errorCode}`);
    }
    if ('detailedErrorCode' in webhookData) {
      logger.log(
        `[WEBHOOK] Detailed error code: ${webhookData.detailedErrorCode}`,
      );
    }

    // Cancel the booking
    await cancelBooking(transactionId);
    logger.log(`[WEBHOOK] Booking cancelled via webhook: ${transactionId}`);
  } catch (error) {
    logger.error(
      `[WEBHOOK] Error handling payment failure for ${transactionId}:`,
      error,
    );
  }
}

/**
 * Handle refund completed webhook
 */
async function handleRefundCompleted(
  transactionId: string,
  webhookData: CallbackData | Record<string, unknown>,
) {
  try {
    logger.log(`[WEBHOOK] Processing refund completed for: ${transactionId}`);

    // Extract refund ID from webhook data
    let refundId = '';
    if ('refundId' in webhookData && typeof webhookData.refundId === 'string') {
      refundId = webhookData.refundId;
    }

    // Update refund record status
    const refundQuery = await db
      .collection('refunds')
      .where('originalTransactionId', '==', transactionId)
      .get();

    if (!refundQuery.empty) {
      const refundDoc = refundQuery.docs[0];
      await refundDoc.ref.update({
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        refundId: refundId || refundDoc.data().refundId,
        webhookData: webhookData,
      });
      logger.log(
        `[WEBHOOK] Refund status updated to completed: ${transactionId}`,
      );
    }
  } catch (error) {
    logger.error(
      `[WEBHOOK] Error handling refund completed for ${transactionId}:`,
      error,
    );
  }
}

/**
 * Handle refund failed webhook
 */
async function handleRefundFailed(
  transactionId: string,
  webhookData: CallbackData | Record<string, unknown>,
) {
  try {
    logger.log(`[WEBHOOK] Processing refund failed for: ${transactionId}`);

    // Extract error details from webhook data
    let errorCode = '';
    let detailedErrorCode = '';
    if (
      'errorCode' in webhookData &&
      typeof webhookData.errorCode === 'string'
    ) {
      errorCode = webhookData.errorCode;
    }
    if (
      'detailedErrorCode' in webhookData &&
      typeof webhookData.detailedErrorCode === 'string'
    ) {
      detailedErrorCode = webhookData.detailedErrorCode;
    }

    // Update refund record status
    const refundQuery = await db
      .collection('refunds')
      .where('originalTransactionId', '==', transactionId)
      .get();

    if (!refundQuery.empty) {
      const refundDoc = refundQuery.docs[0];
      await refundDoc.ref.update({
        status: 'failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorCode: errorCode,
        detailedErrorCode: detailedErrorCode,
        webhookData: webhookData,
      });
      logger.log(`[WEBHOOK] Refund status updated to failed: ${transactionId}`);
    }
  } catch (error) {
    logger.error(
      `[WEBHOOK] Error handling refund failed for ${transactionId}:`,
      error,
    );
  }
}

/**
 * GET /api/payment/webhook-test
 * Test endpoint to check webhook connectivity and CORS
 */
router.get('/webhook-test', (req, res) => {
  try {
    logger.log('[WEBHOOK-TEST] Test endpoint called');
    logger.log('[WEBHOOK-TEST] Headers:', JSON.stringify(req.headers));
    logger.log('[WEBHOOK-TEST] IP:', req.ip);
    logger.log('[WEBHOOK-TEST] User-Agent:', req.headers['user-agent']);

    return res.json({
      success: true,
      message: 'Webhook endpoint is reachable',
      timestamp: new Date().toISOString(),
      ip: req.ip,
      headers: req.headers,
      environment: process.env.NODE_ENV || 'development',
      phonepeEnv: process.env.PHONEPE_ENV,
    });
  } catch (error) {
    logger.error('[WEBHOOK-TEST] Error in test endpoint:', error);
    return res.status(500).json({
      success: false,
      error: 'Test endpoint failed',
    });
  }
});

/**
 * POST /api/payment/webhook-test
 * Test POST endpoint to simulate PhonePe webhook
 */
router.post('/webhook-test', (req, res) => {
  try {
    logger.log('[WEBHOOK-TEST-POST] POST test endpoint called');
    logger.log('[WEBHOOK-TEST-POST] Headers:', JSON.stringify(req.headers));
    logger.log('[WEBHOOK-TEST-POST] Body:', JSON.stringify(req.body));
    logger.log('[WEBHOOK-TEST-POST] IP:', req.ip);

    return res.json({
      success: true,
      message: 'POST webhook endpoint is reachable',
      timestamp: new Date().toISOString(),
      receivedData: req.body,
      headers: req.headers,
      ip: req.ip,
    });
  } catch (error) {
    logger.error('[WEBHOOK-TEST-POST] Error in POST test endpoint:', error);
    return res.status(500).json({
      success: false,
      error: 'POST test endpoint failed',
    });
  }
});

export = router;
