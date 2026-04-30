const mongoose = require('mongoose');

const coordinateSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    name: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const rideSchema = new mongoose.Schema(
  {
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },
    pickup: {
      type: coordinateSchema,
      required: true,
    },
    dropoff: {
      type: coordinateSchema,
      required: true,
    },
    vehicleType: {
      type: String,
      enum: ['Bike', 'Tuk', 'TukTuk', 'Mini', 'Car', 'Sedan', 'Van'],
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    promotion: {
      promotionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Promotion',
        default: null,
      },
      code: {
        type: String,
        uppercase: true,
        trim: true,
        default: '',
      },
      discountType: {
        type: String,
        enum: ['Percentage', 'Fixed', null],
        default: null,
      },
      discountValue: {
        type: Number,
        default: 0,
      },
      discountAmount: {
        type: Number,
        default: 0,
      },
      originalPrice: {
        type: Number,
        default: 0,
      },
    },
    status: {
      type: String,
      enum: ['Pending', 'Accepted', 'Arrived', 'InProgress', 'Completed', 'Cancelled'],
      default: 'Pending',
    },
    arrivalVerificationCode: { type: String, default: null },
    arrivalVerificationExpiresAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Ride', rideSchema);
