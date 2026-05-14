import axios from 'axios';
import { navigateTo } from '../utils/navigation';

const API = axios.create({
  baseURL: '/api',
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
  register: (formData) => API.post('/auth/register', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  login: (data) => API.post('/auth/login', data),
  faceLogin: (formData) => API.post('/auth/face-login', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  beginBiometricRegistration: () => API.post('/auth/biometric/register/options'),
  finishBiometricRegistration: (data) => API.post('/auth/biometric/register/verify', data),
  beginBiometricLogin: (data) => API.post('/auth/biometric/login/options', data),
  finishBiometricLogin: (data) => API.post('/auth/biometric/login/verify', data),
  getMe: () => API.get('/auth/me'),
  updateProfile: (data) => API.put('/auth/update-profile', data),
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
  delete: (id) => API.delete(`/admin/students/${id}`),
  enroll: (id, subjectIds) => API.put(`/admin/students/${id}/enroll`, { subjectIds }),
  getAnalytics: () => API.get('/admin/analytics'),
  getSuperOverview: (params) => API.get('/admin/super-overview', { params }),
  getAuditLogs: (params) => API.get('/admin/audit-logs', { params }),
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

// === Lectures ===
export const lectureAPI = {
  getAll: (params) => API.get('/lectures', { params }),
  getById: (id) => API.get(`/lectures/${id}`),
  getAttendance: (id) => API.get(`/lectures/${id}/attendance`),
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
  downloadLectureExcel: (lectureId) => API.get(`/attendance/lecture/${lectureId}/download`, { responseType: 'blob' }),
  downloadSessionExcel: (params) => API.get('/attendance/session/download', { params, responseType: 'blob' }),
  getSubjectAnalytics: (subjectId) => API.get(`/attendance/analytics/subject/${subjectId}`),
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
  deleteOne: (id) => API.delete(`/notifications/${id}`),
  deleteAll: () => API.delete('/notifications/all'),
};

export const deletionAPI = {
  getPending: () => API.get('/deletions'),
  undo: (id) => API.put(`/deletions/${id}/undo`),
};

export default API;
