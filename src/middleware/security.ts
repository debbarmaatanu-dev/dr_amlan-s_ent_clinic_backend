import {Request, Response, NextFunction} from 'express';
import {logger} from '../utils/logger';

/**
 * Geolocation middleware to block non-Indian requests
 * Works with Cloudflare's CF-IPCountry header or fallback IP geolocation
 */
export const geoLocationBlock = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    // Check Cloudflare country header (if using Cloudflare)
    const cfCountry = req.headers['cf-ipcountry'] as string;

    // Check other common geolocation headers
    const xCountry = req.headers['x-country-code'] as string;
    const xRealCountry = req.headers['x-real-country'] as string;

    // Get country from any available header
    const country = cfCountry || xCountry || xRealCountry;

    // If country is detected and it's not India, block the request
    if (country && country.toUpperCase() !== 'IN') {
      logger.log(
        `[GEO-BLOCK] Blocked request from country: ${country}, IP: ${req.ip}`,
      );
      res.status(403).json({
        success: false,
        error:
          'Service not authorized in this country. This service is only available in India.',
        code: 'GEO_RESTRICTED',
      });
      return;
    }

    // If no country header is present, allow the request
    // (This handles local development and cases where geolocation isn't available)
    logger.log(
      `[GEO-CHECK] Request allowed - Country: ${country || 'Unknown'}, IP: ${req.ip}`,
    );
    next();
  } catch (error) {
    console.error('[GEO-BLOCK] Error in geolocation check:', error);
    // On error, allow the request to proceed (fail-open for availability)
    next();
  }
};

/**
 * Request size validation middleware
 * Validates request body size before processing
 */
export const validateRequestSize = (maxSizeKB: number) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const contentLength = parseInt(req.headers['content-length'] || '0');
      const maxSizeBytes = maxSizeKB * 1024;

      if (contentLength > maxSizeBytes) {
        logger.log(
          `[SIZE-BLOCK] Request too large: ${contentLength} bytes (max: ${maxSizeBytes} bytes), IP: ${req.ip}`,
        );
        res.status(413).json({
          success: false,
          error: `Request too large. Maximum allowed size is ${maxSizeKB}KB.`,
          code: 'REQUEST_TOO_LARGE',
        });
        return;
      }

      logger.log(
        `[SIZE-CHECK] Request size OK: ${contentLength} bytes (max: ${maxSizeBytes} bytes)`,
      );
      next();
    } catch (error) {
      console.error('[SIZE-CHECK] Error in request size validation:', error);
      // On error, allow the request to proceed
      next();
    }
  };
};

/**
 * Enhanced security logging middleware
 * Logs security-related events for monitoring
 */
export const securityLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startTime = Date.now();

  // Log request details
  logger.log(
    `[SECURITY] ${req.method} ${req.path} - IP: ${req.ip} - User-Agent: ${req.headers['user-agent']?.substring(0, 100)}`,
  );

  // Override res.json to log responses
  const originalJson = res.json;
  res.json = function (body: {
    success?: boolean;
    error?: string;
    [key: string]: unknown;
  }) {
    const duration = Date.now() - startTime;

    // Log security-relevant responses
    if (body && (body.success === false || res.statusCode >= 400)) {
      logger.log(
        `[SECURITY] Response ${res.statusCode} in ${duration}ms - Error: ${body.error || 'Unknown'} - IP: ${req.ip}`,
      );
    }

    return originalJson.call(this, body);
  };

  next();
};
