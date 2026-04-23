const path = require('path');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const cloudinary = require('../config/cloudinary');

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, file) => {
    const originalExtension = path.extname(file.originalname || '').replace('.', '').toLowerCase();

    return {
      folder: 'nexgo/uploads',
      resource_type: 'auto',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'],
      format: originalExtension || undefined,
      public_id: `${Date.now()}-${path.basename(file.originalname || 'upload', path.extname(file.originalname || ''))}`,
    };
  },
});

const fileFilter = (_req, file, callback) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    callback(new Error('Only JPG, PNG, WEBP, HEIC, HEIF images and PDF files are allowed.'));
    return;
  }

  callback(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

module.exports = {
  upload,
};
