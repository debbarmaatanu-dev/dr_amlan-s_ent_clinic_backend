import express = require('express');
import admin = require('firebase-admin');
import {
  createPaymentOrder,
  checkPaymentStatus,
} from '../services/phonePeService';

import {
  createPendingBooking,
  confirmBooking,
  cancelBooking,
} from '../services/bookingService';
import {isClinicOpen} from '../services/clinicService';
import {logger} from '../utils/logger';

const router = express.Router();
const db = admin.firestore();

/**
 * Format date from YYYY-MM-DD to DD-MM-YYYY
 */
const formatDateToDocId = (dateString: string): string => {
  const [year, month, day] = dateString.split('-');
  return `${day}-${month}-${year}`;
};

/**
 * Cleanup old pending bookings (older than 24 hours)
 */
const cleanupOldPendingBookings = async (): Promise<void> => {
  try {
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const snapshot = await db
      .collection('pending_bookings')
      .where('createdAt', '<', oneDayAgo)
      .get();

    if (snapshot.empty) {
      return;
    }

    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
      batch.delete(doc.ref);
      count++;
    });

    await batch.commit();
    logger.log(`Cleaned up ${count} old pending bookings`);
  } catch (error) {
    console.error('Error cleaning up pending bookings:', error);
  }
};

/**
 * POST /api/payment/create-order
 * Create a PhonePe payment order
 */
router.post('/create-order', async (req, res) => {
  try {
    const {date, name, gender, age, phone, amount} = req.body;

    // Validate required fields
    if (!date || !name || !gender || !age || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    // Validate amount (must be ₹400)
    if (amount !== 400) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount',
      });
    }

    // Validate phone number
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number',
      });
    }

    // Validate date and time constraints
    const selectedDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if date is Sunday
    if (selectedDate.getDay() === 0) {
      return res.status(400).json({
        success: false,
        error: 'Clinic is closed on Sundays',
      });
    }

    // Check if booking for today after 7 PM
    const now = new Date();
    const currentHour = now.getHours();
    const isToday =
      selectedDate.getDate() === now.getDate() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getFullYear() === now.getFullYear();

    if (isToday && currentHour >= 19) {
      return res.status(400).json({
        success: false,
        error: 'Bookings for today are closed after 7 PM',
      });
    }

    // Cleanup old pending bookings (run on first booking of the day)
    await cleanupOldPendingBookings();

    // Check if clinic is manually closed by admin
    const clinicStatus = await isClinicOpen();
    if (!clinicStatus.isOpen) {
      return res.status(400).json({
        success: false,
        error: clinicStatus.reason || 'Clinic bookings are temporarily closed',
        code: 'CLINIC_CLOSED',
      });
    }

    // Check slot availability BEFORE creating payment order
    const docId = formatDateToDocId(date);
    const docRef = db.collection('appointment_bookings').doc(docId);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
      const data = docSnap.data();
      const bookings = data?.bookings || [];
      if (bookings.length >= 10) {
        return res.status(400).json({
          success: false,
          error: 'No slots available for this date',
        });
      }
    }

    // Create PhonePe order
    logger.log('Creating PhonePe order for:', {date, name, phone, amount});
    const orderResult = await createPaymentOrder(amount, {
      date,
      name,
      gender,
      age,
      phone,
    });

    if (!orderResult.success || !orderResult.order) {
      console.error('Failed to create PhonePe order:', orderResult.error);
      return res.status(500).json({
        success: false,
        error: orderResult.error || 'Failed to create order',
      });
    }

    logger.log('PhonePe order created:', orderResult.order.id);

    // Create pending booking
    const pendingResult = await createPendingBooking(orderResult.order.id, {
      date,
      name,
      gender,
      age,
      phone,
      amount,
    });

    if (!pendingResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create pending booking',
      });
    }

    // Return order details to frontend (PhonePe redirect URL)
    const response = {
      success: true,
      orderId: orderResult.order.id,
      amount: orderResult.order.amount,
      currency: orderResult.order.currency,
      redirectUrl: orderResult.order.redirectUrl, // PhonePe payment page URL
    };

    logger.log('Sending response to frontend:', response);
    return res.json(response);
  } catch (error) {
    console.error('Error in create-order:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/payment/webhook-status/:transactionId
 * Check if webhook has already processed this transaction (faster than API call)
 */
router.get('/webhook-status/:transactionId', async (req, res) => {
  try {
    const {transactionId} = req.params;

    // Check if webhook already processed this transaction
    const webhookLogQuery = await db
      .collection('webhook_logs')
      .where('transactionId', '==', transactionId)
      .where('processed', '==', true)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    if (!webhookLogQuery.empty) {
      const webhookLog = webhookLogQuery.docs[0].data();

      return res.json({
        success: true,
        webhookProcessed: true,
        eventType: webhookLog.eventType,
        status: webhookLog.status,
        timestamp: webhookLog.timestamp,
      });
    }

    return res.json({
      success: true,
      webhookProcessed: false,
    });
  } catch (error) {
    logger.error('Error checking webhook status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/payment/callback (for production mode redirects)
 * Handle PhonePe redirect callback when user returns from payment page
 */
router.get('/callback', async (req, res) => {
  try {
    const {transaction_id} = req.query;

    if (!transaction_id) {
      return res.redirect(
        `${process.env.FRONTEND_DNS}/appointment?payment=failed&error=missing_transaction_id`,
      );
    }

    logger.log('Payment callback received for transaction:', transaction_id);

    // In production mode, PhonePe redirects here after payment
    // We'll redirect back to frontend with transaction ID so it can check status
    return res.redirect(
      `${process.env.FRONTEND_DNS}/appointment?payment=callback&transaction_id=${transaction_id}`,
    );
  } catch (error) {
    console.error('Error in payment callback:', error);
    return res.redirect(
      `${process.env.FRONTEND_DNS}/appointment?payment=failed&error=callback_error`,
    );
  }
});

export = router;

/**
 * GET /api/payment/status-by-transaction/:transactionId
 * Check payment status by transaction ID (works for both test and production)
 */
router.get('/status-by-transaction/:transactionId', async (req, res) => {
  try {
    const {transactionId} = req.params;

    // Get pending booking data
    const pendingBookingRef = db
      .collection('pending_bookings')
      .doc(transactionId);
    const pendingBookingSnap = await pendingBookingRef.get();

    if (!pendingBookingSnap.exists) {
      return res.json({
        success: false,
        error: 'Transaction not found',
      });
    }

    const pendingData = pendingBookingSnap.data();

    // Check payment status with PhonePe
    const statusResult = await checkPaymentStatus(transactionId);

    if (!statusResult.success) {
      return res.json({
        success: false,
        error: 'Failed to check payment status',
      });
    }

    const paymentStatus = statusResult.payment?.status;

    if (paymentStatus === 'SUCCESS') {
      // CRITICAL: Check if clinic was closed after payment but before booking confirmation
      const clinicStatus = await isClinicOpen();
      if (!clinicStatus.isOpen) {
        logger.log(
          `[REFUND-TRIGGER] Payment successful but clinic closed during process. Transaction: ${transactionId}`,
        );

        // Initiate automatic refund
        try {
          const {initiateRefund} = await import('../services/phonePeService');
          const refundResult = await initiateRefund(
            transactionId,
            statusResult.payment?.amount || 40000, // Amount in paise
            'Clinic closed during payment process - automatic refund',
          );

          if (refundResult.success) {
            logger.log(
              `[AUTO-REFUND] Refund initiated for ${transactionId}: ${refundResult.refund?.refundId}`,
            );

            // Store refund record
            const {createRefundRecord} =
              await import('../services/refundService');
            await createRefundRecord(
              refundResult.refund?.refundId || `auto_${transactionId}`,
              transactionId,
              transactionId,
              statusResult.payment?.amount || 40000,
              'Clinic closed during payment process - automatic refund',
              {
                date: pendingData?.date || 'unknown',
                name: pendingData?.name || 'unknown',
                phone: pendingData?.phone || 'unknown',
              },
            );

            // Delete pending booking
            await db.collection('pending_bookings').doc(transactionId).delete();

            return res.json({
              success: false,
              status: 'REFUNDED',
              error:
                'Clinic bookings were closed during your payment. A refund has been automatically initiated and will be processed within 5-7 business days.',
              refundId: refundResult.refund?.refundId,
            });
          } else {
            console.error(
              `[AUTO-REFUND-FAILED] Could not initiate refund for ${transactionId}:`,
              refundResult.error,
            );

            // Store failed refund attempt for manual processing
            await db
              .collection('failed_refunds')
              .doc(transactionId)
              .set({
                transactionId,
                amount: statusResult.payment?.amount || 40000,
                reason: 'Clinic closed during payment - auto refund failed',
                error: refundResult.error,
                pendingData,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'manual_required',
              });

            return res.json({
              success: false,
              status: 'REFUND_PENDING',
              error:
                'Clinic bookings were closed during your payment. Please contact us for a refund - your transaction ID is: ' +
                transactionId,
            });
          }
        } catch (refundError) {
          console.error(
            `[AUTO-REFUND-ERROR] Error processing refund for ${transactionId}:`,
            refundError,
          );

          return res.json({
            success: false,
            status: 'REFUND_ERROR',
            error:
              'Clinic bookings were closed during your payment. Please contact us immediately with transaction ID: ' +
              transactionId,
          });
        }
      }

      // Clinic is open, proceed with normal booking confirmation
      const bookingResult = await confirmBooking(
        transactionId,
        statusResult.payment?.transactionId || transactionId,
        {
          method: statusResult.payment?.method,
        },
      );

      if (!bookingResult.success) {
        return res.json({
          success: false,
          error: bookingResult.error || 'Failed to confirm booking',
        });
      }

      // Delete pending booking after successful confirmation
      try {
        await db.collection('pending_bookings').doc(transactionId).delete();
        logger.log(`Deleted pending booking: ${transactionId}`);
      } catch (error) {
        console.error('Error deleting pending booking:', error);
      }

      return res.json({
        success: true,
        status: 'SUCCESS',
        slotNumber: bookingResult.slotNumber,
        date: bookingResult.date,
        name: bookingResult.name,
        bookingData: pendingData, // Return original booking data
        message: 'Booking confirmed successfully',
      });
    } else if (paymentStatus === 'FAILED') {
      await cancelBooking(transactionId);
      return res.json({
        success: false,
        status: 'FAILED',
        error: 'Payment failed',
      });
    } else {
      return res.json({
        success: false,
        status: paymentStatus || 'PENDING',
        error: 'Payment still processing',
      });
    }
  } catch (error) {
    console.error('Error checking payment status by transaction:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});
