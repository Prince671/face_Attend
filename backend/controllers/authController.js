const User = require('../models/User');
const Notification = require('../models/Notification');
const { generateToken } = require('../middleware/authMiddleware');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const { uploadImage, downloadImage, isRemoteImage } = require('../utils/cloudinary');
const { SYSTEM_ADMIN_DEPARTMENT, adminDepartmentRoom, getAdminDepartment } = require('../utils/adminScope');
const {
  base64url,
  fromBase64url,
  randomChallenge,
  expectedRpId,
  parseAttestationObject,
  verifyClientData,
  verifyAssertion
} = require('../utils/webauthn');

const safeUserPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  studentId: user.studentId,
  department: user.department,
  semester: user.semester,
  adminAcademicYear: user.adminAcademicYear,
  adminSemesterScope: user.adminSemesterScope,
  adminScopeSetAt: user.adminScopeSetAt,
  fatherName: user.fatherName,
  dateOfBirth: user.dateOfBirth,
  phone: user.phone,
  address: user.address,
  profileImage: user.profileImage,
  isRestricted: user.isRestricted,
  enrolledSubjects: user.enrolledSubjects,
  hasBiometric: Boolean(user.biometricCredential?.credentialId),
});

const cleanupFiles = (paths = []) => {
  paths.filter(Boolean).forEach(file => {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (_) {}
  });
};

const validateImageForEncoding = async (imagePath, filename = 'registration_face.jpg', timeout = 30000) => {
  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath), filename);
  const mlRes = await fetch(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/validate-face`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
    timeout
  });
  return mlRes.json();
};

const ensureFaceLoginEncoding = async (student) => {
  if (Array.isArray(student.faceEncoding) && student.faceEncoding.length > 0) {
    return true;
  }

  const source = student.faceImagePath || student.profileImage;
  if (!source) return false;

  let tempFile = null;
  try {
    const imagePath = isRemoteImage(source)
      ? await downloadImage(source, `face_login_profile_${student._id}`)
      : source;
    tempFile = isRemoteImage(source) ? imagePath : null;
    const validation = await validateImageForEncoding(imagePath, `profile_${student._id}.jpg`, 60000);
    if (!validation.valid || !Array.isArray(validation.encoding) || validation.encoding.length === 0) {
      return false;
    }
    student.faceEncoding = validation.encoding;
    student.faceImagePath = student.faceImagePath || student.profileImage;
    await student.save({ validateBeforeSave: false });
    return true;
  } catch (err) {
    console.error(`Face login encoding rebuild failed for ${student._id}:`, err.message);
    return false;
  } finally {
    cleanupFiles([tempFile]);
  }
};

const detectRegistrationFace = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        faceDetected: false,
        ready: false,
        message: 'Camera frame is required.'
      });
    }

    const validation = await validateImageForEncoding(req.file.path, req.file.originalname || 'registration_guide_frame.jpg');
    cleanupFiles([req.file.path]);

    return res.json({
      success: true,
      faceDetected: Boolean(validation.valid),
      ready: Boolean(validation.valid),
      message: validation.valid
        ? 'Face is inside the guide'
        : (validation.message || 'Move your face into the oval'),
      qualityScore: validation.quality_score,
      faceLocation: validation.face_location
    });
  } catch (err) {
    console.error('detectRegistrationFace error:', err.message);
    cleanupFiles([req.file?.path]);
    return res.status(503).json({
      success: false,
      faceDetected: false,
      ready: false,
      message: 'Face detection service is unavailable. Please try again.'
    });
  }
};

// @desc    Register new student
const register = async (req, res) => {
  let cloudinaryUpload = null;
  try {
    const { name, email, password, studentId, department, semester, phone, address, fatherName, dateOfBirth } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Profile image (passport photo) is required' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { studentId }] });
    if (existingUser) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ success: false, message: 'Email or Student ID already registered' });
    }

    // Send image to ML service for face validation
    let faceValidation = { valid: false, message: 'ML service unavailable' };
    try {
      faceValidation = await validateImageForEncoding(req.file.path, req.file.originalname);
    } catch (err) {
      console.error('ML service error during registration:', err.message);
      cleanupFiles([req.file.path]);
      return res.status(503).json({
        success: false,
        message: 'Face recognition service is not running. Start the ML service and try registration again.'
      });
    }

    if (!faceValidation.valid) {
      cleanupFiles([req.file.path]);
      return res.status(400).json({
        success: false,
        message: faceValidation.message || 'Face not clearly visible. Please upload a clear passport-size front-facing photo.'
      });
    }

    try {
      cloudinaryUpload = await uploadImage(req.file.path, {
        folder: `${process.env.CLOUDINARY_FOLDER || 'faceattend'}/profiles`,
        publicId: `student_${studentId}_${Date.now()}`
      });
    } catch (err) {
      console.error('Cloudinary upload error during registration:', err.message);
      cleanupFiles([req.file.path]);
      return res.status(503).json({
        success: false,
        message: 'Cloud image storage is unavailable. Check Cloudinary configuration and try registration again.',
        ...(process.env.NODE_ENV === 'development' && {
          error: err.code || err.message
        })
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      studentId,
      department,
      semester: parseInt(semester),
      fatherName,
      dateOfBirth: dateOfBirth || undefined,
      phone,
      address,
      profileImage: cloudinaryUpload.url,
      profileImagePublicId: cloudinaryUpload.publicId,
      faceEncoding: faceValidation.encoding || [],
      faceImagePath: cloudinaryUpload.url,
      status: 'pending',
      role: 'student'
    });

    cleanupFiles([req.file.path]);

    // Notify all admins
    const admins = await User.find({
      role: 'admin',
      status: 'active',
      department: { $in: [SYSTEM_ADMIN_DEPARTMENT, department] }
    });
    if (admins.length > 0) {
      const notifPromises = admins.map(admin =>
        Notification.create({
          recipient: admin._id,
          recipientRole: 'admin',
          type: 'registration_request',
          title: 'New Student Registration Request',
          message: `${name} (${studentId}) has registered and is awaiting approval.`,
          data: { studentId: user._id, studentName: name, email },
          priority: 'medium'
        })
      );
      await Promise.all(notifPromises);
    }

    // Emit socket event to admin room — null-safe
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('new_registration', {
        studentId: user._id,
        name: user.name,
        email: user.email,
        studentCode: user.studentId,
        department: user.department
      });
      io.to(adminDepartmentRoom(user.department)).emit('new_registration', {
        studentId: user._id,
        name: user.name,
        email: user.email,
        studentCode: user.studentId,
        department: user.department
      });
    }

    res.status(201).json({
      success: true,
      message: 'Registration submitted! Your account is pending admin approval. You will be notified once approved.'
    });
  } catch (err) {
    console.error('register error:', err);
    cleanupFiles([req.file?.path]);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Login user
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    if (user.pendingDeletion) {
      return res.status(403).json({ success: false, message: 'Your account is scheduled for deletion. Contact admin immediately if this is a mistake.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ success: false, message: 'Your account is pending admin approval.' });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact admin.' });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: safeUserPayload(user),
      requiresAdminScope: Boolean(getAdminDepartment(user))
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const faceLogin = async (req, res) => {
  const faceFile = req.file || req.files?.faceCapture?.[0] || null;
  const livenessFiles = req.files?.livenessFrames || [];
  const uploadedPaths = [faceFile?.path, ...livenessFiles.map(file => file.path)].filter(Boolean);

  try {
    if (!faceFile) {
      return res.status(400).json({ success: false, message: 'Face capture image is required.' });
    }
    if (livenessFiles.length < 3) {
      cleanupFiles(uploadedPaths);
      return res.status(400).json({ success: false, message: 'Live camera verification is required. Please try again from the camera.' });
    }

    const students = await User.find({
      role: 'student',
      status: { $nin: ['pending', 'inactive'] },
      pendingDeletion: { $ne: true }
    }).select('_id faceEncoding profileImage faceImagePath');

    const candidates = [];
    for (const student of students) {
      const ready = await ensureFaceLoginEncoding(student);
      if (!ready) continue;
      candidates.push({
        id: student._id.toString(),
        encoding: student.faceEncoding
      });
    }

    if (candidates.length === 0) {
      cleanupFiles(uploadedPaths);
      return res.status(503).json({
        success: false,
        message: 'No approved student face profiles are ready for Face ID login. Please use email and password.'
      });
    }

    let identification;
    try {
      const form = new FormData();
      form.append('image', fs.createReadStream(faceFile.path), faceFile.originalname || 'face_login.jpg');
      livenessFiles.forEach((liveFile, index) => {
        form.append('liveness_images', fs.createReadStream(liveFile.path), liveFile.originalname || `live_frame_${index}.jpg`);
      });
      form.append('candidates', JSON.stringify(candidates));

      const mlRes = await fetch(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/identify-face`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 60000
      });
      identification = await mlRes.json();
    } catch (err) {
      console.error('ML service error during face login:', err.message);
      cleanupFiles(uploadedPaths);
      return res.status(503).json({ success: false, message: 'Face recognition service unavailable. Use email and password for now.' });
    }

    if (!identification?.match || !identification.student_id) {
      cleanupFiles(uploadedPaths);
      return res.status(401).json({
        success: false,
        message: identification?.message || 'Face not recognized. Use email and password or try again in better lighting.',
        confidence: identification?.confidence
      });
    }

    const user = await User.findOne({
      _id: identification.student_id,
      role: 'student'
    });

    if (!user || user.pendingDeletion) {
      cleanupFiles(uploadedPaths);
      return res.status(403).json({ success: false, message: 'Student account is unavailable.' });
    }
    if (user.status === 'pending') {
      cleanupFiles(uploadedPaths);
      return res.status(403).json({ success: false, message: 'Your account is pending admin approval.' });
    }
    if (user.status === 'inactive') {
      cleanupFiles(uploadedPaths);
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact admin.' });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    cleanupFiles(uploadedPaths);

    return res.json({
      success: true,
      token: generateToken(user._id),
      user: safeUserPayload(user),
      confidence: identification.confidence,
      message: `Welcome back, ${user.name}!`
    });
  } catch (err) {
    console.error('faceLogin error:', err);
    cleanupFiles(uploadedPaths);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const beginBiometricRegistration = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Student access required' });
    }

    const challenge = randomChallenge();
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { biometricChallenge: challenge },
      { new: true, strict: false }
    );

    return res.json({
      success: true,
      options: {
        challenge,
        rp: { name: 'FaceAttend', id: expectedRpId() },
        user: {
          id: base64url(user._id.toString()),
          name: user.email,
          displayName: user.name
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required'
        },
        excludeCredentials: user.biometricCredential?.credentialId ? [{
          type: 'public-key',
          id: user.biometricCredential.credentialId,
          transports: user.biometricCredential.transports || ['internal']
        }] : []
      }
    });
  } catch (err) {
    console.error('beginBiometricRegistration error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const finishBiometricRegistration = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Student access required' });
    }

    const user = await User.findById(req.user._id).select('+biometricChallenge');
    const credential = req.body.credential;
    if (!user?.biometricChallenge || !credential?.response) {
      return res.status(400).json({ success: false, message: 'Biometric registration session expired. Try again.' });
    }

    const clientDataJSON = fromBase64url(credential.response.clientDataJSON);
    verifyClientData({ clientDataJSON, challenge: user.biometricChallenge, type: 'webauthn.create' });
    const parsed = parseAttestationObject(fromBase64url(credential.response.attestationObject));
    if (!parsed.userVerified) {
      return res.status(400).json({ success: false, message: 'Use fingerprint, face unlock, or screen lock to register biometric login.' });
    }

    user.biometricCredential = {
      credentialId: parsed.credentialId,
      publicKeyJwk: parsed.publicKeyJwk,
      counter: parsed.counter,
      transports: credential.response.transports || credential.transports || ['internal'],
      registeredAt: new Date(),
      deviceName: req.body.deviceName || 'This device'
    };
    user.biometricChallenge = undefined;
    await user.save({ validateBeforeSave: false, strict: false });

    return res.json({
      success: true,
      user: safeUserPayload(user),
      credentialId: parsed.credentialId,
      message: 'Biometric login enabled on this device.'
    });
  } catch (err) {
    console.error('finishBiometricRegistration error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Could not register biometric login.' });
  }
};

const beginBiometricLogin = async (req, res) => {
  try {
    const { credentialId } = req.body;
    if (!credentialId) {
      return res.status(400).json({ success: false, message: 'Registered biometric device not found. Login normally and register biometric again.' });
    }

    const user = await User.findOne({
      role: 'student',
      status: { $nin: ['pending', 'inactive'] },
      pendingDeletion: { $ne: true },
      'biometricCredential.credentialId': credentialId
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Biometric login is not registered for this device.' });
    }

    const challenge = randomChallenge();
    user.biometricChallenge = challenge;
    await user.save({ validateBeforeSave: false, strict: false });

    return res.json({
      success: true,
      options: {
        challenge,
        timeout: 60000,
        rpId: expectedRpId(),
        userVerification: 'required',
        allowCredentials: [{
          type: 'public-key',
          id: user.biometricCredential.credentialId,
          transports: user.biometricCredential.transports || ['internal']
        }]
      }
    });
  } catch (err) {
    console.error('beginBiometricLogin error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const finishBiometricLogin = async (req, res) => {
  try {
    const credential = req.body.credential;
    const credentialId = credential?.id || credential?.rawId;
    if (!credentialId || !credential?.response) {
      return res.status(400).json({ success: false, message: 'Biometric response is missing.' });
    }

    const user = await User.findOne({
      role: 'student',
      'biometricCredential.credentialId': credentialId
    }).select('+biometricChallenge');

    if (!user?.biometricChallenge) {
      return res.status(400).json({ success: false, message: 'Biometric login session expired. Try again.' });
    }
    if (user.pendingDeletion) {
      return res.status(403).json({ success: false, message: 'Your account is scheduled for deletion. Contact admin immediately if this is a mistake.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ success: false, message: 'Your account is pending admin approval.' });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact admin.' });
    }

    const assertion = verifyAssertion({
      credential,
      storedCredential: user.biometricCredential,
      challenge: user.biometricChallenge
    });

    if (assertion.counter > 0 && assertion.counter <= (user.biometricCredential.counter || 0)) {
      return res.status(401).json({ success: false, message: 'Biometric credential could not be verified.' });
    }

    user.biometricCredential.counter = assertion.counter || user.biometricCredential.counter || 0;
    user.biometricChallenge = undefined;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false, strict: false });

    return res.json({
      success: true,
      token: generateToken(user._id),
      user: safeUserPayload(user),
      message: `Welcome back, ${user.name}!`
    });
  } catch (err) {
    console.error('finishBiometricLogin error:', err);
    return res.status(401).json({ success: false, message: err.message || 'Biometric login failed.' });
  }
};

// @desc    Get current user profile
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('enrolledSubjects', 'name code')
      .select('-password -faceEncoding -biometricChallenge');
    res.json({ success: true, user: safeUserPayload(user) });
  } catch (err) {
    console.error('getMe error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Update profile
const updateProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { name, phone, address } },
      { new: true, runValidators: true }
    ).select('-password -faceEncoding');
    res.json({ success: true, user });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const updateAdminScope = async (req, res) => {
  try {
    if (req.user.role !== 'admin' || req.user.department === SYSTEM_ADMIN_DEPARTMENT) {
      return res.status(403).json({ success: false, message: 'Department admin access required' });
    }

    const year = Number(req.body.year);
    const semester = Number(req.body.semester);
    const allowedSemesters = {
      1: [1, 2],
      2: [3, 4],
      3: [5, 6],
      4: [7, 8],
    };

    if (!allowedSemesters[year]?.includes(semester)) {
      return res.status(400).json({ success: false, message: 'Select a valid year and semester' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        adminAcademicYear: year,
        adminSemesterScope: semester,
        adminScopeSetAt: new Date()
      },
      { new: true, runValidators: true }
    ).select('-password -faceEncoding');

    res.json({ success: true, user: safeUserPayload(user) });
  } catch (err) {
    console.error('updateAdminScope error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = {
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
};
