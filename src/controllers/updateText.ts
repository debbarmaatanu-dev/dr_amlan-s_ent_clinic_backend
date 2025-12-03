import {Request, Response} from 'express';
import admin = require('firebase-admin');

export const updateText = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const {docId, text, collectionName} = req.body;

  if (!docId || !text || !collectionName) {
    console.error('[updateText] Missing required fields');
    return res.status(400).json({
      success: false,
      message: 'docId, text, and collectionName are required',
    });
  }

  try {
    const db = admin.firestore();

    const querySnapshot = await db
      .collection(collectionName)
      .where('id', '==', docId)
      .get();

    if (querySnapshot.empty) {
      console.error('[updateText] No document found with id:', docId);
      return res.status(404).json({
        success: false,
        message: 'No document found with this id',
      });
    }

    const docRef = querySnapshot.docs[0].ref;

    const updateField =
      collectionName === 'collegeResources' ? {url: text} : {text: text};

    await docRef.update(updateField);

    return res.json({
      success: true,
      message:
        collectionName === 'collegeResources'
          ? 'URL updated successfully'
          : 'Text updated successfully',
    });
  } catch (error) {
    console.error('[updateText] Server error:', error);
    return res
      .status(500)
      .json({success: false, message: 'Server error', error});
  }
};
