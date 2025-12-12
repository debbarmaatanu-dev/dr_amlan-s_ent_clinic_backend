import admin = require('firebase-admin');

const db = admin.firestore();

interface PaymentSession {
  sessionId: string;
  transactionId: string;
  bookingData: {
    date: string;
    name: string;
    gender: string;
    age: number;
    phone: string;
  };
  createdAt: admin.firestore.FieldValue;
  expiresAt: Date;
}

/**
 * Create secure payment session
 */
export const createPaymentSession = async (
  transactionId: string,
  bookingData: {
    date: string;
    name: string;
    gender: string;
    age: number;
    phone: string;
  },
) => {
  try {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30); // 30 minutes expiry

    const session: PaymentSession = {
      sessionId,
      transactionId,
      bookingData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    };

    await db.collection('payment_sessions').doc(sessionId).set(session);

    return {success: true, sessionId};
  } catch (error) {
    console.error('Error creating payment session:', error);
    return {success: false, error: 'Failed to create session'};
  }
};

/**
 * Get payment session data
 */
export const getPaymentSession = async (sessionId: string) => {
  try {
    const doc = await db.collection('payment_sessions').doc(sessionId).get();

    if (!doc.exists) {
      return {success: false, error: 'Session not found'};
    }

    const session = doc.data() as PaymentSession;

    // Check if session expired
    if (session.expiresAt < new Date()) {
      await db.collection('payment_sessions').doc(sessionId).delete();
      return {success: false, error: 'Session expired'};
    }

    return {success: true, session};
  } catch (error) {
    console.error('Error getting payment session:', error);
    return {success: false, error: 'Failed to get session'};
  }
};

/**
 * Delete payment session
 */
export const deletePaymentSession = async (sessionId: string) => {
  try {
    await db.collection('payment_sessions').doc(sessionId).delete();
    return {success: true};
  } catch (error) {
    console.error('Error deleting payment session:', error);
    return {success: false};
  }
};
