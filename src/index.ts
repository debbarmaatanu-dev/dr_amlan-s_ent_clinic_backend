import express = require('express');
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

// Custom CORS middleware for better security
const customCors = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const origin = req.headers.origin;
  const url = req.url || '';

  // Allow requests without origin ONLY for webhook endpoints
  if (!origin) {
    if (
      url.startsWith('/payment/webhook') ||
      url.startsWith('/webhook-health')
    ) {
      logger.log('[CORS] Allowing webhook request with no origin');
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With',
      );
      next();
      return;
    } else {
      logger.log('[CORS] Rejecting non-webhook request with no origin');
      res.status(403).json({error: 'CORS Not Allowed - No Origin'});
      return;
    }
  }

  // Check if origin is in allowed list
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With',
    );
    next();
  } else {
    logger.error('[CORS] Unauthorized attempt from:', origin);
    logger.log('[CORS] Allowed origins:', allowedOrigins);
    res.status(403).json({error: 'CORS Not Allowed'});
  }
};

// Configure Express to trust Vercel's proxy
app.set('trust proxy', 1);

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
app.use(customCors);

// Apply global security middlewares
app.use(securityLogger);
app.use(geoLocationBlock);

app.get('/', (_, res) => {
  try {
    res.send('Firebase Auth Backend Running on Vercel!');
  } catch (error) {
    console.error('Root endpoint error:', error);
    res
      .status(500)
      .json({error: 'Root endpoint failed', details: (error as Error).message});
  }
});

app.get('/test', (_, res) => {
  res.json({
    message: 'Test endpoint working',
    env: process.env.NODE_ENV,
    hasFirebaseProjectId: !!process.env.FIREBASE_PROJECT_ID,
  });
});

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

// Test endpoint for webhook health check (no auth required)
app.get('/webhook-health', (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Webhook endpoint is healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      phonepeEnv: process.env.PHONEPE_ENV,
      ip: req.ip,
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Health check failed',
    });
  }
});

// For Vercel serverless deployment
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => logger.log(`Server running on port ${PORT}`));
}

export default app;
