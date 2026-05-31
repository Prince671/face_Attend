require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const connectDB = require('./config/db');
const { connectRedis, closeRedis, getRedisStatus } = require('./config/redis');
const { closeExpiredAttendance } = require('./utils/attendanceAutoClose');
const { cleanupExpiredAttendanceCaptures } = require('./utils/attendanceCaptureCleanup');
const { sendUpcomingLectureReminders } = require('./utils/lectureReminderScheduler');
const { runLmsDeadlineChecks } = require('./utils/lmsDeadlineScheduler');
const { startMlKeepAlive } = require('./utils/mlKeepAlive');
const { processExpiredPendingDeletions } = require('./utils/pendingDeletion');
const { adminDepartmentRoom, SYSTEM_ADMIN_DEPARTMENT } = require('./utils/adminScope');
const User = require('./models/User');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const lectureRoutes = require('./routes/lectureRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const timetableRoutes = require('./routes/timetableRoutes');
const deletionRoutes = require('./routes/deletionRoutes');
const holidayRoutes = require('./routes/holidayRoutes');
const lmsRoutes = require('./routes/lmsRoutes');
const chatRoutes = require('./routes/chatRoutes');
const ChatGroup = require('./models/ChatGroup');
const ChatGroupMember = require('./models/ChatGroupMember');

const app = express();
const server = http.createServer(app);
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000);
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 300000);

const configuredFrontendOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  ...configuredFrontendOrigins,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
const isPrivateLanOrigin = (origin) => {
  try {
    const { protocol, hostname } = new URL(origin);
    if (!['http:', 'https:'].includes(protocol)) return false;
    return /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(hostname);
  } catch {
    return false;
  }
};
const corsOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.has(origin) || isPrivateLanOrigin(origin)) return callback(null, true);
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
};

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.set('io', io);
connectDB();
connectRedis().catch(() => {});

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});
app.use(cors({
  origin: corsOrigin,
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

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/lectures', lectureRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/timetables', timetableRoutes);
app.use('/api/deletions', deletionRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/lms', lmsRoutes);
app.use('/api/chat', chatRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date() });
});

app.get('/api/ready', (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  const redis = getRedisStatus();
  res.status(dbReady ? 200 : 503).json({
    success: dbReady,
    database: dbReady ? 'connected' : 'unavailable',
    cache: redis.connected ? 'connected' : (redis.enabled ? 'fallback' : 'disabled'),
    cacheRetryAfterMs: redis.retryAfterMs,
    timestamp: new Date()
  });
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return next(new Error('Socket authentication required'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('_id role department status isRestricted').lean();
    if (!user || ['inactive', 'pending'].includes(user.status)) {
      return next(new Error('Socket authentication failed'));
    }
    socket.user = user;
    return next();
  } catch (error) {
    return next(new Error('Socket authentication failed'));
  }
});

const chatPresence = new Map();
const chatLastSeen = new Map();

const chatPresencePayload = (groupId) => ({
  groupId,
  onlineUserIds: [...(chatPresence.get(String(groupId)) || new Map()).keys()],
  lastSeenByUserId: Object.fromEntries(chatLastSeen.get(String(groupId)) || new Map()),
});

const leavePresenceRoom = (socket, groupId) => {
  const key = String(groupId);
  const roomMap = chatPresence.get(key);
  if (!roomMap) return;
  const userId = String(socket.user?._id || '');
  const sockets = roomMap.get(userId);
  if (sockets) {
    sockets.delete(socket.id);
    if (!sockets.size) roomMap.delete(userId);
  }
  if (userId) {
    const lastSeenMap = chatLastSeen.get(key) || new Map();
    lastSeenMap.set(userId, new Date().toISOString());
    chatLastSeen.set(key, lastSeenMap);
  }
  if (!roomMap.size) chatPresence.delete(key);
  io.to(`chat_group_${key}`).emit('chat_presence_updated', chatPresencePayload(key));
};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_admin', (department) => {
    const user = socket.user;
    if (!user || !['admin', 'teacher'].includes(user.role)) return;
    if (user.role === 'teacher' && department && department !== user.department) return;
    if (user.role === 'admin' && user.department !== SYSTEM_ADMIN_DEPARTMENT && department !== user.department) return;
    if (!department || department === SYSTEM_ADMIN_DEPARTMENT) {
      if (user.department !== SYSTEM_ADMIN_DEPARTMENT) return;
      socket.join('admin_room');
    } else {
      socket.join(adminDepartmentRoom(department));
    }
    console.log('Admin joined scoped admin room');
  });

  socket.on('join_student', (studentId) => {
    if (!socket.user || socket.user.role !== 'student' || String(socket.user._id) !== String(studentId)) return;
    socket.join(`student_${studentId}`);
  });

  socket.on('join_user', (userId) => {
    if (!socket.user || String(socket.user._id) !== String(userId)) return;
    socket.join(`user_${userId}`);
    if (socket.user.role === 'student') socket.join(`chat_user_${userId}`);
  });

  socket.on('chat_join_room', async (groupId) => {
    try {
      if (!socket.user || socket.user.role !== 'student' || socket.user.isRestricted || socket.user.status === 'restricted') return;
      const [group, membership] = await Promise.all([
        ChatGroup.findOne({ _id: groupId, isDeleted: { $ne: true } }).select('_id').lean(),
        ChatGroupMember.findOne({ group: groupId, user: socket.user._id, isActive: true }).select('_id hidePresence').lean()
      ]);
      if (group && membership) {
        const key = String(groupId);
        socket.join(`chat_group_${key}`);
        socket.chatGroups = socket.chatGroups || new Set();
        socket.chatGroups.add(key);
        if (!membership.hidePresence) {
          const roomMap = chatPresence.get(key) || new Map();
          const userId = String(socket.user._id);
          const sockets = roomMap.get(userId) || new Set();
          sockets.add(socket.id);
          roomMap.set(userId, sockets);
          chatPresence.set(key, roomMap);
        }
        io.to(`chat_group_${key}`).emit('chat_presence_updated', chatPresencePayload(key));
      }
    } catch (error) {
      console.error('chat_join_room error:', error.message);
    }
  });

  socket.on('chat_leave_room', (groupId) => {
    if (!socket.user || socket.user.role !== 'student') return;
    const key = String(groupId);
    socket.leave(`chat_group_${key}`);
    socket.chatGroups?.delete(key);
    leavePresenceRoom(socket, key);
  });

  socket.on('chat_typing', async ({ groupId, typing, mode }) => {
    try {
      if (!socket.user || socket.user.role !== 'student') return;
      const membership = await ChatGroupMember.findOne({ group: groupId, user: socket.user._id, isActive: true }).select('_id').lean();
      if (!membership) return;
      socket.to(`chat_group_${groupId}`).emit('chat_typing', {
        groupId,
        userId: socket.user._id,
        typing: Boolean(typing),
        mode: mode === 'recording' ? 'recording' : 'typing'
      });
    } catch (error) {
      console.error('chat_typing error:', error.message);
    }
  });

  socket.on('chat_presence_set_hidden', async ({ groupId, hidden }) => {
    try {
      if (!socket.user || socket.user.role !== 'student') return;
      const membership = await ChatGroupMember.findOne({ group: groupId, user: socket.user._id, isActive: true }).select('_id').lean();
      if (!membership) return;
      const key = String(groupId);
      const userId = String(socket.user._id);
      if (hidden) {
        const roomMap = chatPresence.get(key);
        const sockets = roomMap?.get(userId);
        sockets?.delete(socket.id);
        if (roomMap && (!sockets || !sockets.size)) roomMap.delete(userId);
        if (roomMap && !roomMap.size) chatPresence.delete(key);
        const lastSeenMap = chatLastSeen.get(key) || new Map();
        lastSeenMap.set(userId, new Date().toISOString());
        chatLastSeen.set(key, lastSeenMap);
      } else {
        const roomMap = chatPresence.get(key) || new Map();
        const sockets = roomMap.get(userId) || new Set();
        sockets.add(socket.id);
        roomMap.set(userId, sockets);
        chatPresence.set(key, roomMap);
      }
      io.to(`chat_group_${key}`).emit('chat_presence_updated', chatPresencePayload(key));
    } catch (error) {
      console.error('chat_presence_set_hidden error:', error.message);
    }
  });

  socket.on('disconnect', () => {
    if (socket.chatGroups) {
      [...socket.chatGroups].forEach(groupId => leavePresenceRoom(socket, groupId));
    }
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

const runLectureReminderScheduler = () => {
  sendUpcomingLectureReminders(io).catch(err => {
    console.error('Lecture reminder scheduler error:', err.message);
  });
};

setTimeout(runLectureReminderScheduler, 20 * 1000);
const lectureReminderInterval = setInterval(runLectureReminderScheduler, 60 * 1000);

const runLmsDeadlineScheduler = () => {
  runLmsDeadlineChecks(io).catch(err => {
    console.error('LMS deadline scheduler error:', err.message);
  });
};

setTimeout(runLmsDeadlineScheduler, 25 * 1000);
const lmsDeadlineInterval = setInterval(runLmsDeadlineScheduler, 60 * 1000);

const stopMlKeepAlive = startMlKeepAlive();

let isShuttingDown = false;
const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Closing server gracefully...`);

  clearInterval(attendanceAutoCloseInterval);
  clearInterval(attendanceCaptureCleanupInterval);
  clearInterval(pendingDeletionCleanupInterval);
  clearInterval(lectureReminderInterval);
  clearInterval(lmsDeadlineInterval);
  if (typeof stopMlKeepAlive === 'function') stopMlKeepAlive();

  server.close(async () => {
    try {
      await mongoose.connection.close(false);
      await closeRedis();
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
