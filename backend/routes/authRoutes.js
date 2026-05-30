const express = require('express');
const router = express.Router();
const {
  detectRegistrationFace,
  sendRegistrationOtp,
  verifyRegistrationOtp,
  sendProfileEmailOtp,
  verifyProfileEmailOtp,
  register,
  login,
  sendForgotPasswordOtp,
  verifyForgotPasswordOtp,
  resetForgotPassword,
  faceLogin,
  beginBiometricRegistration,
  finishBiometricRegistration,
  beginBiometricLogin,
  finishBiometricLogin,
  getMe,
  updateProfile,
  updateAdminScope
} = require('../controllers/authController');
const {
  getPreferences,
  getPreference,
  setPreference,
  deletePreference
} = require('../controllers/preferenceController');
const { protect, adminOnly, adminOrTeacher } = require('../middleware/authMiddleware');
const { uploadProfile, uploadCapture } = require('../middleware/uploadMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.post('/detect-registration-face', uploadCapture.single('guideFrame'), detectRegistrationFace);
router.post('/registration/send-otp', sendRegistrationOtp);
router.post('/registration/verify-otp', verifyRegistrationOtp);
router.post('/profile-email/send-otp', protect, sendProfileEmailOtp);
router.post('/profile-email/verify-otp', protect, verifyProfileEmailOtp);
router.post('/register', uploadProfile.single('profileImage'), register);
router.post('/login', login);
router.post('/forgot-password/send-otp', sendForgotPasswordOtp);
router.post('/forgot-password/verify-otp', verifyForgotPasswordOtp);
router.post('/forgot-password/reset', resetForgotPassword);
router.post('/face-login', uploadCapture.fields([
  { name: 'faceCapture', maxCount: 1 },
  { name: 'livenessFrames', maxCount: 6 }
]), faceLogin);
router.post('/biometric/register/options', protect, beginBiometricRegistration);
router.post('/biometric/register/verify', protect, finishBiometricRegistration);
router.post('/biometric/login/options', beginBiometricLogin);
router.post('/biometric/login/verify', finishBiometricLogin);
router.get('/me', protect, cacheMiddleware('profile', 60), getMe);
router.get('/preferences', protect, getPreferences);
router.get('/preferences/:key', protect, getPreference);
router.put('/preferences/:key', protect, setPreference);
router.delete('/preferences/:key', protect, deletePreference);
router.put('/update-profile', protect, uploadProfile.single('profileImage'), invalidateAfter(updateProfile, ['profile', 'dashboard', 'student-dashboard', 'admin-dashboard', 'chat-groups']));
router.put('/admin-scope', protect, adminOrTeacher, invalidateAfter(updateAdminScope, ['profile', 'dashboard', 'admin-dashboard', 'subjects', 'analytics']));

module.exports = router;
