const express = require('express');
const router = express.Router();
const { getHolidays, createHoliday, deleteHoliday } = require('../controllers/holidayController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect);
router.get('/', adminOnly, cacheMiddleware('timetable', 120), getHolidays);
router.post('/', adminOnly, invalidateAfter(createHoliday, ['timetable', 'lectures', 'dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));
router.delete('/:id', adminOnly, invalidateAfter(deleteHoliday, ['timetable', 'lectures', 'dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));

module.exports = router;
