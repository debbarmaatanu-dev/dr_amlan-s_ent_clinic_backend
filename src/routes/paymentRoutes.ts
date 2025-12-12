import express = require('express');
import admin = require('firebase-admin');
import {
  createPaymentOrder,
  verifyWebhookSignature,
  checkPaymentStatus,
} from '../services/phonePeService';
import {updateRefundStatus} from '../services/refundService';
import {
  createPaymentSession,
  getPaymentSession,
  deletePaymentSession,
} from '../services/sessionService';
import {
  createPendingBooking,
  confirmBooking,
  cancelBooking,
} from '../services/bookingService';

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
    console.log(`Cleaned up ${count} old pending bookings`);
  } catch (error) {
    console.error('Error cleaning up pending bookings:', error);
  }
};

/**
 * POST /api/payment/create-order
 * Create a Razorpay payment order
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
    console.log('Creating PhonePe order for:', {date, name, phone, amount});
    const orderResult = await createPaymentOrder(amount, {
      date,
      name,
      gender,
      age,
      phone,
    });

    if (!orderResult.success || !orderResult.order) {
      console.error('Failed to create Razorpay order:', orderResult.error);
      return res.status(500).json({
        success: false,
        error: orderResult.error || 'Failed to create order',
      });
    }

    console.log('PhonePe order created:', orderResult.order.id);

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

    // Create secure payment session
    const sessionResult = await createPaymentSession(orderResult.order.id, {
      date,
      name,
      gender,
      age,
      phone,
    });

    if (!sessionResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create payment session',
      });
    }

    // Return order details to frontend (PhonePe redirect URL)
    const response = {
      success: true,
      orderId: orderResult.order.id,
      sessionId: sessionResult.sessionId, // Secure session ID
      amount: orderResult.order.amount,
      currency: orderResult.order.currency,
      redirectUrl: orderResult.order.redirectUrl, // PhonePe payment page URL
    };

    console.log('Sending response to frontend:', response);
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
 * POST /api/payment/callback
 * Handle PhonePe redirect callback (user returns from payment page)
 */
router.post('/callback', async (req, res) => {
  try {
    const {transactionId} = req.body;

    if (!transactionId) {
      return res.redirect(
        `${process.env.FRONTEND_DNS}/appointment?payment=failed&error=missing_transaction_id`,
      );
    }

    // Check payment status with PhonePe
    const statusResult = await checkPaymentStatus(transactionId);

    if (!statusResult.success) {
      return res.redirect(
        `${process.env.FRONTEND_DNS}/appointment?payment=failed&error=status_check_failed`,
      );
    }

    const paymentStatus = statusResult.payment?.status;

    if (paymentStatus === 'SUCCESS') {
      // Payment successful - redirect to success page
      return res.redirect(
        `${process.env.FRONTEND_DNS}/appointment?payment=success&transaction_id=${transactionId}`,
      );
    } else {
      // Payment failed - mark booking as failed
      await cancelBooking(transactionId);
      return res.redirect(
        `${process.env.FRONTEND_DNS}/appointment?payment=failed&error=payment_unsuccessful`,
      );
    }
  } catch (error) {
    console.error('Error in payment callback:', error);
    return res.redirect(
      `${process.env.FRONTEND_DNS}/appointment?payment=failed&error=callback_error`,
    );
  }
});

/**
 * GET /api/payment/status/:sessionId
 * Check payment status using secure session ID
 */
router.get('/status/:sessionId', async (req, res) => {
  try {
    const {sessionId} = req.params;

    // Get session data
    const sessionResult = await getPaymentSession(sessionId);
    if (!sessionResult.success || !sessionResult.session) {
      return res.json({
        success: false,
        error: 'Invalid or expired session',
      });
    }

    const {transactionId, bookingData} = sessionResult.session;

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
      // Confirm booking
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

      // Delete pending booking and session after successful confirmation
      try {
        await db.collection('pending_bookings').doc(transactionId).delete();
        await deletePaymentSession(sessionId);
        console.log(`Deleted pending booking and session: ${transactionId}`);
      } catch (error) {
        console.error('Error deleting pending booking/session:', error);
      }

      return res.json({
        success: true,
        status: 'SUCCESS',
        slotNumber: bookingResult.slotNumber,
        date: bookingResult.date,
        name: bookingResult.name,
        bookingData: bookingData, // Return booking data from session
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
    console.error('Error checking payment status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export = router;

/**
 * POST /api/payment/webhook
 * Handle PhonePe webhook notifications
 */
router.post('/webhook', async (req, res) => {
  try {
    const xVerify = req.headers['x-verify'] as string;
    const requestBody = JSON.stringify(req.body);

    // Verify webhook signature
    if (!verifyWebhookSignature(requestBody, xVerify)) {
      console.error('Invalid webhook signature');
      return res.status(400).json({error: 'Invalid signature'});
    }

    const {transactionId, code} = req.body;

    console.log('PhonePe webhook received:', {transactionId, code});

    // Handle different webhook events
    if (code === 'PAYMENT_SUCCESS') {
      console.log(`Payment successful: ${transactionId}`);
      // Payment confirmation is handled by status polling from frontend
      // This webhook is mainly for logging and backup verification
    } else if (code === 'PAYMENT_FAILED') {
      console.log(`Payment failed: ${transactionId}`);
      await cancelBooking(transactionId);
    }

    // Always respond with success to PhonePe
    return res.json({success: true});
  } catch (error) {
    console.error('Error in webhook handler:', error);
    return res.status(500).json({error: 'Webhook processing failed'});
  }
});

/**
 * POST /api/payment/refund-webhook
 * Handle PhonePe refund webhook notifications
 */
router.post('/refund-webhook', async (req, res) => {
  try {
    const xVerify = req.headers['x-verify'] as string;
    const requestBody = JSON.stringify(req.body);

    // Verify webhook signature
    if (!verifyWebhookSignature(requestBody, xVerify)) {
      console.error('Invalid refund webhook signature');
      return res.status(400).json({error: 'Invalid signature'});
    }

    const {transactionId, code} = req.body;

    console.log('PhonePe refund webhook received:', {transactionId, code});

    // Update refund status based on webhook
    if (code === 'REFUND_SUCCESS') {
      await updateRefundStatus(transactionId, 'completed');
      console.log(`Refund completed: ${transactionId}`);
    } else if (code === 'REFUND_FAILED') {
      await updateRefundStatus(transactionId, 'failed');
      console.log(`Refund failed: ${transactionId}`);
    }

    return res.json({success: true});
  } catch (error) {
    console.error('Error in refund webhook handler:', error);
    return res.status(500).json({error: 'Refund webhook processing failed'});
  }
});

/**
 * GET /api/payment/test-payment
 * Mock PhonePe payment page for testing
 */
router.get('/test-payment', async (req, res) => {
  const {transaction_id} = req.query;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mock PhonePe Payment</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .container { max-width: 400px; margin: 0 auto; }
        button { padding: 15px 30px; margin: 10px; font-size: 16px; cursor: pointer; }
        .success { background: #4CAF50; color: white; border: none; }
        .failure { background: #f44336; color: white; border: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Mock PhonePe Payment</h2>
        <p>Transaction ID: ${transaction_id}</p>
        <p>Amount: ₹400</p>
        <p>Choose payment result:</p>
        
        <button class="success" onclick="simulateSuccess()">
          ✅ Simulate Success
        </button>
        
        <button class="failure" onclick="simulateFailure()">
          ❌ Simulate Failure
        </button>
      </div>
      
      <script>
        function simulateSuccess() {
          window.location.href = '${process.env.FRONTEND_DNS}/appointment?payment=success&transaction_id=${transaction_id}';
        }
        
        function simulateFailure() {
          window.location.href = '${process.env.FRONTEND_DNS}/appointment?payment=failed&error=payment_unsuccessful';
        }
      </script>
    </body>
    </html>
  `;

  res.send(html);
});
