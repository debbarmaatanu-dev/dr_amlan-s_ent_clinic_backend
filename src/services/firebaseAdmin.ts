import admin = require('firebase-admin');
import dotenv = require('dotenv');

dotenv.config();

// Initialize Firebase Admin only if not already initialized
if (!admin.apps.length) {
  try {
    // Handle private key formatting for Vercel deployment
    let privateKey =
      process.env.FIREBASE_PRIVATE_KEY_BASE64 ||
      process.env.FIREBASE_PRIVATE_KEY;

    // Try Base64 decoding first (for Vercel deployment)
    if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
      try {
        privateKey = Buffer.from(
          process.env.FIREBASE_PRIVATE_KEY_BASE64,
          'base64',
        ).toString('utf8');
      } catch (e) {
        throw new Error('Failed to decode base64 private key');
      }
    } else if (privateKey) {
      // Fallback to regular processing for local development
      privateKey = privateKey.replace(/^["']|["']$/g, '');
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (privateKey) {
      // Ensure proper PEM format
      if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('Invalid private key format - missing BEGIN marker');
      }
      if (!privateKey.endsWith('-----END PRIVATE KEY-----')) {
        throw new Error('Invalid private key format - missing END marker');
      }
    }

    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    };

    // Validate required fields
    if (
      !serviceAccount.projectId ||
      !serviceAccount.clientEmail ||
      !serviceAccount.privateKey
    ) {
      throw new Error('Missing required Firebase service account credentials');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    // Configure Firestore with safer settings for serverless
    const firestore = admin.firestore();
    firestore.settings({
      preferRest: true,
      ssl: true,
      ignoreUndefinedProperties: true,
    });

    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    console.error(
      'Project ID:',
      process.env.FIREBASE_PROJECT_ID ? 'Present' : 'Missing',
    );
    console.error(
      'Client Email:',
      process.env.FIREBASE_CLIENT_EMAIL ? 'Present' : 'Missing',
    );
    console.error(
      'Private Key:',
      process.env.FIREBASE_PRIVATE_KEY ? 'Present' : 'Missing',
    );
    throw error;
  }
}

export const adminAuth = admin.auth();
