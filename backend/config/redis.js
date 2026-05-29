const { createClient } = require('redis');

let redisClient = null;
let redisConnectionPromise = null;

const isCacheEnabled = () => String(process.env.CACHE_ENABLED || 'true').toLowerCase() !== 'false';

const getRedisClient = () => {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
      },
    });

    redisClient.on('error', (error) => {
      console.warn('Redis error:', error.message);
    });
  }

  return redisClient;
};

const connectRedis = async () => {
  if (!isCacheEnabled()) return null;

  const client = getRedisClient();
  if (client.isOpen) return client;

  if (!redisConnectionPromise) {
    redisConnectionPromise = client.connect()
      .then(() => {
        console.log('Redis connected');
        return client;
      })
      .catch((error) => {
        redisConnectionPromise = null;
        console.warn('Redis connection failed:', error.message);
        return null;
      });
  }

  return redisConnectionPromise;
};

const closeRedis = async () => {
  if (redisClient?.isOpen) {
    await redisClient.quit();
  }
};

module.exports = {
  connectRedis,
  closeRedis,
  getRedisClient,
  isCacheEnabled,
};
