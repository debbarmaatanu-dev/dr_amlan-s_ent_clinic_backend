import admin = require('firebase-admin');
import type {ClinicControl} from '../types/types';

const db = admin.firestore();

/**
 * Check if clinic bookings are currently allowed
 * Returns true if bookings are allowed, false if manually closed
 */
export const isClinicOpen = async (): Promise<{
  isOpen: boolean;
  reason?: string;
}> => {
  try {
    const controlRef = db.collection('clinic_control').doc('status');
    const controlSnap = await controlRef.get();

    if (!controlSnap.exists) {
      // No manual override, follow default schedule
      return {isOpen: true};
    }

    const controlData = controlSnap.data() as ClinicControl;

    if (!controlData.isManuallyOverridden) {
      // Manual override is off, follow default schedule
      return {isOpen: true};
    }

    // Check if current date falls within closed period
    const today = new Date().toISOString().split('T')[0];
    const closedFrom = controlData.closedFrom;
    const closedTill = controlData.closedTill;

    if (closedFrom && closedFrom <= today) {
      if (!closedTill || closedTill >= today) {
        // Currently in closed period
        return {
          isOpen: false,
          reason: closedTill
            ? `Clinic bookings are temporarily closed from ${closedFrom} to ${closedTill}`
            : `Clinic bookings are temporarily closed from ${closedFrom} until further notice`,
        };
      }
    }

    // Not in closed period
    return {isOpen: true};
  } catch (error) {
    console.error('Error checking clinic status:', error);
    // On error, allow bookings (fail-open)
    return {isOpen: true};
  }
};

/**
 * Get clinic status for display
 */
export const getClinicStatus = async (): Promise<{
  isManuallyOverridden: boolean;
  closedFrom?: string;
  closedTill?: string;
  displayMessage?: string;
}> => {
  try {
    const controlRef = db.collection('clinic_control').doc('status');
    const controlSnap = await controlRef.get();

    if (!controlSnap.exists) {
      return {isManuallyOverridden: false};
    }

    const controlData = controlSnap.data() as ClinicControl;

    if (!controlData.isManuallyOverridden) {
      return {isManuallyOverridden: false};
    }

    const today = new Date().toISOString().split('T')[0];
    const closedFrom = controlData.closedFrom;
    const closedTill = controlData.closedTill;

    // Check if currently in closed period
    if (closedFrom && closedFrom <= today) {
      if (!closedTill || closedTill >= today) {
        const displayMessage = closedTill
          ? `Clinic bookings are temporarily closed until ${closedTill}`
          : 'Clinic bookings are temporarily closed until further notice';

        return {
          isManuallyOverridden: true,
          closedFrom,
          closedTill,
          displayMessage,
        };
      }
    }

    return {isManuallyOverridden: false};
  } catch (error) {
    console.error('Error getting clinic status:', error);
    return {isManuallyOverridden: false};
  }
};
