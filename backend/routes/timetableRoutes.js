const express = require('express');
const router = express.Router();
const { getTimetables, getMyTimetable, upsertTimetable, generateLectures } = require('../controllers/timetableController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { uploadTimetable } = require('../middleware/uploadMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect);

router.get('/my', cacheMiddleware('timetable', 120), getMyTimetable);
router.get('/', adminOnly, cacheMiddleware('timetable', 120), getTimetables);
router.post('/', adminOnly, uploadTimetable.single('timetableFile'), invalidateAfter(upsertTimetable, ['timetable', 'lectures', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.post('/:id/generate-lectures', adminOnly, invalidateAfter(generateLectures, ['timetable', 'lectures', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics']));

module.exports = router;
