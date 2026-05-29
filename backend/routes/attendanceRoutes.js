const express = require('express');
const router  = express.Router();
const {
  detectGuideFace, markAttendance, getStudentSubjectAttendance,
  downloadAttendanceExcel, getAdminAttendanceByLecture,
  downloadLectureAttendanceExcel, downloadSessionAttendanceExcel,
  getSubjectAttendanceAnalytics, getSubjectAttendanceHistory,
  updateLectureAttendanceStatus, importSubjectAttendance, scheduleImportedAttendanceDeletion,
  createAttendanceDispute, getAttendanceDisputes, resolveAttendanceDispute,
  deleteAttendanceDispute, deleteAttendanceDisputes
} = require('../controllers/attendanceController');
const { protect, adminOrTeacher } = require('../middleware/authMiddleware');
const { uploadCapture, uploadSpreadsheet } = require('../middleware/uploadMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect);

// Static/prefixed routes before parameterised ones.
router.post('/detect-guide-face', uploadCapture.single('guideFrame'), detectGuideFace);
router.post('/mark', uploadCapture.fields([
  { name: 'faceCapture', maxCount: 1 },
  { name: 'livenessFrames', maxCount: 6 }
]), invalidateAfter(markAttendance, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'attendance', 'lectures']));
router.get('/student/subject/:subjectId', cacheMiddleware('attendance', 45), getStudentSubjectAttendance);
router.get('/student/subject/:subjectId/download', downloadAttendanceExcel);
router.post('/disputes', invalidateAfter(createAttendanceDispute, ['attendance', 'notifications', 'dashboard']));
router.get('/disputes', adminOrTeacher, cacheMiddleware('attendance', 30), getAttendanceDisputes);
router.put('/disputes/:id', adminOrTeacher, invalidateAfter(resolveAttendanceDispute, ['attendance', 'notifications', 'dashboard']));
router.delete('/disputes', adminOrTeacher, invalidateAfter(deleteAttendanceDisputes, ['attendance', 'notifications', 'dashboard']));
router.delete('/disputes/:id', adminOrTeacher, invalidateAfter(deleteAttendanceDispute, ['attendance', 'notifications', 'dashboard']));
router.get('/session/download',               adminOrTeacher, downloadSessionAttendanceExcel);
router.get('/lecture/:lectureId/download',    adminOrTeacher, downloadLectureAttendanceExcel);
router.put('/lecture/:lectureId/status', adminOrTeacher, invalidateAfter(updateLectureAttendanceStatus, ['attendance', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'lectures']));
router.get('/lecture/:lectureId', adminOrTeacher, cacheMiddleware('attendance', 30), getAdminAttendanceByLecture);
router.post('/subject/:subjectId/import', adminOrTeacher, uploadSpreadsheet.single('file'), invalidateAfter(importSubjectAttendance, ['attendance', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'lectures']));
router.post('/subject/:subjectId/imported-delete', adminOrTeacher, invalidateAfter(scheduleImportedAttendanceDeletion, ['attendance', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'lectures']));
router.get('/subject/:subjectId/history', adminOrTeacher, cacheMiddleware('attendance', 45), getSubjectAttendanceHistory);
router.get('/analytics/subject/:subjectId', adminOrTeacher, cacheMiddleware('analytics', 60), getSubjectAttendanceAnalytics);

module.exports = router;
