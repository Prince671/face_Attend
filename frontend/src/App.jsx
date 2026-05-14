import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { setAppNavigate } from './utils/navigation';
import { PageLoader } from './components/LoadingStates';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminStudents = lazy(() => import('./pages/admin/AdminStudents'));
const AdminStudentDetail = lazy(() => import('./pages/admin/AdminStudentDetail'));
const AdminSubjects = lazy(() => import('./pages/admin/AdminSubjects'));
const AdminLectures = lazy(() => import('./pages/admin/AdminLectures'));
const AdminLectureDetail = lazy(() => import('./pages/admin/AdminLectureDetail'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications'));
const AdminAuditLogs = lazy(() => import('./pages/admin/AdminAuditLogs'));
const AdminTimetable = lazy(() => import('./pages/admin/AdminTimetable'));

const StudentLayout = lazy(() => import('./pages/student/StudentLayout'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const StudentSubjects = lazy(() => import('./pages/student/StudentSubjects'));
const StudentAttendance = lazy(() => import('./pages/student/StudentAttendance'));
const MarkAttendance = lazy(() => import('./pages/student/MarkAttendance'));
const StudentNotifications = lazy(() => import('./pages/student/StudentNotifications'));
const StudentIdCard = lazy(() => import('./pages/student/StudentIdCard'));
const StudentTimetable = lazy(() => import('./pages/student/StudentTimetable'));
const StudentProfile = lazy(() => import('./pages/student/StudentProfile'));

const ProtectedRoute = ({ children, role }) => {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="w-10 h-10 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="text-sm text-slate-400"
        >
          Preparing your workspace...
        </motion.p>
      </motion.div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/student'} replace />;
  return children;
};

const PublicRoute = ({ children }) => {
  const { user } = useAuth();
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/student'} replace />;
  return children;
};

const AppRoutes = () => (
  <Suspense fallback={<PageLoader label="Loading page..." />}>
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      
      {/* Admin Routes */}
      <Route path="/admin" element={<ProtectedRoute role="admin"><AdminLayout /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="students" element={<AdminStudents />} />
        <Route path="students/:id" element={<AdminStudentDetail />} />
        <Route path="subjects" element={<AdminSubjects />} />
        <Route path="lectures" element={<AdminLectures />} />
        <Route path="lectures/:id" element={<AdminLectureDetail />} />
        <Route path="timetable" element={<AdminTimetable />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="audit-logs" element={<AdminAuditLogs />} />
        <Route path="notifications" element={<AdminNotifications />} />
      </Route>
      
      {/* Student Routes */}
      <Route path="/student" element={<ProtectedRoute role="student"><StudentLayout /></ProtectedRoute>}>
        <Route index element={<StudentDashboard />} />
        <Route path="subjects" element={<StudentSubjects />} />
        <Route path="attendance/:subjectId" element={<StudentAttendance />} />
        <Route path="mark-attendance" element={<MarkAttendance />} />
        <Route path="timetable" element={<StudentTimetable />} />
        <Route path="id-card" element={<StudentIdCard />} />
        <Route path="profile" element={<StudentProfile />} />
        <Route path="notifications" element={<StudentNotifications />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  </Suspense>
);

const NavigationBridge = () => {
  const navigate = useNavigate();

  useEffect(() => {
    setAppNavigate(navigate);
    return () => setAppNavigate(null);
  }, [navigate]);

  return null;
};

export default function App() {
  useEffect(() => {
    const preventPageCopy = (event) => {
      const target = event.target;
      if (target?.closest?.('input, textarea, select, [data-allow-copy]')) return;
      event.preventDefault();
    };

    document.addEventListener('copy', preventPageCopy);
    return () => document.removeEventListener('copy', preventPageCopy);
  }, []);

  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <NavigationBridge />
          <Toaster
            position="top-right"
            toastOptions={{
              style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.1)' },
              success: { iconTheme: { primary: '#10b981', secondary: '#f1f5f9' } },
              error: { iconTheme: { primary: '#ef4444', secondary: '#f1f5f9' } },
              duration: 4000
            }}
          />
          <AppRoutes />
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
