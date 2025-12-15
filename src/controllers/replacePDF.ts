import {Request, Response} from 'express';
import multer = require('multer');
import streamifier = require('streamifier');
import cloudinary = require('../services/cloudinary');
import {logger} from '../utils/logger';

const storage = multer.memoryStorage();
const upload = multer({storage}).single('file');

export const replacePDF = (req: Request, res: Response): void => {
  upload(req, res, async function (err): Promise<void> {
    if (err) {
      console.error('[replacePDF] Multer error:', err);
      res
        .status(500)
        .json({success: false, message: 'PDF Upload failed', error: err});
      return;
    }

    const {public_id, folderName} = req.body;
    const fileBuffer = req.file?.buffer;

    if (!public_id || !fileBuffer || !folderName) {
      console.error('[replacePDF] Missing required fields');
      res.status(400).json({
        success: false,
        message: 'public_id, foldername and file are required',
      });
      return;
    }

    try {
      try {
        await Promise.race([
          cloudinary.uploader.destroy(public_id, {resource_type: 'image'}),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Delete timeout')), 10000),
          ),
        ]);
      } catch (err) {
        logger.error(err);
        try {
          await Promise.race([
            cloudinary.uploader.destroy(public_id, {resource_type: 'raw'}),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Delete timeout')), 10000),
            ),
          ]);
        } catch (_rawErr) {
          logger.error(_rawErr);
        }
      }

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          format: 'pdf',
          folder: folderName,
          transformation: [{quality: 90}],
        },
        (error, result) => {
          if (error) {
            console.error('[replacePDF] Cloudinary upload error:', error);
            res
              .status(500)
              .json({success: false, message: 'PDF EDIT error', error});
            return;
          }

          res.json({
            success: true,
            message: 'PDF replaced with new upload',
            asset: {
              public_id: result?.public_id,
              url: result?.secure_url,
            },
          });
        },
      );

      streamifier.createReadStream(fileBuffer).pipe(uploadStream);
    } catch (error) {
      console.error('[replacePDF] Server error:', error);
      res.status(500).json({success: false, message: 'Server error', error});
    }
  });
};
