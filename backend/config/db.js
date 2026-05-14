const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

const connectDB = async () => {
  try {
    const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 50);
    const minPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || 5);

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize,
      minPoolSize,
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
      socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
    });

    console.log(`MongoDB connected: ${conn.connection.host} (pool ${minPoolSize}-${maxPoolSize})`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
