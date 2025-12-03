import express = require('express');
import {Request, Response} from 'express';
import {authenticateFirebaseToken} from '../middleware/auth';
import {updateText} from '../controllers/updateText';
import {addDocument} from '../controllers/addDocument';
import {updateDocument} from '../controllers/updateDocument';
import {deleteDocument} from '../controllers/deleteDocument';

const router = express.Router();

router.get(
  '/',
  authenticateFirebaseToken,
  (req: Request, res: Response): void => {
    if (!req.user) {
      res.status(401).json({message: 'Unauthorized'});
      return;
    }
    res.json({
      message: `Hello ${req.user.name}, you're authenticated!`,
      success: true,
    });
  },
);

router.post('/updateText', authenticateFirebaseToken, updateText);
router.post('/addDocument', authenticateFirebaseToken, addDocument);
router.post('/updateDocument', authenticateFirebaseToken, updateDocument);
router.post('/deleteDocument', authenticateFirebaseToken, deleteDocument);

export = router;
