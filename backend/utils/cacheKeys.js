const stableStringify = (value) => {
  if (!value || typeof value !== 'object') return String(value || '');
  const keys = Object.keys(value).sort();
  return keys.map(key => `${key}:${value[key]}`).join('|');
};

const userScope = (req) => {
  const user = req.user || {};
  return [
    `user:${user._id || 'anonymous'}`,
    `role:${user.role || 'guest'}`,
    `department:${user.department || 'none'}`,
    `branch:${user.branch || 'none'}`,
    `semester:${user.semester || 'none'}`
  ].join(':');
};

const requestCacheKey = (domain, req) => [
  'studysphere',
  domain,
  userScope(req),
  req.method,
  req.baseUrl || '',
  req.path || '',
  stableStringify(req.params),
  stableStringify(req.query)
].join(':');

module.exports = {
  requestCacheKey,
  userScope
};
