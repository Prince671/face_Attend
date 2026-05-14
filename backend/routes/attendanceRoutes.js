const express = require('express');
const router  = express.Router();
const {
  detectGuideFace, markAttendance, getStudentSubjectAttendance,
  downloadAttendanceExcel, getAdminAttendanceByLecture,
  downloadLectureAttendanceExcel, downloadSessionAttendanceExcel,
  getSubjectAttendanceAnalytics
} = require('../controllers/attendanceController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { uploadCapture } = require('../middleware/uploadMiddleware');

router.use(protect);

// ✅ Static/prefixed routes before parameterised ones
router.post('/detect-guide-face', uploadCapture.single('guideFrame'), detectGuideFace);
router.post('/mark', uploadCapture.fields([
  { name: 'faceCapture', maxCount: 1 },
  { name: 'livenessFrames', maxCount: 6 }
]), markAttendance);
router.get('/student/subject/:subjectId',     getStudentSubjectAttendance);
router.get('/student/subject/:subjectId/download', downloadAttendanceExcel);
router.get('/session/download',               adminOnly, downloadSessionAttendanceExcel);
router.get('/lecture/:lectureId/download',    adminOnly, downloadLectureAttendanceExcel);
router.get('/lecture/:lectureId',             adminOnly, getAdminAttendanceByLecture);
router.get('/analytics/subject/:subjectId',   adminOnly, getSubjectAttendanceAnalytics);

module.exports = router;
