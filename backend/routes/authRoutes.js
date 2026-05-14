const express = require('express');
const router = express.Router();
const {
  detectRegistrationFace,
  register,
  login,
  faceLogin,
  beginBiometricRegistration,
  finishBiometricRegistration,
  beginBiometricLogin,
  finishBiometricLogin,
  getMe,
  updateProfile,
  updateAdminScope
} = require('../controllers/authController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { uploadProfile, uploadCapture } = require('../middleware/uploadMiddleware');

router.post('/detect-registration-face', uploadCapture.single('guideFrame'), detectRegistrationFace);
router.post('/register', uploadProfile.single('profileImage'), register);
router.post('/login', login);
router.post('/face-login', uploadCapture.fields([
  { name: 'faceCapture', maxCount: 1 },
  { name: 'livenessFrames', maxCount: 6 }
]), faceLogin);
router.post('/biometric/register/options', protect, beginBiometricRegistration);
router.post('/biometric/register/verify', protect, finishBiometricRegistration);
router.post('/biometric/login/options', beginBiometricLogin);
router.post('/biometric/login/verify', finishBiometricLogin);
router.get('/me', protect, getMe);
router.put('/update-profile', protect, updateProfile);
router.put('/admin-scope', protect, adminOnly, updateAdminScope);

module.exports = router;
