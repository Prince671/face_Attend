const express = require('express');
const router = express.Router();
const { getTimetables, getMyTimetable, upsertTimetable, generateLectures } = require('../controllers/timetableController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { uploadTimetable } = require('../middleware/uploadMiddleware');

router.use(protect);

router.get('/my', getMyTimetable);
router.get('/', adminOnly, getTimetables);
router.post('/', adminOnly, uploadTimetable.single('timetableFile'), upsertTimetable);
router.post('/:id/generate-lectures', adminOnly, generateLectures);

module.exports = router;
