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
      enum: ['Bike', 'TukTuk', 'Mini', 'Sedan', 'Van'],
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Accepted', 'Arrived', 'InProgress', 'Completed', 'Cancelled'],
      default: 'Pending',
    },
    acceptedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Ride', rideSchema);
