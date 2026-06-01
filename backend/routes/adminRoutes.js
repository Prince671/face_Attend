const express = require('express');
const router = express.Router();
const {
  getPendingStudents, getAllStudents, getStudentById,
  approveStudent, rejectStudent, activateStudent,
  deactivateStudent, restrictStudent, unrestrictStudent, deleteStudent,
  enrollStudentSubjects, getAnalytics, getSuperOverview,
  getAcademicStructure, getAttendanceCriteriaSettings, updateAttendanceCriteriaSettings, addAcademicCourse, addAcademicBranch, deleteAcademicCourse, deleteAcademicBranch,
  getTeachers, createTeacher, importTeachers, importStudents, bulkDeleteStudents, deleteTeacher, getTeacherDashboard, getTeacherStudents,
  restrictStudentForSubject, unrestrictStudentForSubject, notifyLowAttendanceStudents,
  getTeacherPeers, getTeacherPeerProfile, getTeacherAllocation, saveTeacherAllocation,
  approveStudentProfileUpdate, rejectStudentProfileUpdate
} = require('../controllers/adminController');
const { getAuditLogs } = require('../controllers/auditController');
const { protect, adminOnly, adminOrTeacher } = require('../middleware/authMiddleware');
const { uploadTimetable, uploadSpreadsheet } = require('../middleware/uploadMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect);

router.get('/analytics', adminOrTeacher, cacheMiddleware('analytics', 45), getAnalytics);
router.get('/teacher-dashboard', adminOrTeacher, cacheMiddleware('admin-dashboard', 45), getTeacherDashboard);
router.get('/teacher-students', adminOrTeacher, getTeacherStudents);
router.post('/teacher-dashboard/low-attendance/notify', adminOrTeacher, invalidateAfter(notifyLowAttendanceStudents, ['notifications']));
router.put('/teacher-students/:id/restrict-subject', adminOrTeacher, invalidateAfter(restrictStudentForSubject, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects']));
router.put('/teacher-students/:id/unrestrict-subject', adminOrTeacher, invalidateAfter(unrestrictStudentForSubject, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects']));
router.get('/teacher-peers', adminOrTeacher, getTeacherPeers);
router.get('/teacher-peers/:id', adminOrTeacher, getTeacherPeerProfile);

router.get('/students/pending', adminOnly, cacheMiddleware('admin-dashboard', 30), getPendingStudents);
router.get('/students', adminOnly, getAllStudents);
router.post('/students/import', adminOnly, uploadSpreadsheet.single('file'), invalidateAfter(importStudents, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects']));
router.post('/students/bulk-delete', adminOnly, invalidateAfter(bulkDeleteStudents, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects', 'chat-groups']));
router.get('/super-overview', adminOnly, cacheMiddleware('admin-dashboard', 60), getSuperOverview);
router.get('/academic-structure', adminOnly, cacheMiddleware('subjects', 180), getAcademicStructure);
router.get('/attendance-criteria', adminOnly, cacheMiddleware('subjects', 60), getAttendanceCriteriaSettings);
router.put('/attendance-criteria', adminOnly, invalidateAfter(updateAttendanceCriteriaSettings, ['subjects', 'dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'attendance', 'notifications']));
router.post('/academic-structure/courses', adminOnly, invalidateAfter(addAcademicCourse, ['subjects', 'dashboard', 'admin-dashboard']));
router.post('/academic-structure/branches', adminOnly, invalidateAfter(addAcademicBranch, ['subjects', 'dashboard', 'admin-dashboard']));
router.delete('/academic-structure/courses/:course', adminOnly, invalidateAfter(deleteAcademicCourse, ['subjects', 'dashboard', 'admin-dashboard']));
router.delete('/academic-structure/branches/:course/:branch', adminOnly, invalidateAfter(deleteAcademicBranch, ['subjects', 'dashboard', 'admin-dashboard']));
router.get('/audit-logs', adminOnly, getAuditLogs);

router.get('/teachers', adminOnly, getTeachers);
router.post('/teachers', adminOnly, invalidateAfter(createTeacher, ['subjects', 'dashboard', 'admin-dashboard']));
router.post('/teachers/import', adminOnly, uploadTimetable.single('file'), invalidateAfter(importTeachers, ['subjects', 'dashboard', 'admin-dashboard']));
router.delete('/teachers/:id', adminOnly, invalidateAfter(deleteTeacher, ['subjects', 'dashboard', 'admin-dashboard']));
router.get('/teachers/allocation', adminOnly, getTeacherAllocation);
router.put('/teachers/allocation', adminOnly, invalidateAfter(saveTeacherAllocation, ['subjects', 'dashboard', 'admin-dashboard', 'classroom', 'lms']));

router.get('/students/:id', adminOnly, getStudentById);
router.put('/students/:id/approve', adminOnly, invalidateAfter(approveStudent, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects', 'notifications']));
router.put('/students/:id/reject', adminOnly, invalidateAfter(rejectStudent, ['dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));
router.put('/students/:id/activate', adminOnly, invalidateAfter(activateStudent, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects']));
router.put('/students/:id/deactivate', adminOnly, invalidateAfter(deactivateStudent, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects']));
router.put('/students/:id/restrict', adminOnly, invalidateAfter(restrictStudent, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects']));
router.put('/students/:id/unrestrict', adminOnly, invalidateAfter(unrestrictStudent, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects']));
router.put('/students/:id/enroll', adminOnly, invalidateAfter(enrollStudentSubjects, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects', 'classroom']));
router.put('/students/:id/profile-update/approve', adminOnly, invalidateAfter(approveStudentProfileUpdate, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects', 'profile']));
router.put('/students/:id/profile-update/reject', adminOnly, invalidateAfter(rejectStudentProfileUpdate, ['dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));
router.delete('/students/:id', adminOnly, invalidateAfter(deleteStudent, ['dashboard', 'student-dashboard', 'admin-dashboard', 'analytics', 'subjects', 'chat-groups']));

module.exports = router;
