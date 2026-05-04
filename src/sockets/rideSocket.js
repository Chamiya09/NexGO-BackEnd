// src/sockets/rideSocket.js
// Handles all real-time ride events between passengers and drivers.

const Ride = require('../models/Ride');
const Driver = require('../models/Driver');
const User = require('../models/User');
const Promotion = require('../models/Promotion');
const {
  RIDE_STATUS,
  toCanonicalStatus,
  transitionRideById,
} = require('../services/rideLifecycleService');

const DISABLE_DRIVER_REQUESTS = false;

// -- In-memory registries -------------------------------------------------------

/**
 * Map: passengerId (string) -> Set<socket.id>
 * Used to emit ride lifecycle updates back to the specific passenger.
 */
const passengerSocketMap = new Map();

/**
 * Map: socket.id -> { driverId, latitude, longitude }
 * Updated whenever a driver emits updateDriverLocation.
 */
const driverLocationMap = new Map();
const driverSocketMap = new Map();
const arrivalVerificationMap = new Map();

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

const DRIVER_DISPLAY_RADIUS_KM = 5;
const DRIVER_REQUEST_RADIUS_KM = 5;
const ALLOWED_VEHICLE_CATEGORIES = new Set(['Bike', 'Tuk', 'Mini', 'Car', 'Van']);
const VEHICLE_PER_KM_RATES = {
  Bike: 70,
  Tuk: 150,
  Mini: 300,
  Car: 350,
  Van: 1250,
};
const ADMIN_COMMISSION_RATE = 0.2;
const MINIMUM_FARE = 0;
const rideRecipientSocketMap = new Map();
const PASSENGER_ROOM_PREFIX = 'passenger:';
const DRIVER_ROOM_PREFIX = 'driver:';

function getPassengerRoom(passengerId) {
  return `${PASSENGER_ROOM_PREFIX}${String(passengerId)}`;
}

function getDriverRoom(driverId) {
  return `${DRIVER_ROOM_PREFIX}${String(driverId)}`;
}

function normalizeVehicleCategory(category) {
  const value = String(category || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '');

  if (['bike', 'motorbike', 'motorcycle'].includes(value)) return 'Bike';
  if (['tuk', 'tuktuk', 'threewheel', 'threewheeler'].includes(value)) return 'Tuk';
  if (value === 'mini') return 'Mini';
  if (['car', 'sedan'].includes(value)) return 'Car';
  if (value === 'van') return 'Van';
  return '';
}

function hasValidCoords(location) {
  return Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
}

function hasValidGeoPoint(driver) {
  const coordinates = driver?.currentLocation?.coordinates;
  return (
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1]))
  );
}

function getOnlineDriverLocations(category) {
  const requestedCategory = normalizeVehicleCategory(category);
  const latestByDriverId = new Map();

  for (const [driverSocketId, location] of driverLocationMap.entries()) {
    if (!location?.isOnline || !hasValidCoords(location)) continue;
    if (requestedCategory && normalizeVehicleCategory(location.vehicleCategory) !== requestedCategory) continue;

    const driverKey = String(location.driverId || driverSocketId);
    const previous = latestByDriverId.get(driverKey);
    if (!previous || Number(location.updatedAt || 0) > Number(previous.location.updatedAt || 0)) {
      latestByDriverId.set(driverKey, { driverSocketId, location });
    }
  }

  return Array.from(latestByDriverId.values());
}

async function findNearbyAvailableDrivers({ pickup, vehicleType, radiusKm = DRIVER_REQUEST_RADIUS_KM }) {
  if (!hasValidCoords(pickup)) {
    return [];
  }

  const requestedCategory = normalizeVehicleCategory(vehicleType);
  if (!requestedCategory) {
    return [];
  }

  const latitude = Number(pickup.latitude);
  const longitude = Number(pickup.longitude);
  const radiusMeters = Math.max(1, Number(radiusKm) * 1000);

  return Driver.find({
    isOnline: true,
    status: 'active',
    availabilityStatus: 'Available',
    'vehicle.category': requestedCategory,
    currentLocation: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        $maxDistance: radiusMeters,
      },
    },
  })
    .select('fullName isOnline status availabilityStatus documents vehicle currentLocation locationUpdatedAt')
    .lean();
}

function getAllDriverLocationSnapshot() {
  const latestByDriverId = new Map();

  for (const [driverSocketId, location] of driverLocationMap.entries()) {
    if (!hasValidCoords(location)) continue;

    const driverKey = String(location.driverId || driverSocketId);
    const previous = latestByDriverId.get(driverKey);
    if (!previous || Number(location.updatedAt || 0) > Number(previous.updatedAt || 0)) {
      latestByDriverId.set(driverKey, {
        driverId: location.driverId || driverSocketId,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        vehicleCategory: location.vehicleCategory,
        isOnline: Boolean(location.isOnline),
        heading: location.heading,
        updatedAt: location.updatedAt,
      });
    }
  }

  return Array.from(latestByDriverId.values());
}

function getDriverLocationById(driverId) {
  const normalizedDriverId = String(driverId || '');
  if (!normalizedDriverId) return null;

  const driverSocketId = driverSocketMap.get(normalizedDriverId);
  if (driverSocketId) {
    const location = driverLocationMap.get(driverSocketId);
    if (location && hasValidCoords(location)) return location;
  }

  for (const location of driverLocationMap.values()) {
    if (String(location.driverId || '') === normalizedDriverId && hasValidCoords(location)) {
      return location;
    }
  }

  return null;
}

function createArrivalCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getRideErrorMessage(error) {
  if (error?.name === 'ValidationError') {
    return Object.values(error.errors || {})
      .map((validationError) => validationError.message)
      .join(', ') || error.message;
  }

  return error?.message || 'Failed to create ride request. Please try again.';
}

function calculateDiscountAmount(promotion, price) {
  const discountValue = Number(promotion?.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) return 0;

  if (promotion.discountType === 'Percentage') {
    const percent = Math.min(100, Math.max(0, discountValue));
    return Math.min(price, price * (percent / 100));
  }

  return Math.min(price, discountValue);
}

function isPromotionExpired(promotion) {
  return promotion?.endDate ? promotion.endDate.getTime() < Date.now() : false;
}

async function buildPromotionUsage({ passengerId, requestedVehicleType, payloadPromotion, fallbackPrice }) {
  const requestedPromotionId = payloadPromotion?.id || payloadPromotion?.promotionId;
  const requestedPromotionCode = String(payloadPromotion?.code || '').trim().toUpperCase();

  const originalPrice = Number(fallbackPrice);
  const safeOriginalPrice = Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : 0;

  if (!requestedPromotionId && !requestedPromotionCode) {
    return {
      finalPrice: safeOriginalPrice,
      promotionSnapshot: null,
    };
  }

  const promotion = requestedPromotionId
    ? await Promotion.findById(requestedPromotionId)
    : await Promotion.findOne({ code: requestedPromotionCode });

  if (!promotion) {
    return { error: { code: 'PROMOTION_NOT_FOUND', message: 'Promo code not found.' } };
  }

  if (!promotion.active || promotion.status !== 'Active') {
    return { error: { code: 'PROMOTION_INACTIVE', message: 'Promo code is not active.' } };
  }

  if (isPromotionExpired(promotion)) {
    return { error: { code: 'PROMOTION_EXPIRED', message: 'Promo code has expired.' } };
  }

  const alreadyUsed = await Ride.exists({
    passengerId,
    'promotion.promotionId': promotion._id,
  });

  if (alreadyUsed) {
    return {
      error: {
        code: 'PROMOTION_ALREADY_USED',
        message: 'You have already used this promo code.',
      },
    };
  }

  const discountAmount = calculateDiscountAmount(promotion, safeOriginalPrice);
  const finalPrice = Math.max(0, safeOriginalPrice - discountAmount);

  return {
    finalPrice,
    promotionSnapshot: {
      promotionId: promotion._id,
      code: promotion.code,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      discountAmount,
      originalPrice: safeOriginalPrice,
    },
  };
}

function calculateRideBasePrice({ vehicleType, pickup, dropoff }) {
  if (!hasValidCoords(pickup) || !hasValidCoords(dropoff)) {
    return 0;
  }

  const rate = VEHICLE_PER_KM_RATES[vehicleType] ?? 0;
  const distanceKm = haversineDistanceKm(
    Number(pickup.latitude),
    Number(pickup.longitude),
    Number(dropoff.latitude),
    Number(dropoff.longitude)
  );
  const rawFare = Number.isFinite(distanceKm) ? distanceKm * rate : 0;
  return Math.max(MINIMUM_FARE, Math.round(rawFare));
}

function isDriverKycApproved(driver) {
  const documents = Array.isArray(driver?.documents) ? driver.documents : [];
  if (documents.length === 0) return false;
  return documents.every((doc) => doc?.status === 'approved');
}

function emitRemoveRideRequest(io, rideId, extra = {}) {
  io.emit('remove_ride_request', { rideId, ...extra });
  rideRecipientSocketMap.delete(String(rideId));
}

function getPassengerSocketIds(passengerId) {
  return passengerSocketMap.get(String(passengerId)) ?? new Set();
}

function registerPassengerSocket(socket, passengerId) {
  const passengerKey = String(passengerId || '');
  if (!passengerKey) return;

  const passengerSocketIds = getPassengerSocketIds(passengerKey);
  passengerSocketIds.add(socket.id);
  passengerSocketMap.set(passengerKey, passengerSocketIds);
  socket.join(getPassengerRoom(passengerKey));
}

function registerDriverSocket(socket, driverId) {
  const driverKey = String(driverId || '');
  if (!driverKey) return;

  driverSocketMap.set(driverKey, socket.id);
  socket.join(getDriverRoom(driverKey));
}

function emitToPassenger(io, passengerId, eventName, payload) {
  const passengerSocketIds = getPassengerSocketIds(passengerId);

  if (passengerSocketIds.size === 0) {
    console.warn(`[Socket.IO] Passenger socket not found for passengerId=${passengerId}`);
  }

  io.to(getPassengerRoom(passengerId)).emit(eventName, payload);

  return passengerSocketIds.size > 0;
}

function emitPassengerAccountStatus(io, passengerId, status) {
  emitToPassenger(io, passengerId, 'passenger_account_status', {
    passengerId: String(passengerId),
    status,
  });
}

function emitDriverAccountStatus(io, driverId, status) {
  const driverKey = String(driverId);
  const socketId = driverSocketMap.get(driverKey);

  if (!socketId) {
    console.warn(`[Socket.IO] Driver socket not found for driverId=${driverKey}`);
  }

  io.to(getDriverRoom(driverKey)).emit('driver_account_status', {
    driverId: driverKey,
    status,
  });
}

function emitPassengerLifecycle(io, ride, eventName, extra = {}) {
  const payload = {
    rideId: ride._id.toString(),
    status: ride.status,
    canonicalStatus: toCanonicalStatus(ride.status),
    ...extra,
  };

  emitToPassenger(io, ride.passengerId, eventName, payload);
  emitToPassenger(io, ride.passengerId, 'rideStatusUpdate', payload);
}

async function broadcastRideRequestToNearbyDrivers(io, ride, options = {}) {
  if (DISABLE_DRIVER_REQUESTS) {
    return {
      ok: false,
      code: 'DRIVER_REQUESTS_DISABLED',
      message: 'Driver requests are temporarily disabled.',
      notifiedSocketIds: [],
    };
  }

  const requestedVehicleType = normalizeVehicleCategory(ride.vehicleType);

  if (!ALLOWED_VEHICLE_CATEGORIES.has(requestedVehicleType)) {
    return {
      ok: false,
      code: 'INVALID_VEHICLE_CATEGORY',
      message: 'Please select a valid vehicle category.',
      notifiedSocketIds: [],
    };
  }

  const pickup = ride.pickup;
  const matchingDrivers = [];

  for (const { driverSocketId, location } of getOnlineDriverLocations(requestedVehicleType)) {
    const dist = haversineDistanceKm(
      pickup.latitude,
      pickup.longitude,
      location.latitude,
      location.longitude
    );

    matchingDrivers.push({ driverSocketId, driverId: location.driverId, distanceKm: dist });
  }

  let nearbyDrivers = matchingDrivers
    .filter((driver) => driver.distanceKm <= DRIVER_REQUEST_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .filter((driver) => {
      const currentLocation = driverLocationMap.get(driver.driverSocketId);
      return currentLocation?.isOnline && hasValidCoords(currentLocation);
    });

  if (nearbyDrivers.length === 0) {
    try {
      const dbDrivers = await findNearbyAvailableDrivers({
        pickup,
        vehicleType: requestedVehicleType,
        radiusKm: DRIVER_REQUEST_RADIUS_KM,
      });

      nearbyDrivers = dbDrivers
        .filter(isDriverKycApproved)
        .filter(hasValidGeoPoint)
        .map((driver) => {
          const driverId = String(driver._id);
          const [longitude, latitude] = driver.currentLocation.coordinates;
          return {
            driverId,
            driverSocketId: driverSocketMap.get(driverId) || null,
            driverRoom: getDriverRoom(driverId),
            distanceKm: haversineDistanceKm(
              pickup.latitude,
              pickup.longitude,
              latitude,
              longitude
            ),
          };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);
    } catch (error) {
      console.error('[Socket.IO] Mongo nearby driver fallback failed:', error.message);
    }
  }

  if (nearbyDrivers.length === 0) {
    const onlineCategories = Array.from(driverLocationMap.values())
      .filter((location) => location.isOnline)
      .map((location) => normalizeVehicleCategory(location.vehicleCategory) || 'Unknown');

    console.warn(
      `[Socket.IO] No online ${requestedVehicleType} drivers found within ${DRIVER_REQUEST_RADIUS_KM} km for passengerId=${ride.passengerId}. Online categories: ${onlineCategories.join(', ') || 'none'}`
    );

    return {
      ok: false,
      code: 'NO_MATCHING_DRIVER',
      message: `No online ${requestedVehicleType} drivers found nearby. Please try another category or try again later.`,
      notifiedSocketIds: [],
    };
  }

  const passenger = await User.findById(ride.passengerId).select('fullName profileImageUrl').lean();
  const rideData = {
    rideId: ride._id.toString(),
    passengerId: String(ride.passengerId),
    passengerName: options.passengerName ?? passenger?.fullName ?? 'Passenger',
    passengerImage: passenger?.profileImageUrl || '',
    vehicleType: requestedVehicleType,
    price: ride.price,
    paymentMethod: ride.paymentMethod === 'WALLET' ? 'WALLET' : 'CASH',
    promotion: ride.promotion?.promotionId
      ? {
          code: ride.promotion.code,
          discountAmount: ride.promotion.discountAmount,
          originalPrice: ride.promotion.originalPrice,
        }
      : null,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    requestedAt: ride.createdAt,
    status: ride.status,
    canonicalStatus: 'PENDING',
  };

  const notifiedSocketIds = [];
  for (const driver of nearbyDrivers) {
    if (driver.driverSocketId) {
      const currentLocation = driverLocationMap.get(driver.driverSocketId);
      if (!currentLocation?.isOnline || !hasValidCoords(currentLocation)) continue;
    }

    console.log(
      `[Socket.IO] Driver ${driver.driverId} is ${driver.distanceKm.toFixed(2)} km away - online and within request range`
    );
    const target = driver.driverSocketId || driver.driverRoom;
    const roomSize = driver.driverRoom
      ? io.sockets.adapter.rooms.get(driver.driverRoom)?.size || 0
      : 0;

    if (!target || (!driver.driverSocketId && roomSize === 0)) continue;

    io.to(target).emit('incomingRide', rideData);
    io.to(target).emit('newRideRequest', rideData);
    notifiedSocketIds.push(driver.driverSocketId || driver.driverRoom);
  }

  if (notifiedSocketIds.length === 0) {
    return {
      ok: false,
      code: 'NO_MATCHING_DRIVER',
      message: `No online ${requestedVehicleType} drivers found nearby. Please try another category or try again later.`,
      notifiedSocketIds: [],
    };
  }

  rideRecipientSocketMap.set(rideData.rideId, new Set(notifiedSocketIds));

  console.log(
    `[Socket.IO] incomingRide sent to ${notifiedSocketIds.length} matching driver(s) for rideId=${rideData.rideId}`
  );

  return { ok: true, notifiedSocketIds, rideData };
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

    socket.on('registerPassenger', async (passengerId) => {
      registerPassengerSocket(socket, passengerId);
      console.log(
          `[Socket.IO] Passenger registered: userId=${passengerId} -> socketId=${socket.id}`
      );

      try {
        const passenger = await User.findById(passengerId).select('status').lean();
        if (passenger?.status) {
          emitPassengerAccountStatus(io, passengerId, passenger.status);
        }
      } catch (error) {
        console.error('[Socket.IO] Unable to emit passenger account status:', error.message);
      }
    });

    socket.on('registerDriver', async (driverId) => {
      const driverKey = String(driverId || '');
      if (!driverKey) return;
      registerDriverSocket(socket, driverKey);
      console.log(`[Socket.IO] Driver registered: driverId=${driverKey} -> socketId=${socket.id}`);

      try {
        const driver = await Driver.findById(driverKey).select('status').lean();
        if (driver?.status) {
          emitDriverAccountStatus(io, driverKey, driver.status);
        }
      } catch (error) {
        console.error('[Socket.IO] Unable to emit driver account status:', error.message);
      }
    });

    socket.on('updateDriverLocation', async ({ driverId, latitude, longitude, vehicleCategory, isOnline, heading }) => {
      let nextVehicleCategory = normalizeVehicleCategory(vehicleCategory);

      if (!nextVehicleCategory && driverId) {
        try {
          const driver = await Driver.findById(driverId).select('vehicle.category').lean();
          nextVehicleCategory = normalizeVehicleCategory(driver?.vehicle?.category);
        } catch (error) {
          console.error('[Socket.IO] Unable to load driver vehicle category:', error.message);
        }
      }

      const normalizedDriverId = driverId ? String(driverId) : '';
      if (normalizedDriverId) {
        const previousSocketId = driverSocketMap.get(normalizedDriverId);
        if (previousSocketId && previousSocketId !== socket.id) {
          driverLocationMap.delete(previousSocketId);
        }
        registerDriverSocket(socket, normalizedDriverId);
      }

      const previousLocation = driverLocationMap.get(socket.id);
      const nextIsOnline =
        typeof isOnline === 'boolean'
          ? isOnline
          : typeof previousLocation?.isOnline === 'boolean'
            ? previousLocation.isOnline
            : false;

      const updatedAt = Date.now();
      const numericLatitude = Number(latitude);
      const numericLongitude = Number(longitude);
      const validCoordinates = Number.isFinite(numericLatitude) && Number.isFinite(numericLongitude);

      driverLocationMap.set(socket.id, {
        driverId,
        latitude: numericLatitude,
        longitude: numericLongitude,
        vehicleCategory: nextVehicleCategory,
        isOnline: nextIsOnline,
        heading,
        updatedAt,
      });

      if (normalizedDriverId) {
        const update = {
          isOnline: nextIsOnline,
          availabilityStatus: nextIsOnline ? 'Available' : 'Offline',
          ...(nextVehicleCategory && { 'vehicle.category': nextVehicleCategory }),
        };

        if (validCoordinates) {
          update.currentLocation = {
            type: 'Point',
            coordinates: [numericLongitude, numericLatitude],
          };
          update.locationUpdatedAt = new Date(updatedAt);
        }

        try {
          await Driver.findByIdAndUpdate(normalizedDriverId, update, { runValidators: true });
        } catch (error) {
          console.error('[Socket.IO] Unable to persist driver location:', error.message);
        }
      }

      io.emit('drivers_location_update', {
        driverId: driverId || socket.id,
        latitude: numericLatitude,
        longitude: numericLongitude,
        vehicleCategory: nextVehicleCategory,
        isOnline: nextIsOnline,
        heading,
        updatedAt,
      });
      socket.broadcast.emit(`driver_location_${driverId}`, { latitude, longitude, heading });
    });

    socket.on('get_all_driver_locations', () => {
      socket.emit('drivers_location_snapshot', getAllDriverLocationSnapshot());
    });

    socket.on('toggle_online_status', async ({ driverId, isOnline }) => {
      try {
        await Driver.findByIdAndUpdate(driverId, {
          isOnline,
          availabilityStatus: isOnline ? 'Available' : 'Offline',
        });

        const loc = driverLocationMap.get(socket.id);
        if (loc) {
          loc.isOnline = isOnline;
          loc.updatedAt = Date.now();
          driverLocationMap.set(socket.id, loc);
          io.emit('drivers_location_update', {
            driverId: loc.driverId || driverId || socket.id,
            latitude: Number(loc.latitude),
            longitude: Number(loc.longitude),
            vehicleCategory: loc.vehicleCategory,
            isOnline: Boolean(isOnline),
            heading: loc.heading,
            updatedAt: loc.updatedAt,
          });
        }
      } catch (error) {
        console.error('[Socket.IO] toggle_online_status error:', error);
      }
    });

    socket.on('get_available_drivers', async ({ category, latitude, longitude }) => {
      const available = [];
      const requestedCategory = normalizeVehicleCategory(category);
      const candidates = getOnlineDriverLocations(requestedCategory);
      const driverIds = candidates
        .map(({ location }) => String(location?.driverId || ''))
        .filter((id) => id.length > 0);
      const approvedDrivers = new Set();

      if (driverIds.length > 0) {
        try {
          const drivers = await Driver.find({ _id: { $in: driverIds } })
            .select('documents')
            .lean();
          for (const driver of drivers) {
            if (isDriverKycApproved(driver)) {
              approvedDrivers.add(String(driver._id));
            }
          }
        } catch (error) {
          console.error('[Socket.IO] get_available_drivers error:', error.message);
        }
      }

      for (const { location } of candidates) {
        if (!approvedDrivers.has(String(location?.driverId || ''))) continue;
        const hasPassengerCoords = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
        if (hasPassengerCoords) {
          const dist = haversineDistanceKm(
            Number(latitude),
            Number(longitude),
            location.latitude,
            location.longitude
          );

          if (dist > DRIVER_DISPLAY_RADIUS_KM) continue;
          available.push({ ...location, distanceKm: Number(dist.toFixed(2)) });
        } else {
          available.push(location);
        }
      }

      if (available.length === 0 && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
        try {
          const dbDrivers = await findNearbyAvailableDrivers({
            pickup: { latitude: Number(latitude), longitude: Number(longitude) },
            vehicleType: requestedCategory,
            radiusKm: DRIVER_DISPLAY_RADIUS_KM,
          });

          for (const driver of dbDrivers) {
            if (!isDriverKycApproved(driver) || !hasValidGeoPoint(driver)) continue;

            const [driverLongitude, driverLatitude] = driver.currentLocation.coordinates;
            const distanceKm = haversineDistanceKm(
              Number(latitude),
              Number(longitude),
              driverLatitude,
              driverLongitude
            );

            if (distanceKm > DRIVER_DISPLAY_RADIUS_KM) continue;

            available.push({
              driverId: String(driver._id),
              latitude: driverLatitude,
              longitude: driverLongitude,
              vehicleCategory: driver.vehicle?.category,
              isOnline: Boolean(driver.isOnline),
              updatedAt: driver.locationUpdatedAt?.getTime?.() ?? Date.now(),
              distanceKm: Number(distanceKm.toFixed(2)),
            });
          }
        } catch (error) {
          console.error('[Socket.IO] get_available_drivers Mongo fallback error:', error.message);
        }
      }

      socket.emit('available_drivers', available);
    });

    socket.on('requestRide', async (payload) => {
      console.log('[Socket.IO] requestRide received:', payload);

      const { passengerId } = payload || {};
      if (passengerId) {
        registerPassengerSocket(socket, passengerId);
      }

      socket.emit('rideError', {
        code: 'REST_RIDE_CREATE_REQUIRED',
        message: 'Ride creation now uses POST /api/rides. Please update the app and try again.',
      });
    });

    socket.on('acceptRide', async (payload) => {
      console.log('[Socket.IO] acceptRide received:', payload);

      if (DISABLE_DRIVER_REQUESTS) {
        socket.emit('rideError', {
          code: 'DRIVER_REQUESTS_DISABLED',
          message: 'Driver requests are temporarily disabled.',
        });
        return;
      }

      try {
        const { rideId, driverId } = payload;
        let currentDriverLocation = getDriverLocationById(driverId);
        if (!currentDriverLocation?.isOnline) {
          const driverLocationDoc = await Driver.findById(driverId)
            .select('isOnline availabilityStatus currentLocation vehicle')
            .lean();

          if (
            driverLocationDoc?.isOnline &&
            driverLocationDoc.availabilityStatus === 'Available' &&
            hasValidGeoPoint(driverLocationDoc)
          ) {
            const [longitude, latitude] = driverLocationDoc.currentLocation.coordinates;
            currentDriverLocation = {
              driverId,
              latitude,
              longitude,
              vehicleCategory: driverLocationDoc.vehicle?.category,
              isOnline: true,
              updatedAt: driverLocationDoc.locationUpdatedAt?.getTime?.() ?? Date.now(),
            };
          }
        }

        if (!currentDriverLocation?.isOnline) {
          socket.emit('rideError', {
            code: 'DRIVER_OFFLINE',
            message: 'Go online before accepting ride requests.',
          });
          return;
        }

        const driverProfile = await Driver.findById(driverId).select('documents').lean();
        if (!isDriverKycApproved(driverProfile)) {
          socket.emit('rideError', {
            code: 'DRIVER_KYC_PENDING',
            message: 'Upload and get approval for license, insurance, and registration to accept rides.',
          });
          return;
        }

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

        const driver = await Driver.findById(driverId).select('fullName phoneNumber profileImageUrl vehicle').lean();
        const driverLocation = getDriverLocationById(driverId) || currentDriverLocation;
        const acceptanceData = {
          rideId: ride._id.toString(),
          driverId,
          driverName: driver?.fullName || 'Driver',
          driverImage: driver?.profileImageUrl || '',
          driverPhoneNumber: driver?.phoneNumber || '',
          driverVehicle: driver?.vehicle || null,
          driverLocation: driverLocation
            ? {
                latitude: driverLocation.latitude,
                longitude: driverLocation.longitude,
              }
            : null,
          status: ride.status,
          canonicalStatus: 'ACCEPTED',
          acceptedAt: ride.acceptedAt,
          pickup: ride.pickup,
          dropoff: ride.dropoff,
          vehicleType: ride.vehicleType,
        };

        emitToPassenger(io, ride.passengerId, 'rideAccepted', acceptanceData);
        emitToPassenger(io, ride.passengerId, 'rideStatusUpdate', acceptanceData);
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

    // Verification gate before ACCEPTED -> ARRIVED
    socket.on('driver_arrived', async (payload) => {
      console.log('[Socket.IO] driver_arrived received:', payload);
      try {
        const { rideId, driverId } = payload || {};

        if (!rideId || !driverId) {
          socket.emit('rideError', { message: 'rideId and driverId are required.' });
          return;
        }

        const ride = await Ride.findById(rideId);
        if (!ride) {
          socket.emit('rideError', { message: `Ride ${rideId} not found.` });
          return;
        }

        if (String(ride.driverId || '') !== String(driverId)) {
          socket.emit('rideError', { message: 'Driver is not assigned to this ride.' });
          return;
        }

        if (toCanonicalStatus(ride.status) !== 'ACCEPTED') {
          socket.emit('rideError', { message: 'Arrival can only be confirmed for an accepted ride.' });
          return;
        }

        const code = createArrivalCode();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        arrivalVerificationMap.set(String(rideId), {
          code,
          driverId: String(driverId),
          expiresAt: expiresAt.getTime(),
        });
        ride.arrivalVerificationCode = code;
        ride.arrivalVerificationExpiresAt = expiresAt;
        await ride.save();

        const arrivalCodePayload = {
          rideId: ride._id.toString(),
          passengerId: String(ride.passengerId),
          code,
        };

        emitToPassenger(io, ride.passengerId, 'arrivalVerificationCode', arrivalCodePayload);
        io.emit('arrivalVerificationCodeBroadcast', arrivalCodePayload);

        socket.emit('arrivalCodeRequested', {
          rideId: ride._id.toString(),
          code,
          expiresInSeconds: 300,
        });
      } catch (error) {
        console.error('[Socket.IO] driver_arrived error:', error.message);
        socket.emit('rideError', { message: 'Failed to request arrival code.' });
      }
    });

    socket.on('confirm_arrival_code', async (payload) => {
      console.log('[Socket.IO] confirm_arrival_code received:', { rideId: payload?.rideId, driverId: payload?.driverId });
      try {
        const { rideId, driverId, code } = payload || {};
        const saved = arrivalVerificationMap.get(String(rideId));

        if (!rideId || !driverId || !code) {
          socket.emit('rideError', { code: 'INVALID_ARRIVAL_CODE', message: 'Please enter the passenger code.' });
          return;
        }

        if (!saved || saved.driverId !== String(driverId) || saved.expiresAt < Date.now()) {
          arrivalVerificationMap.delete(String(rideId));
          socket.emit('rideError', { code: 'INVALID_ARRIVAL_CODE', message: 'Arrival code expired. Please request a new code.' });
          return;
        }

        if (String(code).trim() !== saved.code) {
          socket.emit('rideError', { code: 'INVALID_ARRIVAL_CODE', message: 'Incorrect passenger code.' });
          return;
        }

        arrivalVerificationMap.delete(String(rideId));
        await Ride.findByIdAndUpdate(rideId, {
          arrivalVerificationCode: null,
          arrivalVerificationExpiresAt: null,
        });
        await handleStrictTransition(io, socket, { rideId, driverId }, {
          nextCanonicalStatus: 'ARRIVED',
          passengerEvent: 'driver_arrived',
        });
      } catch (error) {
        console.error('[Socket.IO] confirm_arrival_code error:', error.message);
        socket.emit('rideError', { message: 'Failed to confirm arrival code.' });
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
      arrivalVerificationMap.forEach((value, rideId) => {
        if (value.expiresAt < Date.now()) arrivalVerificationMap.delete(rideId);
      });
      for (const [driverId, socketId] of driverSocketMap.entries()) {
        if (socketId === socket.id) {
          driverSocketMap.delete(driverId);
          break;
        }
      }

      for (const [passengerId, socketIds] of passengerSocketMap.entries()) {
        if (socketIds.delete(socket.id)) {
          if (socketIds.size === 0) {
            passengerSocketMap.delete(passengerId);
          }
          console.log(`[Socket.IO] Cleaned up passenger mapping for userId=${passengerId}`);
          break;
        }
      }

      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = {
  initRideSocket,
  broadcastRideRequestToNearbyDrivers,
  buildPromotionUsage,
  calculateRideBasePrice,
  emitRemoveRideRequest,
  emitPassengerAccountStatus,
  emitDriverAccountStatus,
  normalizeVehicleCategory,
};
