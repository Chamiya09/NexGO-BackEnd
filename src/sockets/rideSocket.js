// src/sockets/rideSocket.js
// Handles all real-time ride events between passengers and drivers.

const Ride = require('../models/Ride');

// ── In-memory registries ───────────────────────────────────────────────────────

/**
 * Map: passengerId (string) → socket.id
 * Used to emit `rideAccepted` back to the specific passenger.
 */
const passengerSocketMap = new Map();

/**
 * Map: socket.id → { driverId, latitude, longitude }
 * Updated whenever a driver emits `updateDriverLocation`.
 * Used for proximity filtering on ride requests.
 */
const driverLocationMap = new Map();

// ── Haversine formula ─────────────────────────────────────────────────────────

/**
 * Calculates the great-circle distance between two GPS coordinates.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in kilometres
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

const DRIVER_RADIUS_KM = 5; // Broadcast radius in kilometres

// ── Socket initialiser ────────────────────────────────────────────────────────

/**
 * Registers all ride-related socket event handlers on a given io instance.
 * @param {import('socket.io').Server} io
 */
function initRideSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: registerPassenger
    // Passenger app calls this on connect so the server maps
    // their MongoDB userId → socket.id for targeted emit later.
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('registerPassenger', (passengerId) => {
      passengerSocketMap.set(String(passengerId), socket.id);
      console.log(
        `[Socket.IO] Passenger registered: userId=${passengerId} → socketId=${socket.id}`
      );
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: updateDriverLocation
    // Driver app calls this periodically (e.g. every 5–10 s) to keep the
    // server's location map fresh for proximity filtering.
    //
    // Payload: { driverId: string, latitude: number, longitude: number }
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('updateDriverLocation', ({ driverId, latitude, longitude, vehicleCategory }) => {
      driverLocationMap.set(socket.id, { driverId, latitude, longitude, vehicleCategory });
      // Verbose log kept at debug level only to avoid log spam
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: get_available_drivers
    // Emitted by the Passenger App when they select a category or interval triggers
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('get_available_drivers', ({ category }) => {
      const available = [];
      for (const location of driverLocationMap.values()) {
        if (!category || location.vehicleCategory === category) {
          available.push(location);
        }
      }
      socket.emit('available_drivers', available);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: requestRide
    // Emitted by the Passenger App when the user taps "Confirm Ride".
    //
    // Payload:
    // {
    //   passengerId  : string,
    //   passengerName: string,
    //   vehicleType  : string,   // 'Bike' | 'TukTuk' | 'Mini' | 'Sedan' | 'Van'
    //   price        : number,
    //   pickup       : { latitude, longitude, name },
    //   dropoff      : { latitude, longitude, name },
    // }
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('requestRide', async (payload) => {
      console.log('[Socket.IO] requestRide received:', payload);

      try {
        const { passengerId, passengerName, vehicleType, price, pickup, dropoff } = payload;

        // 1. Persist a new Ride document in MongoDB
        const ride = await Ride.create({
          passengerId,
          vehicleType,
          price,
          pickup,
          dropoff,
        });

        // 2. Build the payload sent to nearby drivers
        const rideData = {
          rideId: ride._id.toString(),
          passengerId,
          passengerName: passengerName ?? 'Passenger',
          vehicleType,
          price,
          pickup,
          dropoff,
          requestedAt: ride.createdAt,
        };

        // 3. Find all driver sockets within DRIVER_RADIUS_KM
        const nearbySocketIds = [];

        for (const [driverSocketId, location] of driverLocationMap.entries()) {
          // Skip the socket that just emitted (it's the passenger)
          if (driverSocketId === socket.id) continue;

          const dist = haversineDistanceKm(
            pickup.latitude,
            pickup.longitude,
            location.latitude,
            location.longitude
          );

          if (dist <= DRIVER_RADIUS_KM) {
            nearbySocketIds.push(driverSocketId);
            console.log(
              `[Socket.IO] Driver ${location.driverId} is ${dist.toFixed(2)} km away — within range`
            );
          }
        }

        if (nearbySocketIds.length === 0) {
          // No nearby drivers tracked yet — fall back to broadcast so dev/testing still works
          console.warn(
            '[Socket.IO] No nearby drivers found in location map — falling back to broadcast'
          );
          socket.broadcast.emit('incomingRide', rideData);
        } else {
          // Targeted emit: only nearby drivers receive the event
          for (const driverSocketId of nearbySocketIds) {
            io.to(driverSocketId).emit('incomingRide', rideData);
          }
          console.log(
            `[Socket.IO] incomingRide sent to ${nearbySocketIds.length} nearby driver(s) for rideId=${rideData.rideId}`
          );
        }
        // 4. Confirm rideId back to the passenger who requested it
        socket.emit('rideCreated', { rideId: rideData.rideId });
        console.log(`[Socket.IO] rideCreated emitted to passenger socket=${socket.id}, rideId=${rideData.rideId}`);

      } catch (error) {
        console.error('[Socket.IO] requestRide error:', error.message);
        socket.emit('rideError', {
          message: 'Failed to create ride request. Please try again.',
        });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: acceptRide
    // Emitted by the Driver App when the driver taps "Accept Ride".
    //
    // Payload: { rideId: string, driverId: string }
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('acceptRide', async (payload) => {
      console.log('[Socket.IO] acceptRide received:', payload);

      try {
        const { rideId, driverId } = payload;

        // 1. Update ride in MongoDB: Accepted + assign driver
        const ride = await Ride.findByIdAndUpdate(
          rideId,
          { driverId, status: 'Accepted', acceptedAt: new Date() },
          { new: true }
        );

        if (!ride) {
          socket.emit('rideError', { message: `Ride ${rideId} not found.` });
          return;
        }

        // 2. Notify the specific passenger
        const passengerSocketId = passengerSocketMap.get(String(ride.passengerId));
        if (passengerSocketId) {
          const acceptanceData = {
            rideId: ride._id.toString(),
            driverId,
            status: ride.status,
            acceptedAt: ride.acceptedAt,
            pickup: ride.pickup,
            dropoff: ride.dropoff,
            vehicleType: ride.vehicleType,
          };

          // Full acceptance payload (used by confirm-route screen)
          io.to(passengerSocketId).emit('rideAccepted', acceptanceData);

          // Lightweight status patch (used by Activities screen FlatList)
          io.to(passengerSocketId).emit('rideStatusUpdate', {
            rideId: ride._id.toString(),
            status: ride.status,
          });

          console.log(
            `[Socket.IO] rideAccepted + rideStatusUpdate sent to passenger socketId=${passengerSocketId}`
          );
        } else {
          console.warn(
            `[Socket.IO] Passenger socket not found for passengerId=${ride.passengerId}`
          );
        }
      } catch (error) {
        console.error('[Socket.IO] acceptRide error:', error.message);
        socket.emit('rideError', { message: 'Failed to accept ride. Please try again.' });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: cancelRide
    // Emitted by the Passenger App when the passenger cancels a pending ride.
    //
    // Payload: { rideId: string }
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('cancelRide', async ({ rideId }) => {
      console.log('[Socket.IO] cancelRide received:', rideId);
      try {
        const ride = await Ride.findByIdAndUpdate(
          rideId,
          { status: 'Cancelled', cancelledAt: new Date() },
          { new: true }
        );

        if (!ride) {
          socket.emit('rideError', { message: `Ride ${rideId} not found.` });
          return;
        }

        // Confirm cancellation back to the passenger
        socket.emit('rideCancelled', { rideId, status: 'Cancelled' });

        // Notify the Activities screen of the status change
        socket.emit('rideStatusUpdate', { rideId, status: 'Cancelled' });

        console.log(`[Socket.IO] Ride ${rideId} cancelled successfully`);
      } catch (error) {
        console.error('[Socket.IO] cancelRide error:', error.message);
        socket.emit('rideError', { message: 'Failed to cancel ride. Please try again.' });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: startRide
    // Emitted by the Driver App when they arrive at pickup and start the trip.
    //
    // Payload: { rideId: string, driverId: string }
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('startRide', async (payload) => {
      console.log('[Socket.IO] startRide received:', payload);
      try {
        const { rideId, driverId } = payload;
        const ride = await Ride.findOneAndUpdate(
          { _id: rideId, driverId },
          { status: 'InProgress' },
          { new: true }
        );

        if (!ride) {
          socket.emit('rideError', { message: `Ride ${rideId} not found or unauthorized.` });
          return;
        }

        // Notify Passenger
        const passengerSocketId = passengerSocketMap.get(String(ride.passengerId));
        if (passengerSocketId) {
          io.to(passengerSocketId).emit('rideStatusUpdate', {
            rideId: ride._id.toString(),
            status: 'InProgress',
          });
        }

        // Notify Driver back as confirmation
        socket.emit('rideStatusUpdate', { rideId: ride._id.toString(), status: 'InProgress' });
      } catch (error) {
        console.error('[Socket.IO] startRide error:', error.message);
        socket.emit('rideError', { message: 'Failed to start ride.' });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: completeRide
    // Emitted by the Driver App when they reach the destination and finish.
    //
    // Payload: { rideId: string, driverId: string }
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('completeRide', async (payload) => {
      console.log('[Socket.IO] completeRide received:', payload);
      try {
        const { rideId, driverId } = payload;
        const ride = await Ride.findOneAndUpdate(
          { _id: rideId, driverId },
          { status: 'Completed', completedAt: new Date() },
          { new: true }
        );

        if (!ride) {
          socket.emit('rideError', { message: `Ride ${rideId} not found or unauthorized.` });
          return;
        }

        // Notify Passenger
        const passengerSocketId = passengerSocketMap.get(String(ride.passengerId));
        if (passengerSocketId) {
          io.to(passengerSocketId).emit('rideStatusUpdate', {
            rideId: ride._id.toString(),
            status: 'Completed',
          });
        }

        // Notify Driver back as confirmation
        socket.emit('rideStatusUpdate', { rideId: ride._id.toString(), status: 'Completed' });
      } catch (error) {
        console.error('[Socket.IO] completeRide error:', error.message);
        socket.emit('rideError', { message: 'Failed to complete ride.' });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: disconnect
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      // Clean up driver location entry
      driverLocationMap.delete(socket.id);

      // Clean up passenger entry
      for (const [passengerId, socketId] of passengerSocketMap.entries()) {
        if (socketId === socket.id) {
          passengerSocketMap.delete(passengerId);
          console.log(
            `[Socket.IO] Cleaned up passenger mapping for userId=${passengerId}`
          );
          break;
        }
      }

      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = { initRideSocket };
