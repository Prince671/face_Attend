const { getCache, setCache } = require('../utils/cache');
const { requestCacheKey } = require('../utils/cacheKeys');

const cacheMiddleware = (domain, ttlSeconds, keyBuilder) => async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const key = keyBuilder ? keyBuilder(req) : requestCacheKey(domain, req);
  const cached = await getCache(key);
  if (cached) {
    res.setHeader('X-StudySphere-Cache', 'HIT');
    return res.status(cached.statusCode || 200).json(cached.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && body?.success !== false) {
      setCache(key, { statusCode: res.statusCode, body }, ttlSeconds).catch(() => {});
      res.setHeader('X-StudySphere-Cache', 'MISS');
    }
    return originalJson(body);
  };

  return next();
};

module.exports = { cacheMiddleware };
