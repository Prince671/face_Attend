const express = require('express');
const router  = express.Router();
const {
  createLecture, getAllLectures, getLectureById,
  startAttendance, stopAttendance,
  copyLectureAttendance, getCopyAttendanceSources, getLectureAttendance, deleteLecture
} = require('../controllers/lectureController');
const { protect, adminOrTeacher } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect);

// Static routes before parameterised routes.
router.get('/', adminOrTeacher, cacheMiddleware('lectures', 45), getAllLectures);
router.post('/', adminOrTeacher, invalidateAfter(createLecture, ['lectures', 'timetable', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.get('/:id', adminOrTeacher, cacheMiddleware('lectures', 45), getLectureById);
router.get('/:id/attendance', adminOrTeacher, cacheMiddleware('attendance', 30), getLectureAttendance);
router.get('/:id/copy-sources', adminOrTeacher, cacheMiddleware('attendance', 30), getCopyAttendanceSources);
router.put('/:id/start-attendance', adminOrTeacher, invalidateAfter(startAttendance, ['lectures', 'attendance', 'dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));
router.put('/:id/stop-attendance', adminOrTeacher, invalidateAfter(stopAttendance, ['lectures', 'attendance', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.post('/:id/copy-attendance', adminOrTeacher, invalidateAfter(copyLectureAttendance, ['lectures', 'attendance', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics']));
router.delete('/:id', adminOrTeacher, invalidateAfter(deleteLecture, ['lectures', 'attendance', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics']));

module.exports = router;
