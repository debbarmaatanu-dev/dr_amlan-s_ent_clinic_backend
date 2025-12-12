import admin = require('firebase-admin');

const db = admin.firestore();

interface BookingData {
  slotNumber: number;
  name: string;
  gender: string;
  age: number;
  phone: string;
  paymentId: string;
  orderId: string;
  amount: number;
  paymentStatus: string;
  paymentMethod?: string; // upi, card, netbanking, wallet
  paymentDetails?: {
    vpa?: string; // UPI ID
    bank?: string; // Bank name
    wallet?: string; // Wallet name
    cardId?: string; // Card ID
  };
  timestamp: string; // ISO timestamp string (cannot use FieldValue in arrays)
}

interface PendingBooking {
  orderId: string;
  date: string;
  name: string;
  gender: string;
  age: number;
  phone: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: admin.firestore.FieldValue;
}

/**
 * Format date from YYYY-MM-DD to DD-MM-YYYY
 */
const formatDateToDocId = (dateString: string): string => {
  const [year, month, day] = dateString.split('-');
  return `${day}-${month}-${year}`;
};

/**
 * Create a pending booking (before payment)
 */
export const createPendingBooking = async (
  orderId: string,
  bookingData: {
    date: string;
    name: string;
    gender: string;
    age: number;
    phone: string;
    amount: number;
  },
) => {
  try {
    const pendingBooking: PendingBooking = {
      orderId,
      date: bookingData.date,
      name: bookingData.name,
      gender: bookingData.gender,
      age: bookingData.age,
      phone: bookingData.phone,
      amount: bookingData.amount,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('pending_bookings').doc(orderId).set(pendingBooking);
    return {success: true};
  } catch (error) {
    console.error('Error creating pending booking:', error);
    return {success: false, error: 'Failed to create pending booking'};
  }
};

/**
 * Confirm booking after successful payment (using transaction)
 * Returns slot availability status for auto-refund handling
 */
export const confirmBooking = async (
  orderId: string,
  paymentId: string,
  paymentDetails?: {
    method?: string;
    vpa?: string;
    bank?: string;
    wallet?: string;
    cardId?: string;
  },
) => {
  let pendingData: PendingBooking;

  try {
    // Get pending booking
    const pendingBookingRef = db.collection('pending_bookings').doc(orderId);
    const pendingBookingSnap = await pendingBookingRef.get();

    if (!pendingBookingSnap.exists) {
      return {success: false, error: 'Pending booking not found'};
    }

    pendingData = pendingBookingSnap.data() as PendingBooking;

    // Create actual booking using transaction
    const result = await db.runTransaction(async transaction => {
      const docId = formatDateToDocId(pendingData.date);
      const docRef = db.collection('appointment_bookings').doc(docId);
      const docSnap = await transaction.get(docRef);

      let bookings: BookingData[] = [];
      let nextSlotNumber = 1;

      if (docSnap.exists) {
        const data = docSnap.data();
        bookings = data?.bookings || [];

        // Check if slots are still available
        if (bookings.length >= 10) {
          throw new Error('NO_SLOTS_AVAILABLE');
        }

        // Find next slot number
        const maxSlot = bookings.reduce(
          (max: number, b: BookingData) => Math.max(max, b.slotNumber),
          0,
        );
        nextSlotNumber = maxSlot + 1;
      }

      // Build payment details object without undefined values
      const cleanPaymentDetails: {
        vpa?: string;
        bank?: string;
        wallet?: string;
        cardId?: string;
      } = {};

      if (paymentDetails?.vpa) cleanPaymentDetails.vpa = paymentDetails.vpa;
      if (paymentDetails?.bank) cleanPaymentDetails.bank = paymentDetails.bank;
      if (paymentDetails?.wallet)
        cleanPaymentDetails.wallet = paymentDetails.wallet;
      if (paymentDetails?.cardId)
        cleanPaymentDetails.cardId = paymentDetails.cardId;

      const newBooking: BookingData = {
        slotNumber: nextSlotNumber,
        name: pendingData.name,
        gender: pendingData.gender,
        age: pendingData.age,
        phone: pendingData.phone,
        paymentId: paymentId,
        orderId: orderId,
        amount: pendingData.amount,
        paymentStatus: 'paid',
        paymentMethod: paymentDetails?.method,
        ...(Object.keys(cleanPaymentDetails).length > 0 && {
          paymentDetails: cleanPaymentDetails,
        }),
        timestamp: new Date().toISOString(), // Use ISO string instead of FieldValue
      };

      bookings.push(newBooking);
      transaction.set(docRef, {bookings});

      return {slotNumber: nextSlotNumber};
    });

    // Update pending booking status
    await pendingBookingRef.update({
      status: 'completed',
      paymentId: paymentId,
      slotNumber: result.slotNumber,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      slotNumber: result.slotNumber,
      date: pendingData.date,
      name: pendingData.name,
    };
  } catch (error: unknown) {
    console.error('Error confirming booking:', error);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    /* @ts-ignore */
    if (error.message === 'NO_SLOTS_AVAILABLE') {
      return {success: false, error: 'No slots available for this date'};
    }

    return {success: false, error: 'Failed to confirm booking'};
  }
};

/**
 * Cancel booking (mark as failed)
 */
export const cancelBooking = async (orderId: string) => {
  try {
    await db.collection('pending_bookings').doc(orderId).update({
      status: 'failed',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {success: true};
  } catch (error) {
    console.error('Error canceling booking:', error);
    return {success: false, error: 'Failed to cancel booking'};
  }
};
