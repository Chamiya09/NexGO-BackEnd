const mongoose = require('mongoose');

const SUPPORT_TICKET_TOPICS = [
  'Ride issue',
  'Pickup or drop-off',
  'Driver behavior',
  'Fare or refund',
  'Payment help',
  'Promo code issue',
  'Safety center',
  'Lost item',
  'Account support',
  'App or booking issue',
  'Saved addresses',
  'Accessibility help',
];

const supportTicketSchema = new mongoose.Schema(
  {
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    topic: {
      type: String,
      enum: SUPPORT_TICKET_TOPICS,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: [3, 'Subject must be at least 3 characters'],
      maxlength: [120, 'Subject must be 120 characters or less'],
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: [12, 'Description must be at least 12 characters'],
      maxlength: [1200, 'Description must be 1200 characters or less'],
    },
    rideReference: {
      type: String,
      trim: true,
      maxlength: [80, 'Ride reference must be 80 characters or less'],
      default: '',
    },
    priority: {
      type: String,
      enum: ['Normal', 'Urgent'],
      default: 'Normal',
    },
    status: {
      type: String,
      enum: ['Open', 'In Review', 'Resolved', 'Closed'],
      default: 'Open',
      index: true,
    },
    adminNote: {
      type: String,
      trim: true,
      maxlength: [800, 'Admin note must be 800 characters or less'],
      default: '',
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

supportTicketSchema.index({ passengerId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });

module.exports = {
  SupportTicket: mongoose.model('SupportTicket', supportTicketSchema),
  SUPPORT_TICKET_TOPICS,
};
