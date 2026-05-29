const User = require('../models/User');
const Notification = require('../models/Notification');
const OtpVerification = require('../models/OtpVerification');
const AuditLog = require('../models/AuditLog');
const { generateToken } = require('../middleware/authMiddleware');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const { uploadImage, downloadImage, isRemoteImage, deleteImage } = require('../utils/cloudinary');
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
const { validateStrongPassword } = require('../utils/passwordPolicy');
const {
  compareValue,
  generateOtp,
  generateSecureToken,
  hashValue,
  normalizeEmail,
  otpTtlMinutes,
  sendEmailOtp
} = require('../utils/otpService');
const { enrollStudentInMatchingSubjects } = require('../utils/subjectEnrollment');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const safeUserPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  studentId: user.studentId,
  course: user.course,
  department: user.department,
  departments: user.departments,
  branch: user.branch,
  semester: user.semester,
  adminAcademicYear: user.adminAcademicYear,
  adminSemesterScope: user.adminSemesterScope,
  adminScopeSetAt: user.adminScopeSetAt,
  fatherName: user.fatherName,
  dateOfBirth: user.dateOfBirth,
  phone: user.phone,
  address: user.address,
  profileImage: user.profileImage,
  semesterUpdatedAt: user.semesterUpdatedAt,
  pendingProfileUpdate: user.pendingProfileUpdate,
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

const parseDateOnlyAsLocalDay = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(raw);
};

const toLocalDateValue = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const COURSE_BRANCH_DEPARTMENT = {
  'Computer Science': 'Computer Science',
  'Mechanical Engineering': 'Mechanical',
  'Electrical Engineering': 'Electrical',
  'AI/ML Engineering': 'Computer Science',
  BBA: 'BBA',
  MBA: 'MBA'
};

const normalizeCourse = (value) => {
  const course = String(value || '').trim();
  if (/^b\.?\s*tech$/i.test(course)) return 'B. Tech';
  if (/^diploma$/i.test(course)) return 'Diploma';
  if (/^bba$/i.test(course)) return 'BBA';
  if (/^mba$/i.test(course)) return 'MBA';
  return course;
};

const academicDepartmentFor = (courseValue, branchValue, fallbackDepartment) => {
  const course = normalizeCourse(courseValue);
  const branch = String(branchValue || '').trim();
  if (course === 'BBA' || course === 'MBA') return course;
  return COURSE_BRANCH_DEPARTMENT[branch] || fallbackDepartment || branch;
};

const normalizeStudentBranch = (department, branch, courseValue) => {
  const course = normalizeCourse(courseValue);
  const value = String(branch || '').trim();
  if (course === 'Diploma' && /computer/i.test(value)) return 'Diploma CS';
  if (course === 'BBA' || course === 'MBA') return '';
  if (value) return value;
  return /computer|cse|cs/i.test(String(department || '')) ? 'Computer Science' : '';
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

const compareFaceEncodings = (known = [], next = []) => {
  if (!Array.isArray(known) || !Array.isArray(next) || !known.length || known.length !== next.length) {
    return { match: false, confidence: 0 };
  }
  let dot = 0;
  let knownNorm = 0;
  let nextNorm = 0;
  for (let index = 0; index < known.length; index += 1) {
    const a = Number(known[index]);
    const b = Number(next[index]);
    dot += a * b;
    knownNorm += a * a;
    nextNorm += b * b;
  }
  const similarity = dot / ((Math.sqrt(knownNorm) * Math.sqrt(nextNorm)) || 1);
  const confidence = Math.max(0, Math.min(100, Math.round(((similarity + 1) / 2) * 1000) / 10));
  return { match: similarity >= 0.42, confidence, similarity };
};

const ensureFaceLoginEncoding = async (student) => {
  if (Array.isArray(student.faceEncoding) && student.faceEncoding.length > 0) {
    return true;
  }

  const source = student.faceImagePath || student.profileImage;
  if (!source || !isRemoteImage(source)) return false;

  let tempFile = null;
  try {
    const imagePath = await downloadImage(source, `face_login_profile_${student._id}`);
    tempFile = imagePath;
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

const latestActiveOtp = (query) => OtpVerification.findOne({
  ...query,
  consumedAt: { $exists: false },
  expiresAt: { $gt: new Date() }
}).sort({ createdAt: -1 });

const sendRegistrationOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const existingUser = await User.findOne({ email }).select('_id');
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already registered.' });
    }

    const emailOtp = generateOtp();
    const expiresAt = new Date(Date.now() + otpTtlMinutes() * 60 * 1000);

    await OtpVerification.updateMany(
      { purpose: 'student_registration', email, consumedAt: { $exists: false } },
      { consumedAt: new Date() }
    );

    const emailOtpHash = await hashValue(emailOtp);
    await OtpVerification.create({
      purpose: 'student_registration',
      email,
      emailOtpHash,
      expiresAt
    });

    await sendEmailOtp({ to: email, otp: emailOtp, purpose: 'student_registration' });

    return res.json({
      success: true,
      message: `Email OTP sent to ${email}.`,
      expiresAt
    });
  } catch (err) {
    console.error('sendRegistrationOtp error:', err);
    return res.status(503).json({ success: false, message: err.message || 'Could not send OTP.' });
  }
};

const verifyRegistrationOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const emailOtp = String(req.body.emailOtp || '').trim();

    if (!email || !emailOtp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const record = await latestActiveOtp({ purpose: 'student_registration', email });
    if (!record) {
      return res.status(400).json({ success: false, message: 'OTP session expired. Send OTP again.' });
    }
    if (record.attempts >= 5) {
      record.consumedAt = new Date();
      await record.save();
      return res.status(429).json({ success: false, message: 'Too many invalid OTP attempts. Send a new OTP.' });
    }

    const emailOk = await compareValue(emailOtp, record.emailOtpHash);

    if (!emailOk) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: 'Invalid email OTP.' });
    }

    record.emailVerified = true;
    record.verifiedAt = new Date();
    await record.save();

    return res.json({ success: true, message: 'Email verified. Continue registration.' });
  } catch (err) {
    console.error('verifyRegistrationOtp error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not verify OTP.' });
  }
};

const sendProfileEmailOtp = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Student access required.' });
    }
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ success: false, message: 'New email is required.' });
    if (email === req.user.email) return res.status(400).json({ success: false, message: 'Enter a different email address.' });

    const existing = await User.findOne({ email, _id: { $ne: req.user._id }, pendingDeletion: { $ne: true } }).select('_id');
    if (existing) return res.status(409).json({ success: false, message: 'Email is already in use.' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + otpTtlMinutes() * 60 * 1000);
    await OtpVerification.updateMany(
      { purpose: 'student_email_update', email, consumedAt: { $exists: false } },
      { consumedAt: new Date() }
    );
    await OtpVerification.create({
      purpose: 'student_email_update',
      email,
      emailOtpHash: await hashValue(otp),
      expiresAt
    });

    await sendEmailOtp({ to: email, otp, purpose: 'student_email_update' });
    return res.json({ success: true, message: `OTP sent to ${email}.`, expiresAt });
  } catch (err) {
    console.error('sendProfileEmailOtp error:', err);
    return res.status(503).json({ success: false, message: err.message || 'Could not send OTP.' });
  }
};

const verifyProfileEmailOtp = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Student access required.' });
    }
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required.' });

    const record = await latestActiveOtp({ purpose: 'student_email_update', email });
    if (!record) return res.status(400).json({ success: false, message: 'OTP session expired. Send OTP again.' });
    if (record.attempts >= 5) {
      record.consumedAt = new Date();
      await record.save();
      return res.status(429).json({ success: false, message: 'Too many invalid OTP attempts. Send a new OTP.' });
    }

    const ok = await compareValue(otp, record.emailOtpHash);
    if (!ok) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    record.emailVerified = true;
    record.verifiedAt = new Date();
    await record.save();
    return res.json({ success: true, message: 'Email verified. Submit your profile request.' });
  } catch (err) {
    console.error('verifyProfileEmailOtp error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not verify OTP.' });
  }
};

const sendForgotPasswordOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ success: false, message: 'Registered email is required.' });

    const user = await User.findOne({ email, pendingDeletion: { $ne: true } }).select('_id email status');
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email.' });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + otpTtlMinutes() * 60 * 1000);
    await OtpVerification.updateMany(
      { purpose: 'forgot_password', email, consumedAt: { $exists: false } },
      { consumedAt: new Date() }
    );
    await OtpVerification.create({
      purpose: 'forgot_password',
      email,
      emailOtpHash: await hashValue(otp),
      expiresAt
    });

    await sendEmailOtp({ to: email, otp, purpose: 'forgot_password' });
    return res.json({ success: true, message: `Password reset OTP sent to ${email}.`, expiresAt });
  } catch (err) {
    console.error('sendForgotPasswordOtp error:', err);
    return res.status(503).json({ success: false, message: err.message || 'Could not send reset OTP.' });
  }
};

const verifyForgotPasswordOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required.' });

    const record = await latestActiveOtp({ purpose: 'forgot_password', email });
    if (!record) return res.status(400).json({ success: false, message: 'OTP session expired. Send OTP again.' });
    if (record.attempts >= 5) {
      record.consumedAt = new Date();
      await record.save();
      return res.status(429).json({ success: false, message: 'Too many invalid OTP attempts. Send a new OTP.' });
    }

    const ok = await compareValue(otp, record.emailOtpHash);
    if (!ok) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    const resetToken = generateSecureToken();
    record.emailVerified = true;
    record.verifiedAt = new Date();
    record.resetTokenHash = await hashValue(resetToken);
    await record.save();

    return res.json({ success: true, resetToken, message: 'OTP verified. Set your new password.' });
  } catch (err) {
    console.error('verifyForgotPasswordOtp error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not verify reset OTP.' });
  }
};

const resetForgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const resetToken = String(req.body.resetToken || '').trim();
    const password = String(req.body.password || '');
    const policy = validateStrongPassword(password);
    if (!policy.valid) return res.status(400).json({ success: false, message: policy.message });
    if (!email || !resetToken) return res.status(400).json({ success: false, message: 'Reset session is missing.' });

    const record = await latestActiveOtp({ purpose: 'forgot_password', email, emailVerified: true });
    if (!record || !(await compareValue(resetToken, record.resetTokenHash))) {
      return res.status(400).json({ success: false, message: 'Reset session expired. Verify OTP again.' });
    }

    const user = await User.findOne({ email, pendingDeletion: { $ne: true } }).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });

    user.password = password;
    await user.save();
    record.consumedAt = new Date();
    await record.save();

    return res.json({ success: true, message: 'Password reset successfully. Please sign in.' });
  } catch (err) {
    console.error('resetForgotPassword error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not reset password.' });
  }
};

// @desc    Register new student
const register = async (req, res) => {
  let cloudinaryUpload = null;
  try {
    const { name, email, password, studentId, course: rawCourse, department: rawDepartment, branch, semester, phone, address, fatherName, dateOfBirth } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = String(phone || '').replace(/\s+/g, '').trim();
    const course = normalizeCourse(rawCourse);
    const department = academicDepartmentFor(course, branch, rawDepartment);
    const policy = validateStrongPassword(password);

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Profile image (passport photo) is required' });
    }

    if (!policy.valid) {
      cleanupFiles([req.file?.path]);
      return res.status(400).json({ success: false, message: policy.message });
    }

    if (!course || !department || !semester) {
      cleanupFiles([req.file?.path]);
      return res.status(400).json({ success: false, message: 'Course, branch/department, and semester are required' });
    }

    const otpRecord = await latestActiveOtp({
      purpose: 'student_registration',
      email: normalizedEmail,
      emailVerified: true
    });
    if (!otpRecord) {
      cleanupFiles([req.file?.path]);
      return res.status(400).json({ success: false, message: 'Verify your email OTP before submitting registration.' });
    }

    const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { studentId }] });
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
        folder: `${process.env.CLOUDINARY_FOLDER || 'studysphere'}/profiles`,
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
      email: normalizedEmail,
      password,
      studentId,
      course,
      department,
      branch: normalizeStudentBranch(department, branch, course),
      semester: parseInt(semester),
      fatherName,
      dateOfBirth: dateOfBirth || undefined,
      phone: normalizedPhone,
      address,
      profileImage: cloudinaryUpload.url,
      profileImagePublicId: cloudinaryUpload.publicId,
      faceEncoding: faceValidation.encoding || [],
      faceImagePath: cloudinaryUpload.url,
      status: 'pending',
      role: 'student'
    });

    try {
      await AuditLog.create({
        actor: user._id,
        actorName: user.name,
        actorEmail: user.email,
        actorDepartment: user.department,
        action: 'student.registration_requested',
        entityType: 'student',
        entityId: user._id,
        entityName: `${user.name} (${user.studentId})`,
        targetDepartment: user.department,
        details: {
          course: user.course,
          branch: user.branch,
          semester: user.semester,
          requestedAt: user.createdAt
        },
        ipAddress: req.ip,
        userAgent: req.get?.('user-agent')
      });
    } catch (auditErr) {
      console.error('registration audit log error:', auditErr.message);
    }

    otpRecord.consumedAt = new Date();
    await otpRecord.save();

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
    const identifier = String(email || '').trim();
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email/Student ID and password are required' });
    }

    const normalizedEmail = identifier.toLowerCase();
    const loginQuery = identifier.includes('@')
      ? { email: normalizedEmail, pendingDeletion: { $ne: true } }
      : {
        pendingDeletion: { $ne: true },
        $or: [
          { email: normalizedEmail },
          { role: 'student', studentId: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } }
        ]
      };

    const user = await User.findOne(loginQuery).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email/student ID or password' });
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
      requiresAdminScope: user.role === 'teacher'
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
      pendingDeletion: { $ne: true },
      faceEncoding: { $exists: true, $ne: [] }
    }).select('_id faceEncoding').lean();

    const candidates = students
      .filter(student => Array.isArray(student.faceEncoding) && student.faceEncoding.length > 0)
      .map(student => ({
        id: student._id.toString(),
        encoding: student.faceEncoding
      }));

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
        rp: { name: 'StudySphere', id: expectedRpId() },
        user: {
          id: base64url(user._id.toString()),
          name: user.email,
          displayName: user.name
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
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
      .populate('enrolledSubjects', 'name code branch semester')
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
    const { name, email, phone, address, currentPassword, newPassword, fatherName, semester, dateOfBirth } = req.body;
    const user = await User.findById(req.user._id).select('+password +faceEncoding');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    let requiresApproval = false;
    let semesterChangedDirectly = false;

    if (newPassword) {
      const policy = validateStrongPassword(newPassword);
      if (!policy.valid) {
        cleanupFiles([req.file?.path]);
        return res.status(400).json({ success: false, message: policy.message });
      }
      if (!currentPassword) {
        cleanupFiles([req.file?.path]);
        return res.status(400).json({ success: false, message: 'Current password is required to set a new password.' });
      }
      if (!(await user.matchPassword(currentPassword))) {
        cleanupFiles([req.file?.path]);
        return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
      }
      user.password = newPassword;
    }

    if (user.role === 'student') {
      const requestedFields = {};
      if (name !== undefined && String(name || '').trim() && String(name || '').trim() !== user.name) {
        requestedFields.name = String(name || '').trim();
      }
      if (fatherName !== undefined && String(fatherName || '').trim() !== String(user.fatherName || '')) {
        requestedFields.fatherName = String(fatherName || '').trim();
      }
      if (phone !== undefined && String(phone || '').trim() !== String(user.phone || '')) {
        requestedFields.phone = String(phone || '').trim();
      }
      if (address !== undefined && String(address || '').trim() !== String(user.address || '').trim()) {
        requestedFields.address = String(address || '').trim();
      }
      if (dateOfBirth !== undefined) {
        if (!dateOfBirth) {
          if (user.dateOfBirth) requestedFields.dateOfBirth = '';
        } else {
          const parsedDob = parseDateOnlyAsLocalDay(dateOfBirth);
          if (Number.isNaN(parsedDob.getTime())) {
            cleanupFiles([req.file?.path]);
            return res.status(400).json({ success: false, message: 'Select a valid date of birth.' });
          }
          const currentDob = user.dateOfBirth && !Number.isNaN(new Date(user.dateOfBirth).getTime())
            ? toLocalDateValue(new Date(user.dateOfBirth))
            : '';
          const nextDob = toLocalDateValue(parsedDob);
          if (nextDob !== currentDob) requestedFields.dateOfBirth = nextDob;
        }
      }
      if (email !== undefined) {
        const nextEmail = String(email || '').trim().toLowerCase();
        if (!nextEmail) {
          cleanupFiles([req.file?.path]);
          return res.status(400).json({ success: false, message: 'Email is required.' });
        }
        if (nextEmail !== user.email) {
          const existing = await User.findOne({ email: nextEmail, _id: { $ne: user._id } }).select('_id');
          if (existing) {
            cleanupFiles([req.file?.path]);
            return res.status(409).json({ success: false, message: 'Email is already in use.' });
          }
          const verifiedEmailUpdate = await latestActiveOtp({
            purpose: 'student_email_update',
            email: nextEmail,
            emailVerified: true
          });
          if (!verifiedEmailUpdate) {
            cleanupFiles([req.file?.path]);
            return res.status(400).json({ success: false, message: 'Verify OTP on the new email before requesting email change.' });
          }
          requestedFields.email = nextEmail;
          verifiedEmailUpdate.consumedAt = new Date();
          await verifiedEmailUpdate.save();
        }
      }

      if (Object.keys(requestedFields).length) {
        user.pendingProfileUpdate = {
          status: 'pending',
          requestedAt: new Date(),
          requestedFields
        };
        requiresApproval = true;

        const notification = await Notification.create({
          recipientRole: 'admin',
          type: 'student_profile_update_request',
          title: 'Student Profile Update Request',
          message: `${user.name} requested changes to ${Object.keys(requestedFields).join(', ')}.`,
          data: {
            studentId: user._id,
            studentName: user.name,
            department: user.department,
            semester: user.semester,
            requestedFields
          },
          priority: 'medium'
        });
        const io = req.app.get('io');
        if (io) {
          io.to('admin_room').emit('notification_created', notification);
          io.to(adminDepartmentRoom(user.department)).emit('notification_created', notification);
          io.to('admin_room').emit('student_profile_update_requested', { studentId: user._id });
          io.to(adminDepartmentRoom(user.department)).emit('student_profile_update_requested', { studentId: user._id });
        }
      }

      if (semester !== undefined && Number(semester) !== Number(user.semester)) {
        const nextSemester = Number(semester);
        if (!Number.isInteger(nextSemester) || nextSemester < 1 || nextSemester > 8) {
          cleanupFiles([req.file?.path]);
          return res.status(400).json({ success: false, message: 'Select a valid semester.' });
        }
        const lastChange = user.semesterUpdatedAt ? new Date(user.semesterUpdatedAt).getTime() : 0;
        const waitMs = 24 * 60 * 60 * 1000 - (Date.now() - lastChange);
        if (lastChange && waitMs > 0) {
          cleanupFiles([req.file?.path]);
          return res.status(429).json({
            success: false,
            message: `Semester can be changed only once every 24 hours. Try again in ${Math.ceil(waitMs / (60 * 60 * 1000))} hour(s).`
          });
        }
        user.semester = nextSemester;
        user.semesterUpdatedAt = new Date();
        user.enrolledSubjects = [];
        semesterChangedDirectly = true;
      }

      if (address !== undefined && requestedFields.address === undefined) user.address = String(address || '').trim();
    } else {
      if (name !== undefined) user.name = String(name || '').trim() || user.name;
      if (email !== undefined) {
      const nextEmail = String(email || '').trim().toLowerCase();
      if (!nextEmail) {
        cleanupFiles([req.file?.path]);
        return res.status(400).json({ success: false, message: 'Email is required.' });
      }
      if (nextEmail !== user.email) {
        const existing = await User.findOne({ email: nextEmail, _id: { $ne: user._id } }).select('_id');
        if (existing) {
          cleanupFiles([req.file?.path]);
          return res.status(409).json({ success: false, message: 'Email is already in use.' });
        }
        user.email = nextEmail;
      }
    }
      if (phone !== undefined) user.phone = String(phone || '').trim();
      if (address !== undefined) user.address = String(address || '').trim();
      if (dateOfBirth !== undefined) {
        if (!dateOfBirth) user.dateOfBirth = undefined;
        else {
          const parsedDob = parseDateOnlyAsLocalDay(dateOfBirth);
          if (Number.isNaN(parsedDob.getTime())) {
            cleanupFiles([req.file?.path]);
            return res.status(400).json({ success: false, message: 'Select a valid date of birth.' });
          }
          user.dateOfBirth = parsedDob;
        }
      }
    }

    if (req.file?.path) {
      let nextEncoding = null;
      if (user.role === 'student') {
        const validation = await validateImageForEncoding(req.file.path, req.file.originalname || 'profile_update.jpg', 60000);
        if (!validation.valid || !Array.isArray(validation.encoding) || validation.encoding.length === 0) {
          cleanupFiles([req.file.path]);
          return res.status(400).json({
            success: false,
            message: validation.message || 'Upload a clear, front-facing photo.'
          });
        }
        if (Array.isArray(user.faceEncoding) && user.faceEncoding.length) {
          const comparison = compareFaceEncodings(user.faceEncoding, validation.encoding);
          if (!comparison.match) {
            cleanupFiles([req.file.path]);
            return res.status(400).json({
              success: false,
              message: 'New profile image does not match your registered face. Use your own clear front-facing photo.',
              confidence: comparison.confidence
            });
          }
        }
        nextEncoding = validation.encoding;
      }
      const oldPublicId = user.profileImagePublicId;
      const uploaded = await uploadImage(req.file.path, {
        folder: `${process.env.CLOUDINARY_FOLDER || 'studysphere'}/profiles`,
        publicId: `profile_${user._id}_${Date.now()}`,
        timeout: 60000
      });
      user.profileImage = uploaded.url;
      user.profileImagePublicId = uploaded.publicId;
      if (user.role === 'student') {
        user.faceImagePath = uploaded.url;
        if (nextEncoding) user.faceEncoding = nextEncoding;
      }
      cleanupFiles([req.file.path]);
      if (oldPublicId) {
        try { await deleteImage(oldPublicId); } catch (err) { console.error('Old profile image cleanup error:', err.message); }
      }
    }

    await user.save();
    if (semesterChangedDirectly) {
      await enrollStudentInMatchingSubjects(user);
    }
    res.json({
      success: true,
      requiresApproval,
      message: requiresApproval ? 'Profile change request sent to department admin for approval.' : 'Profile updated successfully.',
      user: safeUserPayload(user)
    });
  } catch (err) {
    cleanupFiles([req.file?.path]);
    console.error('updateProfile error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const updateAdminScope = async (req, res) => {
  try {
    const isDepartmentAdmin = req.user.role === 'admin' && req.user.department !== SYSTEM_ADMIN_DEPARTMENT;
    const isTeacher = req.user.role === 'teacher';
    if (!isDepartmentAdmin && !isTeacher) {
      return res.status(403).json({ success: false, message: 'Department admin or teacher access required' });
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
};
