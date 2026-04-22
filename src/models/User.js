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
    password: {
      type: String,
      required: true,
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false,
    },
    paymentMethods: {
      type: [paymentMethodSchema],
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
