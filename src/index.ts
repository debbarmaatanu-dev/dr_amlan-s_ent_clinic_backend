import express = require('express');
import cors = require('cors');
import helmet from 'helmet';
import dotenv = require('dotenv');
import protectedRoutes = require('./routes/protected');
import cloudinaryRoutes = require('./routes/cloudinaryRoutes');
import paymentRoutes = require('./routes/paymentRoutes');
import appointmentRoutes = require('./routes/appointmentRoutes');
import webhookRoutes = require('./routes/webhookRoutes');
import {generalRateLimiter, paymentRateLimiter} from './middleware/rateLimiter';
import {
  geoLocationBlock,
  validateRequestSize,
  securityLogger,
} from './middleware/security';
import {logger} from './utils/logger';

dotenv.config();

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_LOCAL,
  process.env.FRONTEND_VERCEL,
  process.env.FRONTEND_DNS,
  process.env.FRONTEND_ROOT,
].filter(Boolean); // Remove any undefined values

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Strict origin checking - no requests without origin allowed
    if (!origin) {
      logger.log('[CORS] Rejecting request with no origin');
      callback(new Error('CORS Not Allowed - No Origin'));
      return;
    }

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('[CORS] Unauthorized attempt from:', origin);
      logger.log('[CORS] Allowed origins:', allowedOrigins);
      callback(new Error('CORS Not Allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'], // Removed PUT, DELETE as not needed
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP for API-only backend
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);
app.use(cors(corsOptions));

// Apply global security middlewares
app.use(securityLogger);
app.use(geoLocationBlock);

app.get('/', (_, res) => res.send('Firebase Auth Backend Running on Vercel!'));

// Health check endpoint for Vercel
app.get('/health', (_, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Apply route-specific body size limits and rate limiters
app.use(
  '/api/protected',
  validateRequestSize(500), // 500KB max
  express.json({limit: '500kb'}),
  generalRateLimiter,
  protectedRoutes,
);
app.use(
  '/api/cloudinary',
  validateRequestSize(5120), // 5MB max
  express.json({limit: '5mb'}),
  generalRateLimiter,
  cloudinaryRoutes,
);
app.use(
  '/api/payment',
  validateRequestSize(2), // 2KB max (increased from 1KB for payment data)
  express.json({limit: '100kb'}),
  paymentRateLimiter,
  paymentRoutes,
);
app.use(
  '/api/appointment',
  validateRequestSize(2), // 2KB max for appointment search
  express.json({limit: '100kb'}),
  generalRateLimiter,
  appointmentRoutes,
);
// Webhook route to match PhonePe dashboard configuration exactly
app.use(
  '/payment',
  validateRequestSize(10), // 10KB max for webhook data
  express.json({limit: '1mb'}),
  webhookRoutes,
);

// For Vercel serverless deployment
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => logger.log(`Server running on port ${PORT}`));
}

export = app;
