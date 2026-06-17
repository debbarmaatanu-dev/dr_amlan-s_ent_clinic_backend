/**
 * Clinic schedule — backend mirror of frontend constants/clinicSchedule.ts
 * Keep logic in sync when changing booking rules.
 */

const SAME_DAY_EVENING_CUTOFF_HOUR = 19;
/** Same-day Sunday booking stops at noon; clinic session runs until 1:00 PM */
const SAME_DAY_SUNDAY_CUTOFF_HOUR = 12;
const BOOKING_ADVANCE_DAYS = 10;

function parseDateOnly(dateString: string): Date {
  return new Date(dateString + 'T00:00:00');
}

function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

function isWednesday(date: Date): boolean {
  return date.getDay() === 3;
}

function getSaturdayOccurrenceInMonth(date: Date): number | null {
  if (date.getDay() !== 6) return null;
  let count = 0;
  for (let d = 1; d <= date.getDate(); d++) {
    const probe = new Date(date.getFullYear(), date.getMonth(), d);
    if (probe.getDay() === 6) count++;
  }
  return count;
}

function isSecondOrFourthSaturday(date: Date): boolean {
  const occurrence = getSaturdayOccurrenceInMonth(date);
  return occurrence === 2 || occurrence === 4;
}

function isScheduledClosureDay(date: Date): boolean {
  return isWednesday(date) || isSecondOrFourthSaturday(date);
}

function isEveningClinicDay(date: Date): boolean {
  if (isSunday(date) || isScheduledClosureDay(date)) return false;
  const day = date.getDay();
  return day >= 1 && day <= 6;
}

function isBookableClinicDay(date: Date): boolean {
  return isSunday(date) || isEveningClinicDay(date);
}

function getScheduledClosureReason(date: Date): string | null {
  if (isWednesday(date)) {
    return 'Clinic is closed every Wednesday';
  }
  if (isSecondOrFourthSaturday(date)) {
    return 'Clinic is closed on the 2nd and 4th Saturday of each month';
  }
  return null;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Server-side booking date validation (admin override checked separately).
 */
export function validateBookingDate(dateString: string): {
  isValid: boolean;
  error?: string;
} {
  const selectedDate = parseDateOnly(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (selectedDate < today) {
    return {
      isValid: false,
      error: 'Cannot book appointments for past dates',
    };
  }

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + BOOKING_ADVANCE_DAYS);

  if (selectedDate > maxDate) {
    return {
      isValid: false,
      error: `Appointments can only be booked up to ${BOOKING_ADVANCE_DAYS} days in advance`,
    };
  }

  const closureReason = getScheduledClosureReason(selectedDate);
  if (closureReason) {
    return {isValid: false, error: closureReason};
  }

  if (!isBookableClinicDay(selectedDate)) {
    return {
      isValid: false,
      error: 'Clinic is not open on this date',
    };
  }

  const now = new Date();
  if (isSameCalendarDay(selectedDate, now)) {
    if (isSunday(selectedDate)) {
      if (now.getHours() >= SAME_DAY_SUNDAY_CUTOFF_HOUR) {
        return {
          isValid: false,
          error: 'Bookings for today are closed after 12:00 PM on Sundays',
        };
      }
    } else if (now.getHours() >= SAME_DAY_EVENING_CUTOFF_HOUR) {
      return {
        isValid: false,
        error: 'Bookings for today are closed after 7:00 PM',
      };
    }
  }

  return {isValid: true};
}
