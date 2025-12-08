import express = require('express');
import admin = require('firebase-admin');
import {
  createPaymentOrder,
  verifyPaymentSignature,
  fetchPaymentDetails,
} from '../services/razorpayService';
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

    // Create Razorpay order
    console.log('Creating Razorpay order for:', {date, name, phone, amount});
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

    console.log('Razorpay order created:', orderResult.order.id);

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

    // Return order details to frontend
    return res.json({
      success: true,
      orderId: orderResult.order.id,
      amount: orderResult.order.amount,
      currency: orderResult.order.currency,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Error in create-order:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/payment/verify
 * Verify payment and create booking
 */
router.post('/verify', async (req, res) => {
  try {
    const {razorpay_order_id, razorpay_payment_id, razorpay_signature} =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing payment details',
      });
    }

    // Verify signature
    const isValid = verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );

    if (!isValid) {
      // Mark booking as failed
      await cancelBooking(razorpay_order_id);

      return res.status(400).json({
        success: false,
        error: 'Invalid payment signature',
      });
    }

    // Fetch payment details from Razorpay
    const paymentDetailsResult = await fetchPaymentDetails(razorpay_payment_id);
    const paymentInfo = paymentDetailsResult.success
      ? {
          method: paymentDetailsResult.payment?.method,
          vpa: paymentDetailsResult.payment?.vpa || undefined,
          bank: paymentDetailsResult.payment?.bank,
          wallet: paymentDetailsResult.payment?.wallet || undefined,
          cardId: paymentDetailsResult.payment?.cardId || undefined,
        }
      : undefined;

    // Confirm booking with payment details
    const bookingResult = await confirmBooking(
      razorpay_order_id,
      razorpay_payment_id,
      paymentInfo,
    );

    if (!bookingResult.success) {
      return res.status(500).json({
        success: false,
        error: bookingResult.error || 'Failed to confirm booking',
      });
    }

    // Delete pending booking after successful confirmation
    try {
      await db.collection('pending_bookings').doc(razorpay_order_id).delete();
      console.log(`Deleted pending booking: ${razorpay_order_id}`);
    } catch (error) {
      console.error('Error deleting pending booking:', error);
      // Don't fail the request if deletion fails
    }

    return res.json({
      success: true,
      slotNumber: bookingResult.slotNumber,
      date: bookingResult.date,
      name: bookingResult.name,
      message: 'Booking confirmed successfully',
    });
  } catch (error) {
    console.error('Error in verify payment:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export = router;
