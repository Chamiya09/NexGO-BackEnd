const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

const connectDB = require('./src/config/db');

dotenv.config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

connectDB();

app.get('/health', (_req, res) => {
  return res.status(200).json({ status: 'ok', service: 'nexgo-backend' });
});

app.get('/api/health', (_req, res) => {
  return res.status(200).json({ status: 'ok', service: 'nexgo-backend' });
});

app.use('/api/auth', require('./src/routes/authRoutes'));

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
