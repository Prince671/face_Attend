import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import RealtimeBridge from './features/realtime/realtimeBridge';
import { setAppNavigate } from './utils/navigation';
import { AppShellSkeleton, AuthPageSkeleton, PageLoader } from './components/LoadingStates';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'));

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminStudents = lazy(() => import('./pages/admin/AdminStudents'));
const AdminStudentDetail = lazy(() => import('./pages/admin/AdminStudentDetail'));
const AdminSubjects = lazy(() => import('./pages/admin/AdminSubjects'));
const AdminLectures = lazy(() => import('./pages/admin/AdminLectures'));
const AdminLectureDetail = lazy(() => import('./pages/admin/AdminLectureDetail'));
const AdminTeachers = lazy(() => import('./pages/admin/AdminTeachers'));
const TeacherDirectory = lazy(() => import('./pages/admin/TeacherDirectory'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications'));
const AdminAuditLogs = lazy(() => import('./pages/admin/AdminAuditLogs'));
const AdminTimetable = lazy(() => import('./pages/admin/AdminTimetable'));
const TeacherProfile = lazy(() => import('./pages/admin/TeacherProfile'));
const SubjectClassroom = lazy(() => import('./pages/shared/SubjectClassroom'));

const StudentLayout = lazy(() => import('./pages/student/StudentLayout'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const StudentSubjects = lazy(() => import('./pages/student/StudentSubjects'));
const StudentAttendance = lazy(() => import('./pages/student/StudentAttendance'));
const MarkAttendance = lazy(() => import('./pages/student/MarkAttendance'));
const StudentNotifications = lazy(() => import('./pages/student/StudentNotifications'));
const StudentIdCard = lazy(() => import('./pages/student/StudentIdCard'));
const StudentTimetable = lazy(() => import('./pages/student/StudentTimetable'));
const StudentProfile = lazy(() => import('./pages/student/StudentProfile'));
const StudentRooms = lazy(() => import('./pages/student/StudentRooms'));

const ProtectedRoute = ({ children, role }) => {
  const { user, loading } = useAuth();
  if (loading) return <AppShellSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  const allowedRoles = Array.isArray(role) ? role : (role ? [role] : []);
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    return <Navigate to={['admin', 'teacher'].includes(user.role) ? '/admin' : '/student'} replace />;
  }
  return children;
};

const PublicRoute = ({ children }) => {
  const { user } = useAuth();
  if (user) return <Navigate to={['admin', 'teacher'].includes(user.role) ? '/admin' : '/student'} replace />;
  return children;
};

const AdminIndex = () => {
  return <AdminDashboard />;
};

const RouteSuspenseFallback = () => {
  const { pathname } = useLocation();
  if (pathname.startsWith('/login')) return <AuthPageSkeleton mode="login" />;
  if (pathname.startsWith('/register')) return <AuthPageSkeleton mode="register" />;
  if (pathname.startsWith('/forgot-password')) return <AuthPageSkeleton mode="forgot" />;
  if (pathname.startsWith('/admin') || pathname.startsWith('/student')) return <AppShellSkeleton compactSidebar={pathname.startsWith('/student')} />;
  return <PageLoader label="Loading page..." />;
};

const AppRoutes = () => (
  <Suspense fallback={<RouteSuspenseFallback />}>
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      
      {/* Admin Routes */}
      <Route path="/admin" element={<ProtectedRoute role={['admin', 'teacher']}><AdminLayout /></ProtectedRoute>}>
        <Route index element={<AdminIndex />} />
        <Route path="students" element={<ProtectedRoute role={['admin', 'teacher']}><AdminStudents /></ProtectedRoute>} />
        <Route path="students/:id" element={<ProtectedRoute role="admin"><AdminStudentDetail /></ProtectedRoute>} />
        <Route path="teachers" element={<ProtectedRoute role="admin"><AdminTeachers /></ProtectedRoute>} />
        <Route path="teacher-directory" element={<ProtectedRoute role="teacher"><TeacherDirectory /></ProtectedRoute>} />
        <Route path="teacher-directory/:id" element={<ProtectedRoute role="teacher"><TeacherDirectory /></ProtectedRoute>} />
        <Route path="subjects" element={<AdminSubjects />} />
        <Route path="subjects/:subjectId/classroom" element={<SubjectClassroom />} />
        <Route path="lectures" element={<AdminLectures />} />
        <Route path="lectures/:id" element={<AdminLectureDetail />} />
        <Route path="timetable" element={<ProtectedRoute role="admin"><AdminTimetable /></ProtectedRoute>} />
        <Route path="analytics" element={<ProtectedRoute role="admin"><AdminAnalytics /></ProtectedRoute>} />
        <Route path="audit-logs" element={<ProtectedRoute role="admin"><AdminAuditLogs /></ProtectedRoute>} />
        <Route path="notifications" element={<AdminNotifications />} />
        <Route path="profile" element={<ProtectedRoute role="teacher"><TeacherProfile /></ProtectedRoute>} />
      </Route>
      
      {/* Student Routes */}
      <Route path="/student" element={<ProtectedRoute role="student"><StudentLayout /></ProtectedRoute>}>
        <Route index element={<StudentDashboard />} />
        <Route path="subjects" element={<StudentSubjects />} />
        <Route path="subjects/:subjectId/classroom" element={<SubjectClassroom />} />
        <Route path="attendance/:subjectId" element={<StudentAttendance />} />
        <Route path="mark-attendance" element={<MarkAttendance />} />
        <Route path="timetable" element={<StudentTimetable />} />
        <Route path="rooms" element={<StudentRooms />} />
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
        <RealtimeBridge />
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
