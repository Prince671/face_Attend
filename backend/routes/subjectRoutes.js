const express = require('express');
const router  = express.Router();
const {
  createSubject, getAllSubjects, getSubjectById,
  updateSubject, deleteSubject, getStudentSubjects
} = require('../controllers/subjectController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect);

// Static routes must come before /:id.
// Without this, GET /subjects/my-subjects is matched as /:id = "my-subjects"
// and Mongoose throws a CastError trying to cast "my-subjects" to ObjectId.
router.get('/my-subjects', cacheMiddleware('subjects', 120), getStudentSubjects);   // <-- BEFORE /:id
router.get('/student', cacheMiddleware('subjects', 120), getStudentSubjects);
router.get('/', cacheMiddleware('subjects', 120), getAllSubjects);
router.get('/:id', cacheMiddleware('subjects', 120), getSubjectById);
router.post('/', adminOnly, invalidateAfter(createSubject, ['subjects', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics']));
router.put('/:id', adminOnly, invalidateAfter(updateSubject, ['subjects', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'lectures', 'classroom', 'lms']));
router.delete('/:id', adminOnly, invalidateAfter(deleteSubject, ['subjects', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'lectures', 'classroom', 'lms']));

module.exports = router;
