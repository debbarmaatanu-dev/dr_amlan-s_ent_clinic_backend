// Legacy CMS API — routes commented out in protected.ts (not used by frontend).
import {Request, Response} from 'express';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../services/firebaseAdmin.js';

export const addDocument = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const {collectionName, documentData} = req.body;

  if (!collectionName || !documentData) {
    console.error('[addDocument] Missing required fields');
    return res.status(400).json({
      success: false,
      message: 'collectionName and documentData are required',
    });
  }

  try {
    const docRef = await db.collection(collectionName).add({
      ...documentData,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const docSnap = await docRef.get();
    const createdData = {
      id: docRef.id,
      ...docSnap.data(),
    };

    return res.json({
      success: true,
      message: 'Document added successfully',
      data: createdData,
    });
  } catch (error) {
    console.error('[addDocument] Server error:', error);
    return res
      .status(500)
      .json({success: false, message: 'Server error', error});
  }
};
