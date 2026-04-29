const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: [2, 'Promotion name must be at least 2 characters long'],
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
      minlength: [2, 'Promo code must be at least 2 characters long'],
    },
    discountType: {
      type: String,
      enum: ['Percentage', 'Fixed'],
      required: true,
      default: 'Percentage',
    },
    discountValue: {
      type: Number,
      required: true,
      min: [1, 'Discount value must be greater than zero'],
    },
    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['Active', 'Scheduled', 'Paused'],
      default: 'Active',
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Promotion', promotionSchema);
