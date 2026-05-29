const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const tempUploadDir = () => {
  const dir = path.join(os.tmpdir(), 'studysphere-uploads');
  ensureDir(dir);
  return dir;
};

const tempStorage = (prefix) => multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir());
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const profileStorage = tempStorage('profile');
const captureStorage = tempStorage('capture');
const timetableStorage = tempStorage('timetable');
const spreadsheetStorage = tempStorage('spreadsheet');
const lmsStorage = tempStorage('lms');
const chatStorage = tempStorage('chat');

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
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.xlsx', '.csv'];
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv'
  ];

  if (allowedExtensions.includes(ext) || allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only timetable images, .xlsx, or .csv files are allowed'));
  }
};

const uploadTimetable = multer({
  storage: timetableStorage,
  fileFilter: timetableFilter,
  limits: { fileSize: 12 * 1024 * 1024 }
});

const spreadsheetFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.xlsx', '.csv'];
  const allowedMimes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'application/octet-stream'
  ];

  if (allowedExtensions.includes(ext) || allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only .xlsx or .csv files are allowed'));
  }
};

const uploadSpreadsheet = multer({
  storage: spreadsheetStorage,
  fileFilter: spreadsheetFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
});

const lmsFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const blocked = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.dll'];
  if (blocked.includes(ext)) {
    cb(new Error('Executable files are not allowed'));
  } else {
    cb(null, true);
  }
};

const uploadLmsFile = multer({
  storage: lmsStorage,
  fileFilter: lmsFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const uploadChatFile = multer({
  storage: chatStorage,
  fileFilter: lmsFileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }
});

module.exports = { uploadProfile, uploadCapture, uploadTimetable, uploadSpreadsheet, uploadLmsFile, uploadChatFile };
