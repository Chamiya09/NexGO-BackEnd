const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { buildReadableId } = require('../utils/readableId');

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

const vehicleSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['Bike', 'Tuk', 'Mini', 'Car', 'Van'],
      required: true,
    },
    make: {
      type: String,
      required: true,
      trim: true,
    },
    model: {
      type: String,
      required: true,
      trim: true,
    },
    year: {
      type: Number,
      required: true,
      min: [1981, 'Vehicle manufacture year must be after 1980'],
      max: [2100, 'Vehicle year is not valid'],
    },
    plateNumber: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    color: {
      type: String,
      required: true,
      trim: true,
    },
    seats: {
      type: Number,
      required: true,
      min: [1, 'Vehicle must have at least 1 passenger seat'],
      max: [60, 'Vehicle seat count is not valid'],
    },
  },
  {
    _id: false,
    timestamps: true,
  }
);

const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length === 2 &&
            Number.isFinite(Number(value[0])) &&
            Number.isFinite(Number(value[1]))
          );
        },
        message: 'Driver location must be [longitude, latitude]',
      },
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
    vehicle: {
      type: vehicleSchema,
      default: null,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    availabilityStatus: {
      type: String,
      enum: ['Available', 'Busy', 'Offline'],
      default: 'Offline',
    },
    currentLocation: {
      type: geoPointSchema,
      default: null,
    },
    locationUpdatedAt: {
      type: Date,
      default: null,
    },
    totalCashedOut: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

driverSchema.index({ currentLocation: '2dsphere' });

driverSchema.pre('save', async function preSave() {
  if (!this.readableId) {
    this.readableId = buildReadableId('DRV', this._id);
  }

  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('Driver', driverSchema);
