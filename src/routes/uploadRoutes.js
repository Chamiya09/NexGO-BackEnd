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

    const fileUrl = req.file.secure_url || req.file.url;

    if (!fileUrl) {
      return res.status(500).json({ message: 'File uploaded, but Cloudinary did not return a file URL.' });
    }

    return res.status(201).json({
      message: 'File uploaded successfully.',
      fileUrl,
      url: req.file.url,
      secureUrl: req.file.secure_url,
      publicId: req.file.public_id,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      resourceType: req.file.resource_type,
      bytes: req.file.bytes,
    });
  });
});

module.exports = router;
