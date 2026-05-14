import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Users, BookOpen, Video, BarChart3,
  Bell, LogOut, Menu, X, Scan, ChevronRight, AlertTriangle, ShieldCheck, CalendarDays, GraduationCap
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { authAPI, notificationAPI } from '../../services/api';
import ThemeToggle from '../../components/ThemeToggle';
import AppConfirmModal from '../../components/AppConfirmModal';
import PendingDeletionTray from '../../components/PendingDeletionTray';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/students', icon: Users, label: 'Students' },
  { to: '/admin/subjects', icon: BookOpen, label: 'Subjects' },
  { to: '/admin/lectures', icon: Video, label: 'Lectures' },
  { to: '/admin/timetable', icon: CalendarDays, label: 'Timetable' },
  { to: '/admin/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/admin/audit-logs', icon: ShieldCheck, label: 'Audit Logs' },
  { to: '/admin/notifications', icon: Bell, label: 'Notifications' },
];

const YEAR_OPTIONS = [
  { year: 1, label: '1st Year', semesters: [1, 2] },
  { year: 2, label: '2nd Year', semesters: [3, 4] },
  { year: 3, label: '3rd Year', semesters: [5, 6] },
  { year: 4, label: '4th Year', semesters: [7, 8] },
];

function AdminScopeModal({ user, onSaved }) {
  const [year, setYear] = useState(user?.adminAcademicYear || 1);
  const [semester, setSemester] = useState(user?.adminSemesterScope || 1);
  const [saving, setSaving] = useState(false);
  const selectedYear = YEAR_OPTIONS.find(option => option.year === Number(year)) || YEAR_OPTIONS[0];

  useEffect(() => {
    if (!selectedYear.semesters.includes(Number(semester))) {
      setSemester(selectedYear.semesters[0]);
    }
  }, [selectedYear, semester]);

  const saveScope = async () => {
    setSaving(true);
    try {
      const res = await authAPI.updateAdminScope({ year, semester });
      onSaved(res.data.user);
      toast.success(`Semester ${semester} workspace selected`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save workspace scope');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-xl glass-card border border-primary-500/30 shadow-2xl"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-primary-300" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-white">Choose Admin Workspace</h2>
            <p className="text-slate-400 text-sm mt-1">Select the year and semester you want to manage for this login session.</p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <label className="label">Academic Year</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {YEAR_OPTIONS.map(option => (
                <button
                  key={option.year}
                  type="button"
                  onClick={() => {
                    setYear(option.year);
                    setSemester(option.semesters[0]);
                  }}
                  className={`rounded-lg border px-3 py-3 text-sm font-medium transition-all ${
                    Number(year) === option.year
                      ? 'border-primary-400 bg-primary-500/20 text-white'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Semester</label>
            <div className="grid grid-cols-2 gap-2">
              {selectedYear.semesters.map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSemester(item)}
                  className={`rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                    Number(semester) === item
                      ? 'border-emerald-400 bg-emerald-500/20 text-white'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
                  }`}
                >
                  Semester {item}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-slate-300">
              {user?.department} admin workspace will show Semester {semester} students, subjects, lectures, reports, and timetable slots.
            </p>
          </div>

          <button onClick={saveScope} disabled={saving} className="btn-primary w-full">
            {saving ? 'Saving Workspace...' : `Continue to Semester ${semester}`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminLayout() {
  const { user, logout, updateUser } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [unread, setUnread] = useState(0);
  const [alert, setAlert] = useState(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isDepartmentAdmin = user?.role === 'admin' && user?.department && !isSuperAdmin;
  const mustChooseScope = isDepartmentAdmin && sessionStorage.getItem('adminScopeSelected') !== user?._id;

  const refreshUnreadCount = useCallback(() => {
    notificationAPI.getUnreadCount().then(r => setUnread(r.data.count || 0)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshUnreadCount();
    window.addEventListener('notifications:changed', refreshUnreadCount);
    return () => window.removeEventListener('notifications:changed', refreshUnreadCount);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!socket) return;
    socket.on('new_registration', (data) => {
      toast(`New registration: ${data.name}`, { icon: '👤' });
      setUnread(p => p + 1);
    });
    socket.on('attendance_marked', (data) => {
      setUnread(p => p + 1);
    });
    socket.on('restricted_student_detected', (data) => {
      setAlert(data);
      toast.error(`🚨 Restricted student detected: ${data.studentName}`, { duration: 8000 });
      setUnread(p => p + 1);
    });
    return () => {
      socket.off('new_registration');
      socket.off('attendance_marked');
      socket.off('restricted_student_detected');
    };
  }, [socket]);

  const handleLogout = () => { logout(); navigate('/login'); toast.success('Logged out'); };
  const handleScopeSaved = (nextUser) => {
    updateUser(nextUser);
    sessionStorage.setItem('adminScopeSelected', nextUser._id);
    window.dispatchEvent(new Event('admin-scope:changed'));
  };

  return (
    <div className="h-screen overflow-hidden flex bg-slate-950">
      <AppConfirmModal
        open={logoutOpen}
        title="Sign Out?"
        message="You will be signed out of the admin panel. Pending delete undo windows will remain available to admins until they expire."
        confirmLabel="Sign Out"
        tone="logout"
        onCancel={() => setLogoutOpen(false)}
        onConfirm={handleLogout}
      />
      {mustChooseScope && <AdminScopeModal user={user} onSaved={handleScopeSaved} />}
      {sidebarOpen && <div className="fixed inset-0 bg-slate-950/70 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />}
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-[min(15rem,84vw)] md:w-64 flex-shrink-0 flex flex-col bg-slate-900/95 md:bg-slate-900/80 border-r border-white/5 fixed h-full z-20"
          >
            {/* Logo */}
            <div className="p-4 sm:p-5 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
                  <Scan className="w-5 h-5 text-primary-400" />
                </div>
                <div>
                  <span className="font-display font-bold text-white text-lg">FaceAttend</span>
                  <p className="text-xs text-slate-500">Admin Panel</p>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 min-h-0 p-3 sm:p-4 space-y-1 overflow-y-auto">
              {navItems.map(({ to, icon: Icon, label, end }) => (
                <NavLink key={to} to={to} end={end}
                  onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
                  className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{label}</span>
                  {label === 'Notifications' && unread > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>
                  )}
                </NavLink>
              ))}
            </nav>

            {/* User */}
            <div className="p-3 sm:p-4 border-t border-white/5 pb-24 md:pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-primary-600/30 flex items-center justify-center text-primary-300 font-semibold text-sm">
                  {user?.name?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.name}</p>
                  <p className="text-xs text-slate-500">
                    {isDepartmentAdmin && user?.adminSemesterScope ? `Sem ${user.adminSemesterScope} Admin` : 'Administrator'}
                  </p>
                </div>
              </div>
              <button onClick={() => setLogoutOpen(true)} className="flex items-center gap-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl text-sm w-full transition-colors px-2 py-2.5">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 ${sidebarOpen ? 'md:ml-64' : 'ml-0'}`}>
        {/* Top bar */}
        <header className="h-14 sm:h-16 flex-shrink-0 bg-slate-900/60 border-b border-white/5 flex items-center justify-between px-3 sm:px-6 sticky top-0 z-10 backdrop-blur-xl">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="mobile-icon-btn rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <NavLink to="/admin/notifications" className="mobile-icon-btn relative text-slate-400 hover:text-white hover:bg-white/10 transition-colors rounded-xl flex items-center justify-center">
              <Bell className="w-5 h-5" />
              {unread > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-slate-900" />}
            </NavLink>
          </div>
        </header>

        {/* Alert banner */}
        <AnimatePresence>
          {alert && (
            <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}
              className="flex-shrink-0 bg-red-500/20 border-b border-red-500/30 px-3 sm:px-6 py-3 flex items-start sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <p className="text-red-300 text-sm flex-1">
                <strong>RESTRICTED STUDENT DETECTED:</strong> {alert.studentName} ({alert.studentId}) attempted attendance in {alert.subjectName}
              </p>
              <button onClick={() => setAlert(null)} className="text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 min-h-0 p-3 sm:p-6 pb-24 md:pb-6 overflow-y-auto overflow-x-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="page-enter"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {isSuperAdmin || isDepartmentAdmin ? <PendingDeletionTray /> : null}

      <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/92 backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-4 gap-1 px-2 pt-2">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] transition-colors ${isActive ? 'bg-primary-600/20 text-primary-300' : 'text-slate-500 hover:text-white'}`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate max-w-full">{label.replace('Audit Logs', 'Audit')}</span>
              {label === 'Notifications' && unread > 0 && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
