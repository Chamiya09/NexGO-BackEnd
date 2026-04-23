const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const paymentMethodSchema = new mongoose.Schema(
  {
    cardholderName: {
      type: String,
      required: true,
      trim: true,
    },
    brand: {
      type: String,
      required: true,
      trim: true,
    },
    last4: {
      type: String,
      required: true,
      minlength: 4,
      maxlength: 4,
    },
    fingerprintHash: {
      type: String,
      required: true,
      trim: true,
    },
    expiryMonth: {
      type: String,
      required: true,
      trim: true,
    },
    expiryYear: {
      type: String,
      required: true,
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: true,
    timestamps: true,
  }
);

const savedAddressSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      enum: ['Home', 'Work', 'Other'],
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    addressLine: {
      type: String,
      required: true,
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: true,
    timestamps: true,
  }
);

const userSchema = new mongoose.Schema(
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
    passwordResetOtpHash: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetOtpExpiresAt: {
      type: Date,
      default: null,
    },
    passwordResetOtpAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    passwordResetLastSentAt: {
      type: Date,
      default: null,
    },
    paymentMethods: {
      type: [paymentMethodSchema],
      default: [],
    },
    savedAddresses: {
      type: [savedAddressSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function preSave() {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('User', userSchema);
