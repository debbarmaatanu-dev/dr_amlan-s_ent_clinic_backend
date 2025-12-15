import admin = require('firebase-admin');

/**
 * Booking data structure stored in Firestore
 */
export interface BookingData {
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
  timestamp: string; // ISO timestamp string
}

/**
 * Pending booking data structure (before payment confirmation)
 */
export interface PendingBooking {
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
 * Payment session data structure
 */
export interface PaymentSession {
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
 * Refund record data structure
 */
export interface RefundRecord {
  refundId: string;
  originalTransactionId: string;
  merchantTransactionId: string;
  amount: number;
  reason: string;
  status: 'initiated' | 'completed' | 'failed';
  bookingData: RefundBookingData;
  createdAt: admin.firestore.FieldValue;
  completedAt?: admin.firestore.FieldValue;
}

/**
 * PhonePe payment order creation data
 */
export interface PaymentOrderData {
  date: string;
  name: string;
  gender: string;
  age: number;
  phone: string;
}

/**
 * Booking creation data (for pending bookings)
 */
export interface BookingCreationData {
  date: string;
  name: string;
  gender: string;
  age: number;
  phone: string;
  amount: number;
}

/**
 * Refund booking data (minimal booking info for refunds)
 */
export interface RefundBookingData {
  date: string;
  name: string;
  phone: string;
  slotNumber?: number;
}

/**
 * PhonePe payment response structure
 */
export interface PaymentOrderResponse {
  success: boolean;
  order?: {
    id: string;
    amount: number;
    currency: string;
    redirectUrl: string;
  };
  error?: string;
}

/**
 * PhonePe payment status response structure
 */
export interface PaymentStatusResponse {
  success: boolean;
  payment?: {
    id: string;
    amount: number;
    status: string;
    method: string;
    transactionId: string;
    responseCode: string;
    responseCodeDescription: string;
  };
  error?: string;
}

/**
 * API response structure for admin bookings
 */
export interface AdminBookingsResponse {
  success: boolean;
  bookings?: BookingData[];
  totalBookings?: number;
  date?: string;
  message?: string;
  error?: string;
}

/**
 * API response structure for appointment search
 */
export interface AppointmentSearchResponse {
  success: boolean;
  booking?: BookingData;
  message?: string;
  error?: string;
}

/**
 * Clinic control data structure
 */
export interface ClinicControl {
  isManuallyOverridden: boolean;
  closedFrom?: string; // YYYY-MM-DD format
  closedTill?: string; // YYYY-MM-DD format
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
}

/**
 * API response for clinic status
 */
export interface ClinicStatusResponse {
  success: boolean;
  status?: {
    isManuallyOverridden: boolean;
    closedFrom?: string;
    closedTill?: string;
    message?: string;
  };
  error?: string;
}
