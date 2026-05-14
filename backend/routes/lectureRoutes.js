const express = require('express');
const router  = express.Router();
const {
  createLecture, getAllLectures, getLectureById,
  startAttendance, stopAttendance,
  copyLectureAttendance, getLectureAttendance, deleteLecture
} = require('../controllers/lectureController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect);

// ✅ Static routes before parameterised
router.get('/',                           getAllLectures);
router.post('/',           adminOnly,     createLecture);
router.get('/:id',                        getLectureById);
router.get('/:id/attendance',             getLectureAttendance);
router.put('/:id/start-attendance', adminOnly, startAttendance);
router.put('/:id/stop-attendance',  adminOnly, stopAttendance);
router.post('/:id/copy-attendance', adminOnly, copyLectureAttendance);
router.delete('/:id',              adminOnly, deleteLecture);

module.exports = router;
