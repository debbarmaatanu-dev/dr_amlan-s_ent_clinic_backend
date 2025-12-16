import admin = require('firebase-admin');
import dotenv = require('dotenv');

dotenv.config();

// Initialize Firebase Admin only if not already initialized
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
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
    throw error;
  }
}

export const adminAuth = admin.auth();
