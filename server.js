const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

const connectDB = require('./src/config/db');
const { initRideSocket } = require('./src/sockets/rideSocket');

dotenv.config();

const app = express();

// ── HTTP + Socket.IO bootstrap ────────────────────────────────────────────────
// Wrap Express in a plain Node HTTP server so Socket.IO can share the same port.
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',       // Allow all origins (Expo dev clients on any IP)
    methods: ['GET', 'POST'],
  },
});

// Register all ride socket events
initRideSocket(io);
app.set('io', io);

// ── Express middleware ────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Database ──────────────────────────────────────────────────────────────────
connectDB();

// ── REST routes ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  return res.status(200).json({ status: 'ok', service: 'nexgo-backend' });
});

app.get('/api/health', (_req, res) => {
  return res.status(200).json({ status: 'ok', service: 'nexgo-backend' });
});

app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/driver-auth', require('./src/routes/driverAuthRoutes'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api/upload', require('./src/routes/uploadRoutes'));
app.use('/api/rides', require('./src/routes/rideRoutes'));
app.use('/api/promotions', require('./src/routes/promotionRoutes'));
app.use('/api/support-tickets', require('./src/routes/supportTicketRoutes'));

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

// IMPORTANT: listen on httpServer (not app) so Socket.IO is attached correctly.
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.IO ready — ws://0.0.0.0:${PORT}`);
});
