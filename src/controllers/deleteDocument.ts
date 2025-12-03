import {Request, Response} from 'express';
import admin = require('firebase-admin');

export const deleteDocument = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const {collectionName, docId} = req.body;

  if (!collectionName || !docId) {
    console.error('[deleteDocument] Missing required fields');
    return res.status(400).json({
      success: false,
      message: 'collectionName and docId are required',
    });
  }

  try {
    const db = admin.firestore();

    const querySnapshot = await db
      .collection(collectionName)
      .where('id', '==', docId)
      .get();

    if (querySnapshot.empty) {
      console.error('[deleteDocument] No document found with id:', docId);
      return res.status(404).json({
        success: false,
        message: 'No document found with this id',
      });
    }

    const docRef = querySnapshot.docs[0].ref;
    await docRef.delete();

    return res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('[deleteDocument] Server error:', error);
    return res
      .status(500)
      .json({success: false, message: 'Server error', error});
  }
};
