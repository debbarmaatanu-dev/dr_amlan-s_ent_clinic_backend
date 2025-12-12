import admin = require('firebase-admin');

const db = admin.firestore();

interface RefundRecord {
  refundId: string;
  originalTransactionId: string;
  merchantTransactionId: string;
  amount: number;
  reason: string;
  status: 'initiated' | 'completed' | 'failed';
  bookingData: {
    date: string;
    name: string;
    phone: string;
    slotNumber?: number;
  };
  createdAt: admin.firestore.FieldValue;
  completedAt?: admin.firestore.FieldValue;
}

/**
 * Create refund record for tracking
 */
export const createRefundRecord = async (
  refundId: string,
  originalTransactionId: string,
  merchantTransactionId: string,
  amount: number,
  reason: string,
  bookingData: {
    date: string;
    name: string;
    phone: string;
    slotNumber?: number;
  },
) => {
  try {
    const refundRecord: RefundRecord = {
      refundId,
      originalTransactionId,
      merchantTransactionId,
      amount,
      reason,
      status: 'initiated',
      bookingData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('refunds').doc(refundId).set(refundRecord);
    console.log(`Refund record created: ${refundId}`);
    return {success: true};
  } catch (error) {
    console.error('Error creating refund record:', error);
    return {success: false, error: 'Failed to create refund record'};
  }
};

/**
 * Update refund status
 */
export const updateRefundStatus = async (
  refundId: string,
  status: 'completed' | 'failed',
) => {
  try {
    const updateData: {
      status: 'completed' | 'failed';
      completedAt?: admin.firestore.FieldValue;
    } = {
      status,
    };

    if (status === 'completed' || status === 'failed') {
      updateData.completedAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await db.collection('refunds').doc(refundId).update(updateData);
    console.log(`Refund status updated: ${refundId} -> ${status}`);
    return {success: true};
  } catch (error) {
    console.error('Error updating refund status:', error);
    return {success: false, error: 'Failed to update refund status'};
  }
};

/**
 * Get refund record
 */
export const getRefundRecord = async (refundId: string) => {
  try {
    const doc = await db.collection('refunds').doc(refundId).get();

    if (!doc.exists) {
      return {success: false, error: 'Refund record not found'};
    }

    return {success: true, refund: doc.data() as RefundRecord};
  } catch (error) {
    console.error('Error getting refund record:', error);
    return {success: false, error: 'Failed to get refund record'};
  }
};
