import express = require('express');
import {Request, Response} from 'express';
import admin = require('firebase-admin');
import {authenticateFirebaseToken} from '../middleware/auth';
import {updateText} from '../controllers/updateText';
import {addDocument} from '../controllers/addDocument';
import {updateDocument} from '../controllers/updateDocument';
import {deleteDocument} from '../controllers/deleteDocument';
import type {BookingData, ClinicControl} from '../types/types';
import {logger} from '../utils/logger';

const db = admin.firestore();

const router = express.Router();

router.get(
  '/',
  authenticateFirebaseToken,
  (req: Request, res: Response): void => {
    if (!req.user) {
      res.status(401).json({message: 'Unauthorized'});
      return;
    }
    res.json({
      message: `Hello ${req.user.name}, you're authenticated!`,
      success: true,
    });
  },
);

router.post('/updateText', authenticateFirebaseToken, updateText);
router.post('/addDocument', authenticateFirebaseToken, addDocument);
router.post('/updateDocument', authenticateFirebaseToken, updateDocument);
router.post('/deleteDocument', authenticateFirebaseToken, deleteDocument);

/**
 * Format date from YYYY-MM-DD to DD-MM-YYYY for Firestore document ID
 */
const formatDateToDocId = (dateString: string): string => {
  const [year, month, day] = dateString.split('-');
  return `${day}-${month}-${year}`;
};

/**
 * GET /api/protected/bookings/:date
 * Get all bookings for a specific date (Admin only)
 */
router.get(
  '/bookings/:date',
  authenticateFirebaseToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is admin
      const allowedAdminEmails = [
        process.env.ADMIN_EMAIL1,
        process.env.ADMIN_EMAIL2,
      ].filter(Boolean);

      if (!allowedAdminEmails.includes(req.user.email)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      const {date} = req.params;

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD',
        });
      }

      // Get bookings from Firestore
      const docId = formatDateToDocId(date);
      const docRef = db.collection('appointment_bookings').doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.json({
          success: true,
          bookings: [],
          message: 'No bookings found for this date',
        });
      }

      const data = docSnap.data();
      const bookings: BookingData[] = data?.bookings || [];

      // Sort bookings by slot number
      const sortedBookings: BookingData[] = bookings.sort(
        (a: BookingData, b: BookingData) => a.slotNumber - b.slotNumber,
      );

      // Check refund status for each booking
      const bookingsWithStatus = await Promise.all(
        sortedBookings.map(async (booking: BookingData) => {
          let paymentStatus = 'successful';
          let refundInfo = null;

          try {
            // Check if there's a refund record for this booking
            const refundSnapshot = await db
              .collection('refunds')
              .where('originalTransactionId', '==', booking.orderId)
              .limit(1)
              .get();

            if (!refundSnapshot.empty) {
              const refundData = refundSnapshot.docs[0].data();
              paymentStatus = 'refund_initiated';
              refundInfo = {
                refundId: refundData.refundId,
                status: refundData.status,
                reason: refundData.reason,
              };
            } else {
              // Check if there's a failed refund record
              const failedRefundDoc = await db
                .collection('failed_refunds')
                .doc(booking.orderId)
                .get();

              if (failedRefundDoc.exists) {
                paymentStatus = 'refund_pending';
                refundInfo = {
                  reason:
                    failedRefundDoc.data()?.reason ||
                    'Refund processing failed',
                  status: 'manual_required',
                };
              }
            }
          } catch (error) {
            console.error(
              'Error checking refund status for booking:',
              booking.orderId,
              error,
            );
          }

          return {
            slotNumber: booking.slotNumber,
            name: booking.name,
            phone: booking.phone,
            date: date,
            gender: booking.gender,
            age: booking.age,
            amount: booking.amount,
            paymentId: booking.paymentId,
            orderId: booking.orderId,
            paymentMethod: booking.paymentMethod || 'UPI',
            timestamp: booking.timestamp,
            paymentStatus,
            refundInfo,
          };
        }),
      );

      // Return bookings data with payment status
      return res.json({
        success: true,
        bookings: bookingsWithStatus,
        totalBookings: sortedBookings.length,
        date: date,
      });
    } catch (error) {
      console.error('Error fetching admin bookings:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  },
);

/**
 * GET /api/protected/clinic-status
 * Get current clinic control status (Admin only)
 */
router.get(
  '/clinic-status',
  authenticateFirebaseToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is admin
      const allowedAdminEmails = [
        process.env.ADMIN_EMAIL1,
        process.env.ADMIN_EMAIL2,
      ].filter(Boolean);

      if (!allowedAdminEmails.includes(req.user.email)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      // Get clinic control status
      const controlRef = db.collection('clinic_control').doc('status');
      const controlSnap = await controlRef.get();

      if (!controlSnap.exists) {
        return res.json({
          success: true,
          status: {
            isManuallyOverridden: false,
            message: 'Following default schedule',
          },
        });
      }

      const controlData = controlSnap.data() as ClinicControl;
      const today = new Date().toISOString().split('T')[0];

      // Check if current override is still active
      let isCurrentlyOverridden = false;
      if (controlData.isManuallyOverridden) {
        const closedFrom = controlData.closedFrom;
        const closedTill = controlData.closedTill;

        if (closedFrom && closedFrom <= today) {
          if (!closedTill || closedTill >= today) {
            isCurrentlyOverridden = true;
          }
        }
      }

      return res.json({
        success: true,
        status: {
          isManuallyOverridden: isCurrentlyOverridden,
          closedFrom: controlData.closedFrom,
          closedTill: controlData.closedTill,
        },
      });
    } catch (error) {
      console.error('Error fetching clinic status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  },
);

/**
 * POST /api/protected/control-clinic
 * Set clinic control dates (Admin only)
 */
router.post(
  '/control-clinic',
  authenticateFirebaseToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is admin
      const allowedAdminEmails = [
        process.env.ADMIN_EMAIL1,
        process.env.ADMIN_EMAIL2,
      ].filter(Boolean);

      if (!allowedAdminEmails.includes(req.user.email)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      const {closedFrom, closedTill} = req.body;

      // Validate required fields
      if (!closedFrom) {
        return res.status(400).json({
          success: false,
          error: 'closedFrom date is required',
        });
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(closedFrom)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid closedFrom date format. Use YYYY-MM-DD',
        });
      }

      if (closedTill && !dateRegex.test(closedTill)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid closedTill date format. Use YYYY-MM-DD',
        });
      }

      // Validate date logic
      if (closedTill && closedFrom > closedTill) {
        return res.status(400).json({
          success: false,
          error: 'closedTill must be after closedFrom',
        });
      }

      // Update clinic control
      const controlRef = db.collection('clinic_control').doc('status');
      const controlData: ClinicControl = {
        isManuallyOverridden: true,
        closedFrom,
        closedTill: closedTill || undefined,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await controlRef.set(controlData);

      logger.log(
        `[ADMIN] Clinic closed by ${req.user.email} from ${closedFrom} to ${closedTill || 'indefinite'}`,
      );

      return res.json({
        success: true,
        message: 'Clinic control updated successfully',
      });
    } catch (error) {
      console.error('Error updating clinic control:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  },
);

/**
 * GET /api/protected/failed-refunds
 * Get failed refunds that need manual processing (Admin only)
 */
router.get(
  '/failed-refunds',
  authenticateFirebaseToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is admin
      const allowedAdminEmails = [
        process.env.ADMIN_EMAIL1,
        process.env.ADMIN_EMAIL2,
      ].filter(Boolean);

      if (!allowedAdminEmails.includes(req.user.email)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      // Get failed refunds
      const failedRefundsRef = db.collection('failed_refunds');
      const snapshot = await failedRefundsRef
        .where('status', '==', 'manual_required')
        .orderBy('createdAt', 'desc')
        .get();

      const failedRefunds = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return res.json({
        success: true,
        failedRefunds,
        count: failedRefunds.length,
      });
    } catch (error) {
      console.error('Error fetching failed refunds:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  },
);

/**
 * POST /api/protected/turn-on-clinic
 * Turn on clinic bookings (remove manual override) (Admin only)
 */
router.post(
  '/turn-on-clinic',
  authenticateFirebaseToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is admin
      const allowedAdminEmails = [
        process.env.ADMIN_EMAIL1,
        process.env.ADMIN_EMAIL2,
      ].filter(Boolean);

      if (!allowedAdminEmails.includes(req.user.email)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      // Remove clinic control (turn on)
      const controlRef = db.collection('clinic_control').doc('status');
      const controlData: ClinicControl = {
        isManuallyOverridden: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await controlRef.set(controlData);

      logger.log(`[ADMIN] Clinic turned on by ${req.user.email}`);

      return res.json({
        success: true,
        message: 'Clinic bookings turned on successfully',
      });
    } catch (error) {
      console.error('Error turning on clinic:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  },
);

export = router;
