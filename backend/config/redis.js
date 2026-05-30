const { createClient } = require('redis');

let redisClient = null;
let redisConnectionPromise = null;
let redisDisabledUntil = 0;
let lastRedisWarning = '';

const readMs = (value, fallback, max = Number.POSITIVE_INFINITY) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const MAX_REDIS_WAIT_MS = readMs(process.env.REDIS_MAX_WAIT_MS, 30 * 1000, 30 * 1000);
const CONNECT_TIMEOUT_MS = readMs(process.env.REDIS_CONNECT_TIMEOUT_MS, 10 * 1000, MAX_REDIS_WAIT_MS);
const COMMAND_TIMEOUT_MS = readMs(process.env.REDIS_COMMAND_TIMEOUT_MS, 2500, MAX_REDIS_WAIT_MS);
const RETRY_COOLDOWN_MS = readMs(process.env.REDIS_RETRY_COOLDOWN_MS, 60 * 1000);
const REDIS_SOCKET_FAMILY = Number(process.env.REDIS_SOCKET_FAMILY || 4);

const isCacheEnabled = () => {
  if (String(process.env.CACHE_ENABLED || 'true').toLowerCase() === 'false') return false;
  return Boolean(process.env.REDIS_URL);
};

const warnOnce = (message) => {
  if (lastRedisWarning === message) return;
  lastRedisWarning = message;
  console.warn(message);
};

const normalizeRedisUrl = () => {
  const rawUrl = (process.env.REDIS_URL || '').trim();
  if (!rawUrl) return null;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    warnOnce('Redis disabled: REDIS_URL is not a valid URL. Use rediss://... for Upstash TLS Redis.');
    return null;
  }

  if (['http:', 'https:'].includes(parsed.protocol)) {
    warnOnce('Redis disabled: REDIS_URL must be a Redis connection URL, not the Upstash REST URL.');
    return null;
  }

  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    warnOnce(`Redis disabled: unsupported REDIS_URL protocol "${parsed.protocol}".`);
    return null;
  }

  if (parsed.hostname.endsWith('.upstash.io') && parsed.protocol === 'redis:') {
    parsed.protocol = 'rediss:';
  }

  return parsed.toString();
};

const withTimeout = (promise, timeoutMs, label) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    timeoutId.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

const getRedisClient = () => {
  if (!redisClient) {
    const url = normalizeRedisUrl();
    if (!url) return null;
    const parsedUrl = new URL(url);
    const isTls = parsedUrl.protocol === 'rediss:';

    redisClient = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        family: [4, 6].includes(REDIS_SOCKET_FAMILY) ? REDIS_SOCKET_FAMILY : undefined,
        tls: isTls,
        servername: isTls ? parsedUrl.hostname : undefined,
        reconnectStrategy: (retries) => Math.min(retries * 100, 1000),
      },
    });

    redisClient.on('error', (error) => {
      warnOnce(`Redis error: ${error.message}`);
    });

    redisClient.on('end', () => {
      redisConnectionPromise = null;
    });
  }

  return redisClient;
};

const connectRedis = async () => {
  if (!isCacheEnabled()) return null;
  if (Date.now() < redisDisabledUntil) return null;

  const client = getRedisClient();
  if (!client) return null;
  if (client.isOpen && client.isReady) return client;

  if (!redisConnectionPromise) {
    redisConnectionPromise = withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'Redis connection')
      .then(() => {
        console.log('Redis connected');
        return client;
      })
      .catch((error) => {
        redisConnectionPromise = null;
        redisDisabledUntil = Date.now() + RETRY_COOLDOWN_MS;
        try {
          client.destroy?.();
        } catch (_) {}
        redisClient = null;
        warnOnce(`Redis cache unavailable: ${error.message}. Retrying in ${Math.round(RETRY_COOLDOWN_MS / 1000)}s.`);
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

const getRedisStatus = () => ({
  enabled: isCacheEnabled(),
  connected: Boolean(redisClient?.isReady),
  coolingDown: Date.now() < redisDisabledUntil,
  retryAfterMs: Math.max(0, redisDisabledUntil - Date.now()),
});

module.exports = {
  COMMAND_TIMEOUT_MS,
  connectRedis,
  closeRedis,
  getRedisClient,
  getRedisStatus,
  isCacheEnabled,
  withTimeout,
};
