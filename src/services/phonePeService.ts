import {
  StandardCheckoutClient,
  Env,
  StandardCheckoutPayRequest,
  RefundRequest,
  MetaInfo,
} from 'pg-sdk-node';

import type {
  PaymentOrderData,
  PaymentOrderResponse,
  PaymentStatusResponse,
} from '../types/types';
import {logger} from '../utils/logger';

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
 * Create a PhonePe payment order using the SDK (works for both test and production)
 */
export const createPaymentOrder = async (
  amount: number,
  bookingData: PaymentOrderData,
): Promise<PaymentOrderResponse> => {
  try {
    const merchantTransactionId = `booking_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // Redirect URL for PhonePe callback (same for both test and production)
    const redirectUrl = `${process.env.FRONTEND_DNS}/appointment?payment=callback&transaction_id=${merchantTransactionId}`;

    // Create MetaInfo with only the fields you want to show in PhonePe
    const metaInfo = MetaInfo.builder()
      .udf1(bookingData.name || '') // Patient Name
      .udf2(bookingData.date || '') // Appointment Date
      .udf3(bookingData.phone || '') // Phone Number
      .udf4('') // Empty - not used
      .udf5('') // Empty - not used
      .build();

    // Create PhonePe payment request using the SDK with custom fields
    const payRequest = StandardCheckoutPayRequest.builder()
      .merchantOrderId(merchantTransactionId)
      .amount(amount * 100) // Convert to paise
      .redirectUrl(redirectUrl)
      .message(`ENT Appointment - ${bookingData.name} - ${bookingData.date}`) // Add descriptive message
      .metaInfo(metaInfo) // Add custom fields via MetaInfo
      .expireAfter(15) // 15 minutes expiry
      .build();

    // Call PhonePe SDK - it handles test vs production automatically
    const response = await phonePeClient.pay(payRequest);

    return {
      success: true,
      order: {
        id: merchantTransactionId,
        amount: amount * 100,
        currency: 'INR',
        redirectUrl: response.redirectUrl, // Real PhonePe URL (test or production)
      },
    };
  } catch (error) {
    logger.error('Error creating PhonePe order:', error);
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Error stack:', error.stack);
    }
    return {success: false, error: 'Failed to create payment order'};
  }
};

/**
 * Check PhonePe payment status using SDK (works for both test and production)
 */
export const checkPaymentStatus = async (
  merchantTransactionId: string,
): Promise<PaymentStatusResponse> => {
  try {
    // Use PhonePe SDK for both test and production
    const response = await phonePeClient.getOrderStatus(merchantTransactionId);

    // Map PhonePe status to our internal status
    let status = 'PENDING';
    if (response.state === 'COMPLETED') {
      status = 'SUCCESS';
    } else if (response.state === 'FAILED' || response.state === 'CANCELLED') {
      status = 'FAILED';
    }

    return {
      success: true,
      payment: {
        id: merchantTransactionId,
        amount: response.amount || 40000,
        status: status,
        method: response.paymentDetails?.[0]?.paymentMode || 'UPI',
        transactionId:
          response.paymentDetails?.[0]?.transactionId ||
          `phonepe_${merchantTransactionId}`,
        responseCode: response.state,
        responseCodeDescription: `Payment ${response.state.toLowerCase()}`,
      },
    };
  } catch (error) {
    logger.error('Error checking PhonePe payment status:', error);
    return {success: false, error: 'Failed to check payment status'};
  }
};

/**
 * Initiate PhonePe refund using SDK (works for both test and production)
 */
export const initiateRefund = async (
  originalTransactionId: string,
  refundAmount: number,
  _reason: string = 'Booking slot unavailable',
) => {
  try {
    const refundTransactionId = `refund_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // Create refund request using PhonePe SDK
    const refundRequest = RefundRequest.builder()
      .originalMerchantOrderId(originalTransactionId)
      .merchantRefundId(refundTransactionId)
      .amount(refundAmount)
      .build();

    // Call PhonePe SDK refund
    const response = await phonePeClient.refund(refundRequest);

    return {
      success: true,
      refund: {
        refundId: refundTransactionId,
        originalTransactionId: originalTransactionId,
        amount: refundAmount,
        status: response.state || 'INITIATED',
      },
    };
  } catch (error) {
    logger.error('Error initiating PhonePe refund:', error);
    return {success: false, error: 'Failed to initiate refund'};
  }
};
