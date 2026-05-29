export const passwordRules = [
  { id: 'length', label: 'At least 8 characters', test: value => String(value || '').length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: value => /[A-Z]/.test(value || '') },
  { id: 'lower', label: 'One lowercase letter', test: value => /[a-z]/.test(value || '') },
  { id: 'number', label: 'One number', test: value => /[0-9]/.test(value || '') },
  { id: 'special', label: 'One special character', test: value => /[^A-Za-z0-9]/.test(value || '') }
];

export const getPasswordIssues = (password) => passwordRules
  .filter(rule => !rule.test(password))
  .map(rule => rule.label);

export const isStrongPassword = (password) => getPasswordIssues(password).length === 0;
