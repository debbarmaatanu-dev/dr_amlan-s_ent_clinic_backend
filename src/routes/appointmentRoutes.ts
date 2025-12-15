import express = require('express');
import admin = require('firebase-admin');
import type {BookingData} from '../types/types';

const router = express.Router();
const db = admin.firestore();

/**
 * Format date from YYYY-MM-DD to DD-MM-YYYY for Firestore document ID
 */
const formatDateToDocId = (dateString: string): string => {
  const [year, month, day] = dateString.split('-');
  return `${day}-${month}-${year}`;
};

/**
 * POST /api/appointment/search
 * Search for appointment by phone number and date
 */
router.post('/search', async (req, res) => {
  try {
    const {phone, date} = req.body;

    // Validate required fields
    if (!phone || !date) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and date are required',
      });
    }

    // Validate phone number format
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
      });
    }

    // Search in appointment_bookings collection
    const docId = formatDateToDocId(date);
    const docRef = db.collection('appointment_bookings').doc(docId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.json({
        success: false,
        error: 'No appointments found for this date',
      });
    }

    const data = docSnap.data();
    const bookings: BookingData[] = data?.bookings || [];

    // Find all bookings with matching phone number
    const matchingBookings = bookings.filter(
      (b: BookingData) => b.phone === phone,
    );

    if (matchingBookings.length === 0) {
      return res.json({
        success: false,
        error:
          'No appointment found for this phone number on the selected date',
      });
    }

    // If single booking, return it directly for receipt view
    if (matchingBookings.length === 1) {
      const booking = matchingBookings[0];
      const bookingData = {
        slotNumber: booking.slotNumber,
        date: date,
        name: booking.name,
        gender: booking.gender,
        age: booking.age,
        phone: booking.phone,
        amount: booking.amount,
        paymentId: booking.paymentId,
        orderId: booking.orderId,
        paymentMethod: booking.paymentMethod || 'UPI',
      };

      return res.json({
        success: true,
        booking: bookingData,
        multiple: false,
        message: 'Appointment found successfully',
      });
    }

    // If multiple bookings, return all for table view
    const sortedBookings = matchingBookings.sort(
      (a, b) => a.slotNumber - b.slotNumber,
    );
    const bookingsData = sortedBookings.map(booking => ({
      slotNumber: booking.slotNumber,
      date: date,
      name: booking.name,
      gender: booking.gender,
      age: booking.age,
      phone: booking.phone,
      amount: booking.amount,
      paymentId: booking.paymentId,
      orderId: booking.orderId,
      paymentMethod: booking.paymentMethod || 'UPI',
      timestamp: booking.timestamp,
    }));

    return res.json({
      success: true,
      bookings: bookingsData,
      multiple: true,
      totalBookings: matchingBookings.length,
      message: `${matchingBookings.length} appointments found for this phone number`,
    });
  } catch (error) {
    console.error('Error searching appointment:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/appointment/clinic-status
 * Get clinic status for public display (no auth required)
 */
router.get('/clinic-status', async (_, res) => {
  try {
    const {getClinicStatus} = await import('../services/clinicService');
    const status = await getClinicStatus();

    return res.json({
      success: true,
      status,
    });
  } catch (error) {
    console.error('Error fetching clinic status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export = router;
