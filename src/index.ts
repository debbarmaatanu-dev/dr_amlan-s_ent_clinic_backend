import express = require('express');
import cors = require('cors');
import helmet from 'helmet';
import dotenv = require('dotenv');
import protectedRoutes = require('./routes/protected');
import cloudinaryRoutes = require('./routes/cloudinaryRoutes');
import paymentRoutes = require('./routes/paymentRoutes');
import {generalRateLimiter, paymentRateLimiter} from './middleware/rateLimiter';

dotenv.config();

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_LOCAL,
  process.env.FRONTEND_VERCEL,
  process.env.FRONTEND_DNS,
  process.env.FRONTEND_ROOT,
];

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('[CORS] Unauthorized attempt from:', origin);
      callback(new Error('CORS Not Allowed'));
    }
  },
  credentials: true,
};

app.use(helmet());
app.use(cors(corsOptions));

app.get('/', (_, res) => res.send('Firebase Auth Backend Running!'));

// Apply route-specific body size limits and rate limiters
app.use(
  '/api/protected',
  express.json({limit: '500kb'}),
  generalRateLimiter,
  protectedRoutes,
);
app.use(
  '/api/cloudinary',
  express.json({limit: '5mb'}),
  generalRateLimiter,
  cloudinaryRoutes,
);
app.use(
  '/api/payment',
  express.json({limit: '100kb'}),
  paymentRateLimiter,
  paymentRoutes,
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export = app;
