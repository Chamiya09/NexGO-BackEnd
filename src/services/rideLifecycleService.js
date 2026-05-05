// src/services/rideLifecycleService.js
// Shared state-machine logic for ride lifecycle transitions.

const Ride = require('../models/Ride');
const { triggerPaymentAndInvoice } = require('./billingService');

const RIDE_STATUS = Object.freeze({
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  ARRIVED: 'Arrived',
  IN_TRANSIT: 'InProgress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
});

const LEGACY_TO_CANONICAL = Object.freeze({
  Pending: 'PENDING',
  Accepted: 'ACCEPTED',
  Arrived: 'ARRIVED',
  InProgress: 'IN_TRANSIT',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
});

const CANONICAL_TO_LEGACY = Object.freeze({
  PENDING: RIDE_STATUS.PENDING,
  ACCEPTED: RIDE_STATUS.ACCEPTED,
  ARRIVED: RIDE_STATUS.ARRIVED,
  IN_TRANSIT: RIDE_STATUS.IN_TRANSIT,
  COMPLETED: RIDE_STATUS.COMPLETED,
  CANCELLED: RIDE_STATUS.CANCELLED,
});

const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_TRANSIT'],
  IN_TRANSIT: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
});

function toCanonicalStatus(status) {
  return LEGACY_TO_CANONICAL[status] ?? null;
}

function toLegacyStatus(canonicalStatus) {
  return CANONICAL_TO_LEGACY[canonicalStatus] ?? null;
}

function canTransition(currentCanonicalStatus, nextCanonicalStatus) {
  return ALLOWED_TRANSITIONS[currentCanonicalStatus]?.includes(nextCanonicalStatus) ?? false;
}

function transitionPatch(nextCanonicalStatus) {
  if (nextCanonicalStatus === 'ACCEPTED') {
    return { acceptedAt: new Date() };
  }

  if (nextCanonicalStatus === 'COMPLETED') {
    return { completedAt: new Date() };
  }

  return {};
}

async function transitionRideById({ rideId, driverId, nextCanonicalStatus, strictDriver = true }) {
  const ride = await Ride.findById(rideId);
  if (!ride) {
    return { ok: false, code: 'NOT_FOUND', message: `Ride ${rideId} not found.` };
  }

  const currentCanonicalStatus = toCanonicalStatus(ride.status);
  if (!currentCanonicalStatus) {
    return { ok: false, code: 'INVALID_CURRENT_STATE', message: `Unknown current state: ${ride.status}` };
  }

  if (!canTransition(currentCanonicalStatus, nextCanonicalStatus)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Invalid transition ${currentCanonicalStatus} -> ${nextCanonicalStatus}`,
      currentCanonicalStatus,
    };
  }

  if (strictDriver && driverId && ride.driverId?.toString() !== String(driverId)) {
    return { ok: false, code: 'UNAUTHORIZED_DRIVER', message: 'Driver is not assigned to this ride.' };
  }

  ride.status = toLegacyStatus(nextCanonicalStatus);
  Object.assign(ride, transitionPatch(nextCanonicalStatus));

  await ride.save();

  let invoice = null;
  if (nextCanonicalStatus === 'COMPLETED') {
    invoice = await triggerPaymentAndInvoice(ride);
  }

  return {
    ok: true,
    ride,
    invoice,
    currentCanonicalStatus,
    nextCanonicalStatus,
  };
}

module.exports = {
  RIDE_STATUS,
  toCanonicalStatus,
  toLegacyStatus,
  canTransition,
  transitionRideById,
};
