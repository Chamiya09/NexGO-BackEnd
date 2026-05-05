<div align="center">

# NexGO BackEnd

### The API, realtime ride engine, and data layer behind NexGO.

[![Node.js](https://img.shields.io/badge/Node.js-Express_5-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Realtime-010101?style=for-the-badge&logo=socket.io)](https://socket.io/)
[![Cloudinary](https://img.shields.io/badge/Cloudinary-Uploads-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white)](https://cloudinary.com/)

</div>

## What It Does

`NexGO-BackEnd` powers the passenger, driver, and admin apps with REST APIs and Socket.IO events. It handles account sessions, ride matching, live locations, trip lifecycle updates, wallet/payment data, driver documents, uploads, promotions, reviews, and support tickets.

## Core Modules

| Module | Responsibility |
| --- | --- |
| `src/controllers` | Request handling for auth, rides, reviews, support, promotions, admin workflows |
| `src/models` | MongoDB schemas for users, drivers, rides, reviews, tickets, promotions, admins |
| `src/routes` | Express route groups mounted under `/api` |
| `src/sockets` | Realtime ride and driver-location events |
| `src/services` | Ride lifecycle, billing, and email services |
| `src/middleware` | Admin auth, rate limiting, uploads |
| `src/config` | Database and Cloudinary configuration |

## Launch

```bash
npm install
cp .env.example .env
npm run dev
```

Default local server:

```text
http://localhost:5000
```

Health checks:

```text
GET /
GET /health
GET /api/health
```

## Environment

Create `.env`:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
SESSION_SECRET=your_session_secret

PASSWORD_RESET_OTP_SECRET=your_otp_secret
PAYMENT_METHOD_SECRET=your_payment_secret

BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=verified_sender@example.com
BREVO_SENDER_NAME=NexGO
BREVO_REQUEST_TIMEOUT_MS=10000
PASSWORD_RESET_OTP_TTL_MINUTES=10
PASSWORD_RESET_RESEND_SECONDS=60
PASSWORD_RESET_MAX_ATTEMPTS=5

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

Brevo powers password reset OTP email. The sender email must be verified in Brevo. If `BREVO_API_KEY` or `BREVO_SENDER_EMAIL` is missing, OTP endpoints return `503 Email service is not configured`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the API |
| `npm run dev` | Start the API in development mode |
| `npm test` | Placeholder test command |

## REST API

Base URL:

```text
http://<SERVER_HOST>:5000/api
```

| Group | Purpose |
| --- | --- |
| `/api/auth` | Passenger auth, profile, saved addresses, payment methods, wallet |
| `/api/driver-auth` | Driver auth, vehicle, documents, security, checkout |
| `/api/admin` | Admin auth, analytics, admin profile, admin management |
| `/api/rides` | Ride creation, trip history, active ride detail, payment, reviews |
| `/api/reviews` | Review CRUD and moderation |
| `/api/promotions` | Promotion listing, validation, management |
| `/api/support-tickets` | Passenger, driver, and admin support workflows |
| `/api/upload` | Cloudinary upload gateway |

Complete route reference: `../NexGO_API_Reference.txt`.

## Auth Model

```http
Authorization: Bearer <JWT>
```

| Account | Login Endpoint | Protected By |
| --- | --- | --- |
| Passenger | `POST /api/auth/login` | Passenger token checks in controllers |
| Driver | `POST /api/driver-auth/login` | Driver token/session checks |
| Admin | `POST /api/admin/login` | `requireAdmin` middleware |

## Uploads

Endpoint:

```text
POST /api/upload
```

Send multipart form data with one field:

```text
file
```

The response includes `fileUrl`, `secureUrl`, `publicId`, `mimetype`, and file metadata.

## Socket.IO Ride Engine

Socket URL:

```text
http://<SERVER_HOST>:5000
```

| Client Event | Purpose |
| --- | --- |
| `registerPassenger` | Attach passenger socket to passenger room |
| `registerDriver` | Attach driver socket to driver room |
| `updateDriverLocation` | Publish driver position and online state |
| `toggle_online_status` | Mark driver online/offline |
| `get_available_drivers` | Return nearby available drivers |
| `requestRide` | Create/request ride through realtime channel |
| `acceptRide` | Assign driver and notify passenger |
| `cancelRide` | Cancel active/requested ride |
| `driver_arrived` | Generate arrival verification flow |
| `confirm_arrival_code` | Verify passenger code |
| `start_trip` | Move ride to active trip |
| `complete_trip` | Complete trip and emit final state |

## Notes

- The server listens on `0.0.0.0` so mobile devices on the same network can reach it.
- CORS is open for Expo development.
- Keep mobile app URLs in the form `http://YOUR_LOCAL_IP:5000/api`.
- Keep secrets out of git.

