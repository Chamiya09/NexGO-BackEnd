const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not set in environment variables');
    }

    const conn = await mongoose
      .connect(process.env.MONGO_URI, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10000,
      })
      .catch((err) => {
        console.log('DB Error', err);
        throw err;
      });

    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
