const express = require('express');
const router  = express.Router();
const {
  getPendingStudents, getAllStudents, getStudentById,
  approveStudent, rejectStudent, activateStudent,
  deactivateStudent, restrictStudent, deleteStudent,
  enrollStudentSubjects, getAnalytics, getSuperOverview
} = require('../controllers/adminController');
const { getAuditLogs } = require('../controllers/auditController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect, adminOnly);

// ✅ FIX: Static paths before parameterised ones
router.get('/students/pending',      getPendingStudents);   // <-- before /students/:id
router.get('/students',              getAllStudents);
router.get('/analytics',             getAnalytics);
router.get('/super-overview',        getSuperOverview);
router.get('/audit-logs',            getAuditLogs);
router.get('/students/:id',          getStudentById);
router.put('/students/:id/approve',  approveStudent);
router.put('/students/:id/reject',   rejectStudent);        // ✅ changed DELETE → PUT (body safe)
router.put('/students/:id/activate', activateStudent);
router.put('/students/:id/deactivate', deactivateStudent);
router.put('/students/:id/restrict', restrictStudent);
router.put('/students/:id/enroll',   enrollStudentSubjects);
router.delete('/students/:id',       deleteStudent);

module.exports = router;
