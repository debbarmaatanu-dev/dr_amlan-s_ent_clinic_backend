import express = require('express');
import admin = require('firebase-admin');
import {logger} from '../utils/logger';
import {confirmBooking, cancelBooking} from '../services/bookingService';

const router = express.Router();
const db = admin.firestore();

/**
 * PhonePe Webhook Authentication Middleware
 */
const authenticateWebhook = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    logger.error('[WEBHOOK] Missing or invalid authorization header');
    res.status(401).json({error: 'Unauthorized'});
    return;
  }

  try {
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString(
      'ascii',
    );
    const [username, password] = credentials.split(':');

    // Verify webhook credentials from environment variables
    const expectedUsername = process.env.PHONEPE_WEBHOOK_USERNAME;
    const expectedPassword = process.env.PHONEPE_WEBHOOK_PASSWORD;

    if (!expectedUsername || !expectedPassword) {
      logger.error(
        '[WEBHOOK] Webhook credentials not configured in environment',
      );
      res.status(500).json({error: 'Server configuration error'});
      return;
    }

    if (username !== expectedUsername || password !== expectedPassword) {
      logger.error('[WEBHOOK] Invalid webhook credentials');
      res.status(401).json({error: 'Invalid credentials'});
      return;
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
 * POST /api/payment/webhook
 * Handle PhonePe webhook notifications
 */
router.post('/webhook', authenticateWebhook, async (req, res) => {
  try {
    const webhookData = req.body;

    // Log webhook (but mask sensitive data in production)
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      logger.log(
        '[WEBHOOK] Received webhook for transaction:',
        webhookData.transactionId || webhookData.merchantTransactionId,
      );
    } else {
      logger.log('[WEBHOOK] Received webhook:', JSON.stringify(webhookData));
    }

    // Run cleanup occasionally (every 100th webhook to avoid overhead)
    if (Math.random() < 0.01) {
      // 1% chance
      cleanupOldWebhookLogs().catch(error =>
        logger.error('[WEBHOOK-CLEANUP] Cleanup failed:', error),
      );
    }

    // Extract event type and transaction data
    const eventType = webhookData.event || webhookData.type;
    const transactionId =
      webhookData.transactionId || webhookData.merchantTransactionId;
    const status = webhookData.status || webhookData.state;

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

    // Handle different webhook events
    switch (eventType) {
      case 'pg.order.completed':
      case 'paylink.order.completed':
        await handlePaymentSuccess(transactionId, webhookData);
        break;

      case 'pg.order.failed':
        await handlePaymentFailure(transactionId, webhookData);
        break;

      case 'pg.refund.completed':
        await handleRefundCompleted(transactionId, webhookData);
        break;

      case 'pg.refund.failed':
        await handleRefundFailed(transactionId, webhookData);
        break;

      default:
        logger.log(`[WEBHOOK] Unhandled event type: ${eventType}`);
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
  webhookData: unknown,
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

    // Confirm the booking
    const webhookPayload = webhookData as Record<string, unknown>;
    const bookingResult = await confirmBooking(
      transactionId,
      (webhookPayload.paymentId as string) || transactionId,
      {
        method: (webhookPayload.paymentMethod as string) || 'UPI',
      },
    );

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
  _webhookData: unknown,
) {
  try {
    logger.log(`[WEBHOOK] Processing payment failure for: ${transactionId}`);

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
  webhookData: unknown,
) {
  try {
    logger.log(`[WEBHOOK] Processing refund completed for: ${transactionId}`);

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
async function handleRefundFailed(transactionId: string, webhookData: unknown) {
  try {
    logger.log(`[WEBHOOK] Processing refund failed for: ${transactionId}`);

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

export = router;
