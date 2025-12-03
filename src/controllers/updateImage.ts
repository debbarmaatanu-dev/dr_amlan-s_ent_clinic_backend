import {Request, Response} from 'express';
import multer = require('multer');
import streamifier = require('streamifier');
import cloudinary = require('../services/cloudinary');

const storage = multer.memoryStorage();
const upload = multer({storage}).single('file');

export const replaceImage = (req: Request, res: Response): void => {
  upload(req, res, async function (err): Promise<void> {
    if (err) {
      console.error('[replaceImage] Multer upload error:', err);
      res
        .status(500)
        .json({success: false, message: 'Upload failed', error: err});
      return;
    }

    const {public_id, folderName} = req.body;
    const fileBuffer = req.file?.buffer;

    if (!public_id || !fileBuffer || !folderName) {
      console.error('[replaceImage] Missing required fields');
      res.status(400).json({
        success: false,
        message: 'public_id, folder name and file are required',
      });
      return;
    }

    try {
      const deleteImage = await cloudinary.uploader.destroy(public_id);

      if (deleteImage.result !== 'ok') {
        console.error('[replaceImage] Failed to delete image');
        res
          .status(500)
          .json({success: false, message: 'Failed to delete image'});
        return;
      }

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          format: 'jpg',
          folder: folderName,
          transformation: [{quality: 90}],
        },
        (error, result) => {
          if (error) {
            console.error('[replaceImage] Upload error:', error);
            res
              .status(500)
              .json({success: false, message: 'Upload error', error});
            return;
          }

          res.json({
            success: true,
            message: 'Image replaced with new upload',
            asset: {
              public_id: result?.public_id,
              url: result?.secure_url,
            },
          });
        },
      );

      streamifier.createReadStream(fileBuffer).pipe(uploadStream);
    } catch (error) {
      console.error('[replaceImage] Server error:', error);
      res.status(500).json({success: false, message: 'Server error', error});
    }
  });
};
