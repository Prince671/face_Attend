const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password -faceEncoding -biometricCredential -biometricChallenge');

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    if (req.user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact admin.' });
    }

    if (req.user.status === 'pending') {
      return res.status(403).json({ success: false, message: 'Account pending admin approval.' });
    }

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Access denied: Admins only' });
};

const teacherOnly = (req, res, next) => {
  if (req.user && req.user.role === 'teacher') return next();
  return res.status(403).json({ success: false, message: 'Access denied: Teachers only' });
};

const adminOrTeacher = (req, res, next) => {
  if (req.user && ['admin', 'teacher'].includes(req.user.role)) return next();
  return res.status(403).json({ success: false, message: 'Access denied: Staff only' });
};

const studentOnly = (req, res, next) => {
  if (req.user && req.user.role === 'student') return next();
  return res.status(403).json({ success: false, message: 'Access denied: Students only' });
};

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
};

module.exports = { protect, adminOnly, teacherOnly, adminOrTeacher, studentOnly, generateToken };
