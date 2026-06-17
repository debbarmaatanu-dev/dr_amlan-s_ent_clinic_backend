import {FieldValue} from 'firebase-admin/firestore';
import type {RefundRecord, RefundBookingData} from '../types/types.js';
import {logger} from '../utils/logger.js';
import {db} from './firebaseAdmin.js';

/**
 * Create refund record for tracking
 */
export const createRefundRecord = async (
  refundId: string,
  originalTransactionId: string,
  merchantTransactionId: string,
  amount: number,
  reason: string,
  bookingData: RefundBookingData,
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
      createdAt: FieldValue.serverTimestamp(),
    };

    await db.collection('refunds').doc(refundId).set(refundRecord);
    logger.log(`Refund record created: ${refundId}`);
    return {success: true};
  } catch (error) {
    console.error('Error creating refund record:', error);
    return {success: false, error: 'Failed to create refund record'};
  }
};
