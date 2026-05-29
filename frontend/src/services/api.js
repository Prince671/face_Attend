import axios from 'axios';
import { navigateTo } from '../utils/navigation';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

// Attach token to every request
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401/403 globally
API.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      navigateTo('/login', { replace: true });
    }
    return Promise.reject(error);
  }
);

// === Auth ===
export const authAPI = {
  detectRegistrationFace: (formData) => API.post('/auth/detect-registration-face', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  sendRegistrationOtp: (data) => API.post('/auth/registration/send-otp', data),
  verifyRegistrationOtp: (data) => API.post('/auth/registration/verify-otp', data),
  sendProfileEmailOtp: (data) => API.post('/auth/profile-email/send-otp', data),
  verifyProfileEmailOtp: (data) => API.post('/auth/profile-email/verify-otp', data),
  register: (formData) => API.post('/auth/register', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  login: (data) => API.post('/auth/login', data),
  sendForgotPasswordOtp: (data) => API.post('/auth/forgot-password/send-otp', data),
  verifyForgotPasswordOtp: (data) => API.post('/auth/forgot-password/verify-otp', data),
  resetForgotPassword: (data) => API.post('/auth/forgot-password/reset', data),
  faceLogin: (formData) => API.post('/auth/face-login', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  beginBiometricRegistration: () => API.post('/auth/biometric/register/options'),
  finishBiometricRegistration: (data) => API.post('/auth/biometric/register/verify', data),
  beginBiometricLogin: (data) => API.post('/auth/biometric/login/options', data),
  finishBiometricLogin: (data) => API.post('/auth/biometric/login/verify', data),
  getMe: () => API.get('/auth/me'),
  updateProfile: (data) => API.put('/auth/update-profile', data, data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : undefined),
  updateAdminScope: (data) => API.put('/auth/admin-scope', data),
};

// === Admin ===
export const adminAPI = {
  getPending: () => API.get('/admin/students/pending'),
  getAll: (params) => API.get('/admin/students', { params }),
  getById: (id) => API.get(`/admin/students/${id}`),
  approve: (id) => API.put(`/admin/students/${id}/approve`),
  reject: (id, reason) => API.put(`/admin/students/${id}/reject`, { reason }),
  activate: (id) => API.put(`/admin/students/${id}/activate`),
  deactivate: (id, reason) => API.put(`/admin/students/${id}/deactivate`, { reason }),
  restrict: (id, reason) => API.put(`/admin/students/${id}/restrict`, { reason }),
  unrestrict: (id) => API.put(`/admin/students/${id}/unrestrict`),
  delete: (id) => API.delete(`/admin/students/${id}`),
  enroll: (id, subjectIds) => API.put(`/admin/students/${id}/enroll`, { subjectIds }),
  approveProfileUpdate: (id) => API.put(`/admin/students/${id}/profile-update/approve`),
  rejectProfileUpdate: (id, note) => API.put(`/admin/students/${id}/profile-update/reject`, { note }),
  getAnalytics: (params) => API.get('/admin/analytics', { params }),
  getSuperOverview: (params) => API.get('/admin/super-overview', { params }),
  getAcademicStructure: () => API.get('/admin/academic-structure'),
  addAcademicCourse: (data) => API.post('/admin/academic-structure/courses', data),
  addAcademicBranch: (data) => API.post('/admin/academic-structure/branches', data),
  deleteAcademicCourse: (course) => API.delete(`/admin/academic-structure/courses/${encodeURIComponent(course)}`),
  deleteAcademicBranch: (course, branch) => API.delete(`/admin/academic-structure/branches/${encodeURIComponent(course)}/${encodeURIComponent(branch)}`),
  getAuditLogs: (params) => API.get('/admin/audit-logs', { params }),
  getTeachers: (params) => API.get('/admin/teachers', { params }),
  createTeacher: (data) => API.post('/admin/teachers', data),
  importTeachers: (formData, config = {}) => API.post('/admin/teachers/import', formData, { ...config, headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) } }),
  importStudents: (formData, config = {}) => API.post('/admin/students/import', formData, { ...config, headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) } }),
  bulkDeleteStudents: (data) => API.post('/admin/students/bulk-delete', data),
  deleteTeacher: (id) => API.delete(`/admin/teachers/${id}`),
  getTeacherAllocation: (params) => API.get('/admin/teachers/allocation', { params }),
  saveTeacherAllocation: (data) => API.put('/admin/teachers/allocation', data),
  getTeacherDashboard: () => API.get('/admin/teacher-dashboard'),
  getTeacherStudents: (params) => API.get('/admin/teacher-students', { params }),
  restrictStudentForSubject: (id, subjectId, reason) => API.put(`/admin/teacher-students/${id}/restrict-subject`, { subjectId, reason }),
  unrestrictStudentForSubject: (id, subjectId) => API.put(`/admin/teacher-students/${id}/unrestrict-subject`, { subjectId }),
  notifyLowAttendance: (subjectId) => API.post('/admin/teacher-dashboard/low-attendance/notify', { subjectId }),
  getTeacherPeers: () => API.get('/admin/teacher-peers'),
  getTeacherPeerProfile: (id, params) => API.get(`/admin/teacher-peers/${id}`, { params }),
};

// === Subjects ===
export const subjectAPI = {
  getAll: (params) => API.get('/subjects', { params }),
  getMine: () => API.get('/subjects/my-subjects'),
  getById: (id) => API.get(`/subjects/${id}`),
  create: (data) => API.post('/subjects', data),
  update: (id, data) => API.put(`/subjects/${id}`, data),
  delete: (id) => API.delete(`/subjects/${id}`),
};

// === LMS ===
export const lmsAPI = {
  getSubjectOverview: (subjectId) => API.get(`/lms/subjects/${subjectId}/overview`),
  getSubjectCalendar: (subjectId, params) => API.get(`/lms/subjects/${subjectId}/calendar`, { params }),
  getDiscussions: (subjectId) => API.get(`/lms/subjects/${subjectId}/discussions`),
  getStudentProgress: () => API.get('/lms/student/progress'),
  getTeacherSummary: () => API.get('/lms/teacher/summary'),
  getAdminOverview: () => API.get('/lms/admin/overview'),
  createMaterial: (subjectId, formData, config = {}) => API.post(`/lms/subjects/${subjectId}/materials`, formData, { ...config, headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) } }),
  createMaterialFolder: (subjectId, data) => API.post(`/lms/subjects/${subjectId}/material-folders`, data),
  updateMaterialFolder: (id, data) => API.put(`/lms/material-folders/${id}`, data),
  deleteMaterialFolder: (id) => API.delete(`/lms/material-folders/${id}`),
  updateMaterial: (id, formData, config = {}) => API.put(`/lms/materials/${id}`, formData, { ...config, headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) } }),
  createAssignment: (subjectId, formData) => API.post(`/lms/subjects/${subjectId}/assignments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateAssignment: (id, formData) => API.put(`/lms/assignments/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  submitAssignment: (assignmentId, formData) => API.post(`/lms/assignments/${assignmentId}/submit`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  gradeSubmission: (submissionId, data) => API.put(`/lms/submissions/${submissionId}/grade`, data),
  returnSubmission: (submissionId) => API.put(`/lms/submissions/${submissionId}/return`),
  bulkReturnAssignment: (assignmentId) => API.post(`/lms/assignments/${assignmentId}/bulk-return`),
  getSubmissionComments: (submissionId) => API.get(`/lms/submissions/${submissionId}/comments`),
  addSubmissionComment: (submissionId, data) => API.post(`/lms/submissions/${submissionId}/comments`, data),
  createQuiz: (subjectId, data) => API.post(`/lms/subjects/${subjectId}/quizzes`, data),
  updateQuiz: (id, data) => API.put(`/lms/quizzes/${id}`, data),
  importQuiz: (subjectId, formData) => API.post(`/lms/subjects/${subjectId}/quizzes/import`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  attemptQuiz: (quizId, data) => API.post(`/lms/quizzes/${quizId}/attempt`, data),
  releaseQuizResults: (quizId) => API.put(`/lms/quizzes/${quizId}/release-results`),
  getAssignmentAnalytics: (id) => API.get(`/lms/assignments/${id}/analytics`),
  getQuizAnalytics: (id) => API.get(`/lms/quizzes/${id}/analytics`),
  getMaterialAnalytics: (id) => API.get(`/lms/materials/${id}/analytics`),
  markMaterialViewed: (id) => API.post(`/lms/materials/${id}/view`),
  publishMaterial: (id) => API.put(`/lms/materials/${id}/publish`),
  publishAssignment: (id) => API.put(`/lms/assignments/${id}/publish`),
  publishQuiz: (id) => API.put(`/lms/quizzes/${id}/publish`),
  createAnnouncement: (subjectId, data) => API.post(`/lms/subjects/${subjectId}/announcements`, data),
  createDiscussion: (subjectId, data) => API.post(`/lms/subjects/${subjectId}/discussions`, data),
  replyDiscussion: (discussionId, data) => API.post(`/lms/discussions/${discussionId}/replies`, data),
  resolveDiscussion: (discussionId) => API.put(`/lms/discussions/${discussionId}/resolve`),
  deleteMaterial: (id) => API.delete(`/lms/materials/${id}`),
  deleteAssignment: (id) => API.delete(`/lms/assignments/${id}`),
  deleteQuiz: (id) => API.delete(`/lms/quizzes/${id}`),
  deleteAnnouncement: (id) => API.delete(`/lms/announcements/${id}`),
  deleteDiscussion: (id) => API.delete(`/lms/discussions/${id}`),
};

// === Student Room/Groups Chat ===
export const chatAPI = {
  getGroups: () => API.get('/chat/groups'),
  searchStudents: (params) => API.get('/chat/students/search', { params }),
  createGroup: (data) => API.post('/chat/groups', data),
  getMessages: (groupId, params) => API.get(`/chat/groups/${groupId}/messages`, { params }),
  sendMessage: (groupId, formData, config = {}) => API.post(`/chat/groups/${groupId}/messages`, formData, { ...config, headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) } }),
  uploadMedia: (groupId, formData, config = {}) => API.post(`/chat/groups/${groupId}/media`, formData, { ...config, headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) } }),
  createPoll: (groupId, data) => API.post(`/chat/groups/${groupId}/polls`, data),
  getGallery: (groupId) => API.get(`/chat/groups/${groupId}/gallery`),
  getInvite: (groupId) => API.get(`/chat/groups/${groupId}/invite`),
  regenerateInvite: (groupId, data = {}) => API.post(`/chat/groups/${groupId}/invite/regenerate`, data),
  sendInvite: (groupId, data) => API.post(`/chat/groups/${groupId}/invite/send`, data),
  joinByInvite: (code) => API.post('/chat/groups/join', { code }),
  getJoinRequests: (groupId) => API.get(`/chat/groups/${groupId}/join-requests`),
  reviewJoinRequest: (groupId, requestId, status) => API.put(`/chat/groups/${groupId}/join-requests/${requestId}`, { status }),
  updateMemberPrefs: (groupId, data) => API.put(`/chat/groups/${groupId}/preferences`, data),
  getStarredMessages: () => API.get('/chat/messages/starred'),
  getScheduledMessages: () => API.get('/chat/messages/scheduled'),
  cancelScheduledMessage: (messageId) => API.delete(`/chat/messages/${messageId}/schedule`),
  broadcast: (data) => API.post('/chat/broadcasts', data),
  updateGroup: (groupId, data) => API.put(`/chat/groups/${groupId}`, data),
  updateGroupAvatar: (groupId, formData) => API.post(`/chat/groups/${groupId}/avatar`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteGroup: (groupId) => API.delete(`/chat/groups/${groupId}`),
  clearGroupChat: (groupId) => API.post(`/chat/groups/${groupId}/clear`),
  leaveGroup: (groupId) => API.post(`/chat/groups/${groupId}/leave`),
  addMembers: (groupId, memberIds) => API.post(`/chat/groups/${groupId}/members`, { memberIds }),
  removeMember: (groupId, studentId) => API.delete(`/chat/groups/${groupId}/members/${studentId}`),
  setMemberAdmin: (groupId, studentId, isAdmin = true) => API.put(`/chat/groups/${groupId}/members/${studentId}/admin`, { isAdmin }),
  updateMessage: (messageId, data) => API.put(`/chat/messages/${messageId}`, data),
  deleteMessage: (messageId, data = {}) => API.delete(`/chat/messages/${messageId}`, { data }),
  undoDeleteForMe: (messageId) => API.post(`/chat/messages/${messageId}/undo-delete`),
  reactMessage: (messageId, emoji) => API.post(`/chat/messages/${messageId}/reactions`, { emoji }),
  starMessage: (messageId) => API.post(`/chat/messages/${messageId}/star`),
  forwardMessage: (messageId, groupIds) => API.post(`/chat/messages/${messageId}/forward`, { groupIds }),
  markRead: (messageId) => API.post(`/chat/messages/${messageId}/read`),
  getReceipts: (messageId) => API.get(`/chat/messages/${messageId}/receipts`),
  pinMessage: (messageId, duration = 'always') => API.post(`/chat/messages/${messageId}/pin`, { duration }),
  markImportant: (messageId, important = true) => API.post(`/chat/messages/${messageId}/important`, { important }),
  votePoll: (messageId, optionId) => API.post(`/chat/messages/${messageId}/vote`, { optionId }),
  reportMessage: (messageId, reason) => API.post(`/chat/messages/${messageId}/report`, { reason }),
};

// === Lectures ===
export const lectureAPI = {
  getAll: (params) => API.get('/lectures', { params }),
  getById: (id) => API.get(`/lectures/${id}`),
  getAttendance: (id) => API.get(`/lectures/${id}/attendance`),
  getCopySources: (id, params) => API.get(`/lectures/${id}/copy-sources`, { params }),
  create: (data) => API.post('/lectures', data),
  startAttendance: (id, data = {}) => API.put(`/lectures/${id}/start-attendance`, data),
  stopAttendance: (id) => API.put(`/lectures/${id}/stop-attendance`),
  copyAttendance: (id, sourceLectureId) => API.post(`/lectures/${id}/copy-attendance`, { sourceLectureId }),
  delete: (id) => API.delete(`/lectures/${id}`),
};

// === Timetables ===
export const timetableAPI = {
  getAll: () => API.get('/timetables'),
  getMine: () => API.get('/timetables/my'),
  save: (formData) => API.post('/timetables', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  generateLectures: (id, data) => API.post(`/timetables/${id}/generate-lectures`, data),
};

// === Attendance ===
export const attendanceAPI = {
  detectGuideFace: (formData) => API.post('/attendance/detect-guide-face', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  mark: (formData) => API.post('/attendance/mark', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getStudentSubject: (subjectId) => API.get(`/attendance/student/subject/${subjectId}`),
  downloadExcel: (subjectId) => API.get(`/attendance/student/subject/${subjectId}/download`, { responseType: 'blob' }),
  getLectureAttendance: (lectureId) => API.get(`/attendance/lecture/${lectureId}`),
  updateLectureStatus: (lectureId, data) => API.put(`/attendance/lecture/${lectureId}/status`, data),
  downloadLectureExcel: (lectureId) => API.get(`/attendance/lecture/${lectureId}/download`, { responseType: 'blob' }),
  downloadSessionExcel: (params) => API.get('/attendance/session/download', { params, responseType: 'blob' }),
  getSubjectAnalytics: (subjectId) => API.get(`/attendance/analytics/subject/${subjectId}`),
  getSubjectHistory: (subjectId, params) => API.get(`/attendance/subject/${subjectId}/history`, { params }),
  importSubjectAttendance: (subjectId, formData, config = {}) => API.post(`/attendance/subject/${subjectId}/import`, formData, { ...config, headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) } }),
  deleteImportedSubjectAttendance: (subjectId, data) => API.post(`/attendance/subject/${subjectId}/imported-delete`, data),
  createDispute: (data) => API.post('/attendance/disputes', data),
  getDisputes: (params) => API.get('/attendance/disputes', { params }),
  resolveDispute: (id, data) => API.put(`/attendance/disputes/${id}`, data),
  deleteDispute: (id) => API.delete(`/attendance/disputes/${id}`),
  deleteDisputes: (params) => API.delete('/attendance/disputes', { params }),
};

export const holidayAPI = {
  getAll: () => API.get('/holidays'),
  create: (data) => API.post('/holidays', data),
  delete: (id) => API.delete(`/holidays/${id}`),
};

// === Student ===
export const studentAPI = {
  getDashboard: () => API.get('/student/dashboard'),
  getLecturesBySubject: (subjectId) => API.get(`/student/lectures/subject/${subjectId}`),
};

// === Notifications ===
export const notificationAPI = {
  getAll: () => API.get('/notifications'),
  getUnreadCount: () => API.get('/notifications/unread-count'),
  markRead: (id) => API.put(`/notifications/${id}/read`),
  markAllRead: () => API.put('/notifications/mark-all-read'),
  setAutoDeleteProtection: (id, preserve) => API.put(`/notifications/${id}/auto-delete-protection`, { preserve }),
  deleteOne: (id) => API.delete(`/notifications/${id}`),
  deleteAll: () => API.delete('/notifications/all'),
};

export const deletionAPI = {
  getPending: () => API.get('/deletions'),
  undo: (id) => API.put(`/deletions/${id}/undo`),
  undoBatch: (batchId) => API.put(`/deletions/batch/${batchId}/undo`),
};

export default API;
