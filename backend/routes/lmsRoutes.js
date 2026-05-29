const express = require('express');
const {
  getSubjectOverview,
  getSubjectCalendar,
  createMaterial,
  createMaterialFolder,
  updateMaterialFolder,
  deleteMaterialFolder,
  createAssignment,
  updateMaterial,
  updateAssignment,
  submitAssignment,
  gradeSubmission,
  returnSubmission,
  bulkReturnAssignment,
  markMaterialViewed,
  getSubmissionComments,
  addSubmissionComment,
  createQuiz,
  updateQuiz,
  importQuiz,
  attemptQuiz,
  releaseQuizResults,
  getAssignmentAnalytics,
  getQuizAnalytics,
  getMaterialAnalytics,
  createAnnouncement,
  deleteMaterial,
  deleteAssignment,
  deleteQuiz,
  publishMaterial,
  publishAssignment,
  publishQuiz,
  deleteAnnouncement,
  getStudentProgress,
  getTeacherSummary,
  getDiscussions,
  createDiscussion,
  replyDiscussion,
  resolveDiscussion,
  deleteDiscussion,
  getAdminOverview
} = require('../controllers/lmsController');
const { protect, adminOrTeacher } = require('../middleware/authMiddleware');
const { uploadLmsFile } = require('../middleware/uploadMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

const router = express.Router();

router.use(protect);

router.get('/student/progress', cacheMiddleware('lms', 60), getStudentProgress);
router.get('/teacher/summary', adminOrTeacher, cacheMiddleware('lms', 60), getTeacherSummary);
router.get('/admin/overview', adminOrTeacher, cacheMiddleware('lms', 60), getAdminOverview);
router.get('/subjects/:subjectId/overview', cacheMiddleware('classroom', 90), getSubjectOverview);
router.get('/subjects/:subjectId/calendar', cacheMiddleware('classroom', 120), getSubjectCalendar);
router.get('/subjects/:subjectId/discussions', cacheMiddleware('classroom', 45), getDiscussions);

const lmsMultiUpload = uploadLmsFile.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 10 }
]);

router.post('/subjects/:subjectId/materials', adminOrTeacher, lmsMultiUpload, invalidateAfter(createMaterial, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.post('/subjects/:subjectId/material-folders', adminOrTeacher, invalidateAfter(createMaterialFolder, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.post('/subjects/:subjectId/assignments', adminOrTeacher, lmsMultiUpload, invalidateAfter(createAssignment, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));
router.post('/subjects/:subjectId/quizzes', adminOrTeacher, invalidateAfter(createQuiz, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.post('/subjects/:subjectId/quizzes/import', adminOrTeacher, uploadLmsFile.single('file'), invalidateAfter(importQuiz, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.post('/subjects/:subjectId/announcements', adminOrTeacher, invalidateAfter(createAnnouncement, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));
router.post('/subjects/:subjectId/discussions', invalidateAfter(createDiscussion, ['lms', 'classroom']));

router.post('/assignments/:assignmentId/submit', lmsMultiUpload, invalidateAfter(submitAssignment, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.put('/materials/:id', adminOrTeacher, lmsMultiUpload, invalidateAfter(updateMaterial, ['lms', 'classroom', 'dashboard']));
router.put('/material-folders/:id', adminOrTeacher, invalidateAfter(updateMaterialFolder, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.put('/assignments/:id', adminOrTeacher, lmsMultiUpload, invalidateAfter(updateAssignment, ['lms', 'classroom', 'dashboard']));
router.put('/submissions/:submissionId/grade', adminOrTeacher, invalidateAfter(gradeSubmission, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard', 'notifications']));
router.put('/submissions/:submissionId/return', adminOrTeacher, invalidateAfter(returnSubmission, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.post('/assignments/:assignmentId/bulk-return', adminOrTeacher, invalidateAfter(bulkReturnAssignment, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.get('/submissions/:submissionId/comments', getSubmissionComments);
router.post('/submissions/:submissionId/comments', invalidateAfter(addSubmissionComment, ['lms', 'classroom']));
router.post('/quizzes/:quizId/attempt', invalidateAfter(attemptQuiz, ['lms', 'classroom', 'dashboard', 'student-dashboard']));
router.put('/quizzes/:id', adminOrTeacher, invalidateAfter(updateQuiz, ['lms', 'classroom', 'dashboard']));
router.put('/quizzes/:quizId/release-results', adminOrTeacher, invalidateAfter(releaseQuizResults, ['lms', 'classroom', 'dashboard', 'notifications']));
router.get('/assignments/:id/analytics', adminOrTeacher, getAssignmentAnalytics);
router.get('/quizzes/:id/analytics', adminOrTeacher, getQuizAnalytics);
router.get('/materials/:id/analytics', adminOrTeacher, getMaterialAnalytics);
router.post('/materials/:id/view', invalidateAfter(markMaterialViewed, ['lms', 'classroom']));
router.post('/discussions/:discussionId/replies', invalidateAfter(replyDiscussion, ['lms', 'classroom']));
router.put('/discussions/:discussionId/resolve', adminOrTeacher, invalidateAfter(resolveDiscussion, ['lms', 'classroom']));
router.put('/materials/:id/publish', adminOrTeacher, invalidateAfter(publishMaterial, ['lms', 'classroom', 'dashboard']));
router.put('/assignments/:id/publish', adminOrTeacher, invalidateAfter(publishAssignment, ['lms', 'classroom', 'dashboard']));
router.put('/quizzes/:id/publish', adminOrTeacher, invalidateAfter(publishQuiz, ['lms', 'classroom', 'dashboard']));
router.delete('/materials/:id', adminOrTeacher, invalidateAfter(deleteMaterial, ['lms', 'classroom', 'dashboard']));
router.delete('/material-folders/:id', adminOrTeacher, invalidateAfter(deleteMaterialFolder, ['lms', 'classroom', 'dashboard', 'student-dashboard', 'admin-dashboard']));
router.delete('/assignments/:id', adminOrTeacher, invalidateAfter(deleteAssignment, ['lms', 'classroom', 'dashboard']));
router.delete('/quizzes/:id', adminOrTeacher, invalidateAfter(deleteQuiz, ['lms', 'classroom', 'dashboard']));
router.delete('/announcements/:id', adminOrTeacher, invalidateAfter(deleteAnnouncement, ['lms', 'classroom', 'dashboard']));
router.delete('/discussions/:discussionId', adminOrTeacher, invalidateAfter(deleteDiscussion, ['lms', 'classroom']));

module.exports = router;
