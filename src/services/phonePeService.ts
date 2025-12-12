import {StandardCheckoutClient, Env} from 'pg-sdk-node';
import crypto from 'crypto';

// Initialize PhonePe client instance
const clientId = process.env.PHONEPE_CLIENT_ID!;
const clientSecret = process.env.PHONEPE_CLIENT_SECRET!;
const clientVersion = parseInt(process.env.PHONEPE_CLIENT_VERSION!) || 1;
const env =
  process.env.PHONEPE_ENV === 'PRODUCTION' ? Env.PRODUCTION : Env.SANDBOX;

const phonePeClient = StandardCheckoutClient.getInstance(
  clientId,
  clientSecret,
  clientVersion,
  env,
);

export {phonePeClient};

/**
 * Create a PhonePe payment order
 */
export const createPaymentOrder = async (
  amount: number,
  _bookingData: {
    date: string;
    name: string;
    gender: string;
    age: number;
    phone: string;
  },
) => {
  try {
    const merchantTransactionId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // For now, return a mock response until we get the correct PhonePe SDK API
    // This will need to be updated with actual PhonePe SDK calls
    console.log('PhonePe order created successfully:', merchantTransactionId);

    // Mock redirect URL - for testing, create a simple test payment page
    const mockRedirectUrl = `${process.env.BACKEND_URL}/api/payment/test-payment?transaction_id=${merchantTransactionId}`;

    return {
      success: true,
      order: {
        id: merchantTransactionId,
        amount: amount * 100,
        currency: 'INR',
        redirectUrl: mockRedirectUrl,
      },
    };
  } catch (error) {
    console.error('Error creating PhonePe order:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return {success: false, error: 'Failed to create payment order'};
  }
};

/**
 * Verify PhonePe webhook signature
 */
export const verifyWebhookSignature = (
  requestBody: string,
  xVerifyHeader: string,
): boolean => {
  try {
    const saltKey = process.env.PHONEPE_CLIENT_SECRET!;
    const saltIndex = 1; // Usually 1 for PhonePe

    const expectedSignature =
      crypto
        .createHash('sha256')
        .update(requestBody + '/pg/v1/status' + saltKey)
        .digest('hex') +
      '###' +
      saltIndex;

    return xVerifyHeader === expectedSignature;
  } catch (error) {
    console.error('Error verifying PhonePe webhook signature:', error);
    return false;
  }
};

/**
 * Check PhonePe payment status
 */
export const checkPaymentStatus = async (merchantTransactionId: string) => {
  try {
    // Mock implementation - replace with actual PhonePe SDK status check
    console.log('Checking payment status for:', merchantTransactionId);

    // For testing, return success status
    return {
      success: true,
      payment: {
        id: merchantTransactionId,
        amount: 40000, // ₹400 in paise
        status: 'SUCCESS', // SUCCESS, FAILED, PENDING
        method: 'UPI',
        transactionId: `phonepe_${merchantTransactionId}`,
        responseCode: 'SUCCESS',
        responseCodeDescription: 'Transaction completed successfully',
      },
    };
  } catch (error) {
    console.error('Error checking PhonePe payment status:', error);
    return {success: false, error: 'Failed to check payment status'};
  }
};

/**
 * Initiate PhonePe refund
 */
export const initiateRefund = async (
  originalTransactionId: string,
  refundAmount: number,
  _reason: string = 'Booking slot unavailable',
) => {
  try {
    const refundTransactionId = `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Mock implementation - replace with actual PhonePe SDK refund call
    console.log('PhonePe refund initiated:', refundTransactionId);

    return {
      success: true,
      refund: {
        refundId: refundTransactionId,
        originalTransactionId: originalTransactionId,
        amount: refundAmount,
        status: 'INITIATED',
      },
    };
  } catch (error) {
    console.error('Error initiating PhonePe refund:', error);
    return {success: false, error: 'Failed to initiate refund'};
  }
};
