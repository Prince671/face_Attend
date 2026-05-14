require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const connectDB = require('./config/db');
const { closeExpiredAttendance } = require('./utils/attendanceAutoClose');
const { cleanupExpiredAttendanceCaptures } = require('./utils/attendanceCaptureCleanup');
const { processExpiredPendingDeletions } = require('./utils/pendingDeletion');
const { adminDepartmentRoom, SYSTEM_ADMIN_DEPARTMENT } = require('./utils/adminScope');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const lectureRoutes = require('./routes/lectureRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const timetableRoutes = require('./routes/timetableRoutes');
const deletionRoutes = require('./routes/deletionRoutes');

const app = express();
const server = http.createServer(app);
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000);
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 120000);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.set('io', io);
connectDB();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

const isDevelopment = process.env.NODE_ENV !== 'production';

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isDevelopment ? 100 : 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed login attempts. Please wait a few minutes and try again.'
  }
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 2000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/auth/login' || req.path === '/auth/register',
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/', limiter);

const bodyLimit = process.env.JSON_BODY_LIMIT || '2mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
app.use(morgan(isDevelopment ? 'dev' : 'combined'));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/lectures', lectureRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/timetables', timetableRoutes);
app.use('/api/deletions', deletionRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date() });
});

app.get('/api/ready', (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    success: dbReady,
    database: dbReady ? 'connected' : 'unavailable',
    timestamp: new Date()
  });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_admin', (department) => {
    if (!department || department === SYSTEM_ADMIN_DEPARTMENT) {
      socket.join('admin_room');
    } else {
      socket.join(adminDepartmentRoom(department));
    }
    console.log('Admin joined scoped admin room');
  });

  socket.on('join_student', (studentId) => {
    socket.join(`student_${studentId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.type === 'entity.too.large' ? 413 : (err.statusCode || 500);
  res.status(statusCode).json({
    success: false,
    message: statusCode === 413 ? 'Request payload is too large.' : (err.message || 'Internal Server Error'),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Socket.IO ready');
  console.log(`ML Service: ${process.env.ML_SERVICE_URL || 'not configured'}`);
});

const attendanceAutoCloseInterval = setInterval(() => {
  closeExpiredAttendance(io).catch(err => {
    console.error('Auto close attendance error:', err.message);
  });
}, 60 * 1000);

const runAttendanceCaptureCleanup = () => {
  cleanupExpiredAttendanceCaptures().catch(err => {
    console.error('Attendance capture cleanup error:', err.message);
  });
};

setTimeout(runAttendanceCaptureCleanup, 30 * 1000);
const attendanceCaptureCleanupInterval = setInterval(runAttendanceCaptureCleanup, 60 * 60 * 1000);

const runPendingDeletionCleanup = () => {
  processExpiredPendingDeletions().catch(err => {
    console.error('Pending deletion cleanup error:', err.message);
  });
};

setTimeout(runPendingDeletionCleanup, 45 * 1000);
const pendingDeletionCleanupInterval = setInterval(runPendingDeletionCleanup, 60 * 1000);

let isShuttingDown = false;
const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Closing server gracefully...`);

  clearInterval(attendanceAutoCloseInterval);
  clearInterval(attendanceCaptureCleanupInterval);
  clearInterval(pendingDeletionCleanupInterval);

  server.close(async () => {
    try {
      await mongoose.connection.close(false);
      console.log('Server and MongoDB connections closed.');
      process.exit(0);
    } catch (error) {
      console.error('Shutdown error:', error.message);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000)).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

module.exports = { app, io };
