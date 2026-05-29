const mongoose = require('mongoose');
const dns = require('dns');

mongoose.set('strictQuery', true);
dns.setServers((process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8').split(',').map((server) => server.trim()));

const connectDB = async () => {
  try {
    const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 50);
    const minPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || 5);

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize,
      minPoolSize,
      family: 4,
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
