const multer = require('multer');
const path = require('path');
const fs = require('fs');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// Profile image storage
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/profiles');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

// Attendance capture storage
const captureStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/captures');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `capture_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (jpg, jpeg, png, webp) are allowed'));
  }
};

const uploadProfile = multer({
  storage: profileStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const uploadCapture = multer({
  storage: captureStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const timetableFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.xlsx', '.xls', '.csv'];
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv'
  ];

  if (allowedExtensions.includes(ext) || allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only timetable images or Excel/CSV files are allowed'));
  }
};

const uploadTimetable = multer({
  storage: captureStorage,
  fileFilter: timetableFilter,
  limits: { fileSize: 12 * 1024 * 1024 }
});

module.exports = { uploadProfile, uploadCapture, uploadTimetable };
