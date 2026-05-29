const { COMMAND_TIMEOUT_MS, connectRedis, isCacheEnabled, withTimeout } = require('../config/redis');

const DEFAULT_TTL = Number(process.env.CACHE_DEFAULT_TTL_SECONDS || 60);

const getCache = async (key) => {
  if (!isCacheEnabled()) return null;
  const client = await connectRedis();
  if (!client?.isOpen) return null;
  try {
    const raw = await withTimeout(client.get(key), COMMAND_TIMEOUT_MS, 'Redis get');
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Redis get failed:', error.message);
    return null;
  }
};

const setCache = async (key, value, ttlSeconds = DEFAULT_TTL) => {
  if (!isCacheEnabled()) return false;
  const client = await connectRedis();
  if (!client?.isOpen) return false;
  try {
    await withTimeout(
      client.set(key, JSON.stringify(value), { EX: Math.max(1, Number(ttlSeconds) || DEFAULT_TTL) }),
      COMMAND_TIMEOUT_MS,
      'Redis set'
    );
    return true;
  } catch (error) {
    console.warn('Redis set failed:', error.message);
    return false;
  }
};

const delCache = async (...keys) => {
  const filtered = keys.flat().filter(Boolean);
  if (!filtered.length || !isCacheEnabled()) return 0;
  const client = await connectRedis();
  if (!client?.isOpen) return 0;
  try {
    return withTimeout(client.del(filtered), COMMAND_TIMEOUT_MS, 'Redis delete');
  } catch (error) {
    console.warn('Redis delete failed:', error.message);
    return 0;
  }
};

const delByPattern = async (pattern) => {
  if (!pattern || !isCacheEnabled()) return 0;
  const client = await connectRedis();
  if (!client?.isOpen) return 0;
  let deleted = 0;
  try {
    for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      deleted += await withTimeout(client.del(key), COMMAND_TIMEOUT_MS, 'Redis pattern delete');
    }
  } catch (error) {
    console.warn('Redis pattern delete failed:', error.message);
  }
  return deleted;
};

module.exports = {
  DEFAULT_TTL,
  getCache,
  setCache,
  delCache,
  delByPattern
};
