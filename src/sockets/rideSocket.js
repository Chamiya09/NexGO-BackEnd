// src/sockets/rideSocket.js
// Handles all real-time ride events between passengers and drivers.

const Ride = require('../models/Ride');
const {
  RIDE_STATUS,
  toCanonicalStatus,
  transitionRideById,
} = require('../services/rideLifecycleService');

// -- In-memory registries -------------------------------------------------------

/**
 * Map: passengerId (string) -> socket.id
 * Used to emit ride lifecycle updates back to the specific passenger.
 */
const passengerSocketMap = new Map();

/**
 * Map: socket.id -> { driverId, latitude, longitude }
 * Updated whenever a driver emits updateDriverLocation.
 */
const driverLocationMap = new Map();

// -- Haversine formula ---------------------------------------------------------

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

const DRIVER_RADIUS_KM = 1;
const ALLOWED_VEHICLE_CATEGORIES = new Set(['Bike', 'Tuk', 'Mini', 'Car', 'Van']);
const rideRecipientSocketMap = new Map();

function normalizeVehicleCategory(category) {
  const value = String(category || '').trim();
  if (value === 'TukTuk') return 'Tuk';
  if (value === 'Sedan') return 'Car';
  return value;
}

function getRideErrorMessage(error) {
  if (error?.name === 'ValidationError') {
    return Object.values(error.errors || {})
      .map((validationError) => validationError.message)
      .join(', ') || error.message;
  }

  return error?.message || 'Failed to create ride request. Please try again.';
}

function emitRemoveRideRequest(io, rideId, extra = {}) {
  const recipientSocketIds = rideRecipientSocketMap.get(String(rideId));

  if (recipientSocketIds?.size) {
    for (const driverSocketId of recipientSocketIds) {
      io.to(driverSocketId).emit('remove_ride_request', { rideId, ...extra });
    }
  } else {
    io.emit('remove_ride_request', { rideId, ...extra });
  }

  rideRecipientSocketMap.delete(String(rideId));
}

function emitPassengerLifecycle(io, ride, eventName, extra = {}) {
  const passengerSocketId = passengerSocketMap.get(String(ride.passengerId));

  if (!passengerSocketId) {
    console.warn(`[Socket.IO] Passenger socket not found for passengerId=${ride.passengerId}`);
    return;
  }

  const payload = {
    rideId: ride._id.toString(),
    status: ride.status,
    canonicalStatus: toCanonicalStatus(ride.status),
    ...extra,
  };

  io.to(passengerSocketId).emit(eventName, payload);
  io.to(passengerSocketId).emit('rideStatusUpdate', payload);
}

async function handleStrictTransition(io, socket, payload, options) {
  const { rideId, driverId } = payload || {};

  if (!rideId || !driverId) {
    socket.emit('rideError', { message: 'rideId and driverId are required.' });
    return;
  }

  const result = await transitionRideById({
    rideId,
    driverId,
    nextCanonicalStatus: options.nextCanonicalStatus,
  });

  if (!result.ok) {
    socket.emit('rideError', {
      message: result.message,
      code: result.code,
      currentCanonicalStatus: result.currentCanonicalStatus,
      expectedTransition: options.nextCanonicalStatus,
    });
    return;
  }

  emitPassengerLifecycle(io, result.ride, options.passengerEvent, {
    invoice: result.invoice,
  });

  socket.emit('rideStatusUpdate', {
    rideId: result.ride._id.toString(),
    status: result.ride.status,
    canonicalStatus: result.nextCanonicalStatus,
    invoice: result.invoice,
  });
}

function initRideSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('registerPassenger', (passengerId) => {
      passengerSocketMap.set(String(passengerId), socket.id);
      console.log(
          `[Socket.IO] Passenger registered: userId=${passengerId} -> socketId=${socket.id}`
      );
    });

    socket.on('updateDriverLocation', ({ driverId, latitude, longitude, vehicleCategory, isOnline, heading }) => {
      driverLocationMap.set(socket.id, {
        driverId,
        latitude,
        longitude,
        vehicleCategory: normalizeVehicleCategory(vehicleCategory),
        isOnline,
      });
      socket.broadcast.emit(`driver_location_${driverId}`, { latitude, longitude, heading });
    });

    socket.on('toggle_online_status', async ({ driverId, isOnline }) => {
      try {
        const Driver = require('../models/Driver');
        await Driver.findByIdAndUpdate(driverId, { isOnline });

        const loc = driverLocationMap.get(socket.id);
        if (loc) {
          loc.isOnline = isOnline;
          driverLocationMap.set(socket.id, loc);
        }
      } catch (error) {
        console.error('[Socket.IO] toggle_online_status error:', error);
      }
    });

    socket.on('get_available_drivers', ({ category, latitude, longitude }) => {
      const available = [];
      const requestedCategory = normalizeVehicleCategory(category);
      for (const location of driverLocationMap.values()) {
        if (!location.isOnline) continue;
        if (!requestedCategory || normalizeVehicleCategory(location.vehicleCategory) === requestedCategory) {
          const hasPassengerCoords = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
          if (hasPassengerCoords) {
            const dist = haversineDistanceKm(
              Number(latitude),
              Number(longitude),
              location.latitude,
              location.longitude
            );

            if (dist > DRIVER_RADIUS_KM) continue;
            available.push({ ...location, distanceKm: Number(dist.toFixed(2)) });
          } else {
            available.push(location);
          }
        }
      }
      socket.emit('available_drivers', available);
    });

    socket.on('requestRide', async (payload) => {
      console.log('[Socket.IO] requestRide received:', payload);

      try {
        const { passengerId, passengerName, vehicleType, price, pickup, dropoff } = payload;
        const requestedVehicleType = normalizeVehicleCategory(vehicleType);

        if (!ALLOWED_VEHICLE_CATEGORIES.has(requestedVehicleType)) {
          socket.emit('rideError', {
            code: 'INVALID_VEHICLE_CATEGORY',
            message: 'Please select a valid vehicle category.',
          });
          return;
        }

        const nearbySocketIds = [];

        for (const [driverSocketId, location] of driverLocationMap.entries()) {
          if (driverSocketId === socket.id) continue;
          if (!location.isOnline) continue;
          if (
            requestedVehicleType &&
            normalizeVehicleCategory(location.vehicleCategory) !== requestedVehicleType
          ) continue;

          const dist = haversineDistanceKm(
            pickup.latitude,
            pickup.longitude,
            location.latitude,
            location.longitude
          );

          if (dist <= DRIVER_RADIUS_KM) {
            nearbySocketIds.push(driverSocketId);
            console.log(
              `[Socket.IO] Driver ${location.driverId} is ${dist.toFixed(2)} km away - within range`
            );
          }
        }

        if (nearbySocketIds.length === 0) {
          console.warn(
            `[Socket.IO] No online nearby ${requestedVehicleType} drivers found for passengerId=${passengerId}`
          );
          socket.emit('rideError', {
            code: 'NO_MATCHING_DRIVER',
            message: `No online nearby ${requestedVehicleType} drivers found. Please try another category or try again later.`,
          });
          return;
        }

        const ride = await Ride.create({
          passengerId,
          vehicleType: requestedVehicleType,
          price,
          pickup,
          dropoff,
          status: RIDE_STATUS.PENDING,
        });

        const rideData = {
          rideId: ride._id.toString(),
          passengerId,
          passengerName: passengerName ?? 'Passenger',
          vehicleType: requestedVehicleType,
          price,
          pickup,
          dropoff,
          requestedAt: ride.createdAt,
          status: ride.status,
          canonicalStatus: 'PENDING',
        };

        for (const driverSocketId of nearbySocketIds) {
          io.to(driverSocketId).emit('incomingRide', rideData);
        }

        rideRecipientSocketMap.set(rideData.rideId, new Set(nearbySocketIds));

        console.log(
          `[Socket.IO] incomingRide sent to ${nearbySocketIds.length} matching driver(s) for rideId=${rideData.rideId}`
        );

        socket.emit('rideCreated', { rideId: rideData.rideId });
      } catch (error) {
        console.error('[Socket.IO] requestRide error:', error);
        socket.emit('rideError', {
          code: 'CREATE_RIDE_FAILED',
          message: getRideErrorMessage(error),
        });
      }
    });

    socket.on('acceptRide', async (payload) => {
      console.log('[Socket.IO] acceptRide received:', payload);

      try {
        const { rideId, driverId } = payload;

        const ride = await Ride.findOneAndUpdate(
          { _id: rideId, status: RIDE_STATUS.PENDING },
          { driverId, status: RIDE_STATUS.ACCEPTED, acceptedAt: new Date() },
          { new: true }
        );

        if (!ride) {
          socket.emit('rideError', {
            message: `Ride ${rideId} is no longer available or was accepted by someone else.`,
            code: 'INVALID_TRANSITION',
          });
          return;
        }

        emitRemoveRideRequest(io, rideId, { reason: 'accepted', acceptedByDriverId: driverId });

        const passengerSocketId = passengerSocketMap.get(String(ride.passengerId));
        if (passengerSocketId) {
          const acceptanceData = {
            rideId: ride._id.toString(),
            driverId,
            status: ride.status,
            canonicalStatus: 'ACCEPTED',
            acceptedAt: ride.acceptedAt,
            pickup: ride.pickup,
            dropoff: ride.dropoff,
            vehicleType: ride.vehicleType,
          };

          io.to(passengerSocketId).emit('rideAccepted', acceptanceData);
          io.to(passengerSocketId).emit('rideStatusUpdate', acceptanceData);
        }
      } catch (error) {
        console.error('[Socket.IO] acceptRide error:', error.message);
        socket.emit('rideError', { message: 'Failed to accept ride. Please try again.' });
      }
    });

    socket.on('cancelRide', async ({ rideId }) => {
      console.log('[Socket.IO] cancelRide received:', rideId);
      try {
        const ride = await Ride.findByIdAndUpdate(
          rideId,
          { status: RIDE_STATUS.CANCELLED, cancelledAt: new Date() },
          { new: true }
        );

        if (!ride) {
          socket.emit('rideError', { message: `Ride ${rideId} not found.` });
          return;
        }

        const payload = {
          rideId,
          status: RIDE_STATUS.CANCELLED,
          canonicalStatus: 'CANCELLED',
        };

        emitRemoveRideRequest(io, rideId, { reason: 'cancelled' });
        socket.emit('rideCancelled', payload);
        socket.emit('rideStatusUpdate', payload);
      } catch (error) {
        console.error('[Socket.IO] cancelRide error:', error.message);
        socket.emit('rideError', { message: 'Failed to cancel ride. Please try again.' });
      }
    });

    // Strict transitions: ACCEPTED -> ARRIVED
    socket.on('driver_arrived', async (payload) => {
      console.log('[Socket.IO] driver_arrived received:', payload);
      try {
        await handleStrictTransition(io, socket, payload, {
          nextCanonicalStatus: 'ARRIVED',
          passengerEvent: 'driver_arrived',
        });
      } catch (error) {
        console.error('[Socket.IO] driver_arrived error:', error.message);
        socket.emit('rideError', { message: 'Failed to mark ride as arrived.' });
      }
    });

    // Strict transitions: ARRIVED -> IN_TRANSIT
    socket.on('start_trip', async (payload) => {
      console.log('[Socket.IO] start_trip received:', payload);
      try {
        await handleStrictTransition(io, socket, payload, {
          nextCanonicalStatus: 'IN_TRANSIT',
          passengerEvent: 'trip_started',
        });
      } catch (error) {
        console.error('[Socket.IO] start_trip error:', error.message);
        socket.emit('rideError', { message: 'Failed to start trip.' });
      }
    });

    // Strict transitions: IN_TRANSIT -> COMPLETED (includes billing hook)
    socket.on('complete_trip', async (payload) => {
      console.log('[Socket.IO] complete_trip received:', payload);
      try {
        await handleStrictTransition(io, socket, payload, {
          nextCanonicalStatus: 'COMPLETED',
          passengerEvent: 'trip_completed',
        });
      } catch (error) {
        console.error('[Socket.IO] complete_trip error:', error.message);
        socket.emit('rideError', { message: 'Failed to complete trip.' });
      }
    });

    // Backward compatibility aliases
    socket.on('startRide', (payload) => socket.emit('start_trip', payload));
    socket.on('completeRide', (payload) => socket.emit('complete_trip', payload));

    socket.on('disconnect', () => {
      driverLocationMap.delete(socket.id);

      for (const [passengerId, socketId] of passengerSocketMap.entries()) {
        if (socketId === socket.id) {
          passengerSocketMap.delete(passengerId);
          console.log(`[Socket.IO] Cleaned up passenger mapping for userId=${passengerId}`);
          break;
        }
      }

      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = { initRideSocket };
