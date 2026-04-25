const express = require('express');
const multer = require('multer');

const { upload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.post('/', (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: error.message });
    }

    if (error) {
      return res.status(400).json({ message: error.message || 'File upload failed.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file was uploaded.' });
    }

    return res.status(201).json({
      message: 'File uploaded successfully.',
      fileUrl: req.file.path,
      url: req.file.path,
      secureUrl: req.file.path,
      publicId: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
    });
  });
});

module.exports = router;
