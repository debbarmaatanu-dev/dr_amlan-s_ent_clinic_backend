import {Request, Response} from 'express';
import cloudinary = require('../services/cloudinary');

export const deleteFile = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const {public_id} = req.body;

  if (!public_id) {
    console.error('[deleteFile] Missing public_id');
    return res
      .status(400)
      .json({success: false, message: 'public_id is required'});
  }

  try {
    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result === 'ok') {
      return res.json({success: true, message: 'file deleted successfully'});
    } else {
      console.error('[deleteFile] Failed to delete file:', result);
      return res
        .status(500)
        .json({success: false, message: 'Failed to delete file', result});
    }
  } catch (error) {
    console.error('[deleteFile] Server error:', error);
    return res
      .status(500)
      .json({success: false, message: 'Server error:', error});
  }
};
