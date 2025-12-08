import Razorpay from 'razorpay';
import crypto from 'crypto';

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export {razorpay};

/**
 * Create a Razorpay payment order
 */
export const createPaymentOrder = async (
  amount: number,
  bookingData: {
    date: string;
    name: string;
    gender: string;
    age: number;
    phone: string;
  },
) => {
  try {
    const options = {
      amount: amount * 100, // Convert to paise (₹400 = 40000 paise)
      currency: 'INR',
      receipt: `booking_${Date.now()}`,
      notes: {
        date: bookingData.date,
        name: bookingData.name,
        gender: bookingData.gender,
        age: bookingData.age.toString(),
        phone: bookingData.phone,
      },
    };

    const order = await razorpay.orders.create(options);
    console.log('Razorpay order created successfully:', order.id);
    return {success: true, order};
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    // Log more details about the error
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return {success: false, error: 'Failed to create payment order'};
  }
};

/**
 * Verify Razorpay payment signature
 */
export const verifyPaymentSignature = (
  orderId: string,
  paymentId: string,
  signature: string,
): boolean => {
  try {
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(body.toString())
      .digest('hex');

    return expectedSignature === signature;
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
};

/**
 * Fetch payment details from Razorpay
 */
export const fetchPaymentDetails = async (paymentId: string) => {
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return {
      success: true,
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method, // upi, card, netbanking, wallet
        vpa: payment.vpa, // UPI ID
        bank: payment.bank, // Bank name for netbanking
        wallet: payment.wallet, // Wallet name
        cardId: payment.card_id, // Card ID if card payment
        email: payment.email,
        contact: payment.contact,
        fee: payment.fee, // Razorpay fee
        tax: payment.tax,
        createdAt: payment.created_at,
      },
    };
  } catch (error) {
    console.error('Error fetching payment details:', error);
    return {success: false, error: 'Failed to fetch payment details'};
  }
};
