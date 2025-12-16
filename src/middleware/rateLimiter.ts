import rateLimit from 'express-rate-limit';

// Lightweight rate limiter for small clinic
// Per function instance protection (sufficient for 40 bookings/month)
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Reasonable limit per instance
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Custom key generator for serverless environment
  keyGenerator: req => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

// Payment route protection (most critical)
export const paymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Strict limit for payments (per instance)
  message: 'Too many payment requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Custom key generator for serverless environment
  keyGenerator: req => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});
