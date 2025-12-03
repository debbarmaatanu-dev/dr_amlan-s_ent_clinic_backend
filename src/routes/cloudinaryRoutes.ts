import express = require('express');
import {deleteFile} from '../controllers/deleteFileController';
import {replaceImage} from '../controllers/updateImage';
import {addImage} from '../controllers/addImage';
import {addPDF} from '../controllers/addPDF';
import {replacePDF} from '../controllers/replacePDF';

const router = express.Router();

router.post('/addImage', addImage);
router.post('/replaceImage', replaceImage);
router.post('/deleteFile', deleteFile);
router.post('/addPDF', addPDF);
router.post('/replacePDF', replacePDF);

export = router;
