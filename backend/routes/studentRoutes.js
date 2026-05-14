const express = require('express');
const router = express.Router();
const { getDashboard, getSubjectLectures } = require('../controllers/studentController');
const { protect, studentOnly } = require('../middleware/authMiddleware');

router.use(protect, studentOnly);
router.get('/dashboard', getDashboard);
router.get('/lectures/subject/:subjectId', getSubjectLectures);

module.exports = router;
