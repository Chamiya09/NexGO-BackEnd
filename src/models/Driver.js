const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const vehicleSchema = new mongoose.Schema(
  {
    licensePlate: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
    },
    carModel: {
      type: String,
      default: '',
      trim: true,
    },
    year: {
      type: String,
      default: '',
      trim: true,
    },
    color: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      default: '',
      trim: true,
    },
    registrationNumber: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  {
    _id: false,
  }
);

const documentSchema = new mongoose.Schema(
  {
    documentType: {
      type: String,
      enum: ['license', 'insurance', 'registration'],
      required: true,
    },
    fileUrl: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['missing', 'review', 'approved', 'rejected'],
      default: 'missing',
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const securitySchema = new mongoose.Schema(
  {
    twoStepVerificationEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  }
);

const driverSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: [2, 'Full name must be at least 2 characters long'],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    emergencyContact: {
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
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'suspended'],
      default: 'pending',
    },
    vehicle: {
      type: vehicleSchema,
      default: () => ({}),
    },
    documents: {
      type: [documentSchema],
      default: () => [
        { documentType: 'license' },
        { documentType: 'insurance' },
        { documentType: 'registration' },
      ],
    },
    security: {
      type: securitySchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

driverSchema.pre('save', async function preSave() {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('Driver', driverSchema);
