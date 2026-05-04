import express from 'express';
import {deleteFile} from '../controllers/deleteFileController.js';
import {replaceImage} from '../controllers/updateImage.js';
import {addImage} from '../controllers/addImage.js';
import {addPDF} from '../controllers/addPDF.js';
import {replacePDF} from '../controllers/replacePDF.js';

const router = express.Router();

router.post('/addImage', addImage);
router.post('/replaceImage', replaceImage);
router.post('/deleteFile', deleteFile);
router.post('/addPDF', addPDF);
router.post('/replacePDF', replacePDF);

export default router;
