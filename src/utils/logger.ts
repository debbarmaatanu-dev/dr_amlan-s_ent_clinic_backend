/**
 * Production-safe logging utility
 * Only logs errors in production, full logging in development
 * Optimized for serverless environments (Vercel)
 */

const isProduction = process.env.NODE_ENV === 'production';
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

export const logger = {
  // Always log errors regardless of environment
  error: (...args: unknown[]) => {
    console.error(...args);
  },

  // Only log in development or serverless (for debugging)
  log: (...args: unknown[]) => {
    if (!isProduction || isServerless) {
      console.log(...args);
    }
  },

  // Only log in development
  info: (...args: unknown[]) => {
    if (!isProduction) {
      console.info(...args);
    }
  },

  // Only log in development
  warn: (...args: unknown[]) => {
    if (!isProduction) {
      console.warn(...args);
    }
  },

  // Only log in development
  debug: (...args: unknown[]) => {
    if (!isProduction) {
      console.debug(...args);
    }
  },
};
