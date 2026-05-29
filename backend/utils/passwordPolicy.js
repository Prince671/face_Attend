const validateStrongPassword = (password = '') => {
  const value = String(password || '');
  const errors = [];
  if (value.length < 8) errors.push('at least 8 characters');
  if (!/[A-Z]/.test(value)) errors.push('one uppercase letter');
  if (!/[a-z]/.test(value)) errors.push('one lowercase letter');
  if (!/[0-9]/.test(value)) errors.push('one number');
  if (!/[^A-Za-z0-9]/.test(value)) errors.push('one special character');

  return {
    valid: errors.length === 0,
    errors,
    message: errors.length ? `Password must contain ${errors.join(', ')}.` : ''
  };
};

module.exports = { validateStrongPassword };
