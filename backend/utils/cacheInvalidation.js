const { delByPattern } = require('./cache');

const domainPattern = (domain) => `studysphere:${domain}:*`;

const invalidateDomains = async (...domains) => {
  const uniqueDomains = [...new Set(domains.flat().filter(Boolean))];
  await Promise.all(uniqueDomains.map(domain => delByPattern(domainPattern(domain))));
};

const invalidateDashboardCache = () => invalidateDomains('dashboard', 'student-dashboard', 'admin-dashboard', 'analytics');
const invalidateLmsCache = () => invalidateDomains('lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard');
const invalidateChatCache = () => invalidateDomains('chat-groups', 'chat-gallery');
const invalidateAcademicCache = () => invalidateDomains('subjects', 'timetable', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics');
const invalidateNotificationCache = () => invalidateDomains('notifications');

const invalidateAfter = (handler, domains = []) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  let invalidated = false;

  res.json = (body) => {
    if (!invalidated && res.statusCode >= 200 && res.statusCode < 300 && body?.success !== false) {
      invalidated = true;
      invalidateDomains(domains).catch(error => {
        console.warn('Cache invalidation failed:', error.message);
      });
    }
    return originalJson(body);
  };

  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  invalidateAfter,
  invalidateDomains,
  invalidateDashboardCache,
  invalidateLmsCache,
  invalidateChatCache,
  invalidateAcademicCache,
  invalidateNotificationCache
};
