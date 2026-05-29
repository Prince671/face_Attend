const express = require('express');
const router = express.Router();
const { getDashboard, getSubjectLectures } = require('../controllers/studentController');
const { protect, studentOnly } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');

router.use(protect, studentOnly);
router.get('/dashboard', cacheMiddleware('student-dashboard', 45), getDashboard);
router.get('/lectures/subject/:subjectId', cacheMiddleware('lectures', 60), getSubjectLectures);

module.exports = router;
