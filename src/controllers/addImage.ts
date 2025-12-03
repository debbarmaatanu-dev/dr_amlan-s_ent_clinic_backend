import {Request, Response} from 'express';
import multer = require('multer');
import streamifier = require('streamifier');
import cloudinary = require('../services/cloudinary');

const storage = multer.memoryStorage();
const upload = multer({storage}).single('file');

export const addImage = (req: Request, res: Response): void => {
  upload(req, res, async function (err): Promise<void> {
    if (err) {
      console.error('[addImage] Multer upload error:', err);
      res
        .status(500)
        .json({success: false, message: 'Upload failed', error: err});
      return;
    }
    const {folderName} = req.body;
    const fileBuffer = req.file?.buffer;

    if (!fileBuffer || !folderName) {
      console.error('[addImage] Missing required fields');
      res
        .status(400)
        .json({success: false, message: 'File and folder name is required'});
      return;
    }

    try {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          format: 'jpg',
          folder: folderName,
          transformation: [{quality: 90}],
        },
        (error, result) => {
          if (error) {
            console.error('[addImage] Upload error:', error);
            res
              .status(500)
              .json({success: false, message: 'Upload error', error});
            return;
          }

          res.json({
            success: true,
            message: 'Image uploaded successfully',
            asset: {
              public_id: result?.public_id,
              url: result?.secure_url,
            },
          });
        },
      );

      streamifier.createReadStream(fileBuffer).pipe(uploadStream);
    } catch (error) {
      console.error('[addImage] Server error:', error);
      res.status(500).json({success: false, message: 'Server error', error});
    }
  });
};
