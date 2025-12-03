import {Request, Response} from 'express';
import admin = require('firebase-admin');

export const updateDocument = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const {collectionName, docId, documentData} = req.body;

  if (!collectionName || !docId || !documentData) {
    console.error('[updateDocument] Missing required fields');
    return res.status(400).json({
      success: false,
      message: 'collectionName, docId, and documentData are required',
    });
  }

  try {
    const db = admin.firestore();

    const querySnapshot = await db
      .collection(collectionName)
      .where('id', '==', docId)
      .get();

    if (querySnapshot.empty) {
      console.error('[updateDocument] No document found with id:', docId);
      return res.status(404).json({
        success: false,
        message: 'No document found with this id',
      });
    }

    const docRef = querySnapshot.docs[0].ref;

    await docRef.update({
      ...documentData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      message: 'Document updated successfully',
    });
  } catch (error) {
    console.error('[updateDocument] Server error:', error);
    return res
      .status(500)
      .json({success: false, message: 'Server error', error});
  }
};
