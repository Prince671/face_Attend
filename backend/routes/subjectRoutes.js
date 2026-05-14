const express = require('express');
const router  = express.Router();
const {
  createSubject, getAllSubjects, getSubjectById,
  updateSubject, deleteSubject, getStudentSubjects
} = require('../controllers/subjectController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect);

// ✅ FIX: Static routes MUST come before /:id
// Without this, GET /subjects/my-subjects is matched as /:id = "my-subjects"
// and Mongoose throws a CastError trying to cast "my-subjects" to ObjectId.
router.get('/my-subjects', getStudentSubjects);   // <-- BEFORE /:id
router.get('/',            getAllSubjects);
router.get('/:id',         getSubjectById);
router.post('/',           adminOnly, createSubject);
router.put('/:id',         adminOnly, updateSubject);
router.delete('/:id',      adminOnly, deleteSubject);

module.exports = router;
