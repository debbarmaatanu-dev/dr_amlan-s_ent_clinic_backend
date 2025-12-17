/**
 * Production-safe logging utility
 * Logs are visible in Vercel backend logs for debugging
 * Optimized for serverless environments (Vercel)
 */

const isProduction = process.env.NODE_ENV === 'production';

export const logger = {
  // Always log errors regardless of environment
  error: (...args: unknown[]) => {
    console.error(...args);
  },

  // Always log in Vercel (for debugging), only in development otherwise
  log: (...args: unknown[]) => {
    console.log(...args);
  },

  // Always log in Vercel (for debugging), only in development otherwise
  info: (...args: unknown[]) => {
    console.info(...args);
  },

  // Always log in Vercel (for debugging), only in development otherwise
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },

  // Only log in development (debug is too verbose for production)
  debug: (...args: unknown[]) => {
    if (!isProduction) {
      console.debug(...args);
    }
  },
};
