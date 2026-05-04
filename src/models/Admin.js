const mongoose = require('mongoose');
const { buildReadableId } = require('../utils/readableId');

const adminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    readableId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    phoneNumber: {
      type: String,
      default: '',
      trim: true,
    },
    profileImageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      default: 'Operations Admin',
      trim: true,
    },
    scope: {
      type: String,
      default: 'NexGO Control Center',
      trim: true,
    },
    office: {
      type: String,
      default: 'Colombo HQ',
      trim: true,
    },
    shift: {
      type: String,
      default: 'Full operations coverage',
      trim: true,
    },
  },
  { timestamps: true }
);

adminSchema.pre('save', function preSave(next) {
  if (!this.readableId) {
    this.readableId = buildReadableId('ADM', this._id);
  }

  next();
});

module.exports = mongoose.model('Admin', adminSchema);
