import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Users, BookOpen, Video, BarChart3,
  Bell, LogOut, Menu, X, Scan, ChevronRight, ChevronDown, AlertTriangle, ShieldCheck, CalendarDays, GraduationCap, UserCog, User, Loader2
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { authAPI, notificationAPI } from '../../services/api';
import ThemeToggle from '../../components/ThemeToggle';
import AppConfirmModal from '../../components/AppConfirmModal';
import PendingDeletionTray from '../../components/PendingDeletionTray';
import useMobileHoldTitle from '../../hooks/useMobileHoldTitle';
import { SkeletonLine } from '../../components/LoadingStates';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/students', icon: Users, label: 'Students' },
  { to: '/admin/teachers', icon: UserCog, label: 'Teachers', adminOnly: true },
  { to: '/admin/teacher-directory', icon: Users, label: 'Teachers', teacherOnly: true },
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

function AdminScopeModal({ user, onSaved, onClose, forced = false }) {
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
      await new Promise(resolve => setTimeout(resolve, 700));
      onSaved(res.data.user);
      toast.success(`Semester ${semester} workspace selected`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save workspace scope');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-modal-backdrop">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-xl glass-card border border-primary-500/30 shadow-2xl overflow-hidden"
      >
        <AnimatePresence>
          {saving && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 bg-slate-950/82 backdrop-blur-md flex flex-col items-center justify-center text-center p-6"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                className="w-14 h-14 rounded-2xl border border-primary-400/30 bg-primary-500/15 flex items-center justify-center"
              >
                <GraduationCap className="w-7 h-7 text-primary-300" />
              </motion.div>
              <h3 className="font-display text-xl font-bold text-white mt-4">Setting up the profile</h3>
              <p className="text-sm text-slate-400 mt-1">Preparing Semester {semester} workspace...</p>
            </motion.div>
          )}
        </AnimatePresence>
        {!forced && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 rounded-xl p-2 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-primary-300" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-white">{forced ? 'Choose Admin Workspace' : 'Switch Admin Workspace'}</h2>
            <p className="text-slate-400 text-sm mt-1">Select the year and semester you want to manage. The dashboard will refresh automatically.</p>
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
              {user?.role === 'teacher'
                ? `Your teacher workspace will show assigned Semester ${semester} subjects, lectures, and attendance tools.`
                : `${user?.department} admin workspace will show Semester ${semester} students, subjects, lectures, reports, and timetable slots.`}
            </p>
          </div>

          <button onClick={saveScope} disabled={saving} className="btn-primary w-full">
            {saving ? 'Setting up Profile...' : forced ? `Continue to Semester ${semester}` : `Switch to Semester ${semester}`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminLayout() {
  useMobileHoldTitle();
  const { user, logout, updateUser } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [unread, setUnread] = useState(0);
  const [unreadLoading, setUnreadLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [appBusy, setAppBusy] = useState(false);
  const [appBusyLabel, setAppBusyLabel] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const alarmRef = useRef({ context: null, oscillator: null, gain: null, timer: null });
  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isDepartmentAdmin = user?.role === 'admin' && user?.department && !isSuperAdmin;
  const isTeacher = user?.role === 'teacher';
  const mustChooseScope = isTeacher && sessionStorage.getItem('adminScopeSelected') !== user?._id;
  const visibleNavItems = navItems.filter(item => {
    if (isTeacher) return item.to === '/admin' || item.to === '/admin/students' || item.to === '/admin/teacher-directory' || item.to === '/admin/subjects' || item.to === '/admin/lectures' || item.to === '/admin/notifications';
    if (item.teacherOnly) return false;
    if (item.adminOnly && user?.role !== 'admin') return false;
    return true;
  });

  const refreshUnreadCount = useCallback(() => {
    setUnreadLoading(true);
    notificationAPI.getUnreadCount()
      .then(r => setUnread(r.data.count || 0))
      .catch(() => {})
      .finally(() => setUnreadLoading(false));
  }, []);

  const stopRestrictedAlarm = useCallback(() => {
    const alarm = alarmRef.current;
    if (alarm.timer) clearTimeout(alarm.timer);
    try {
      alarm.gain?.gain?.setTargetAtTime(0, alarm.context?.currentTime || 0, 0.03);
      alarm.oscillator?.stop((alarm.context?.currentTime || 0) + 0.08);
    } catch (_) {}
    alarmRef.current = { context: alarm.context, oscillator: null, gain: null, timer: null };
  }, []);

  const playRestrictedAlarm = useCallback(() => {
    stopRestrictedAlarm();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = alarmRef.current.context || new AudioContextClass();
    if (context.state === 'suspended') context.resume().catch(() => {});
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(520, context.currentTime);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.05);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    const timer = setTimeout(stopRestrictedAlarm, 5000);
    alarmRef.current = { context, oscillator, gain, timer };
  }, [stopRestrictedAlarm]);

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
    socket.on('notification_created', refreshUnreadCount);
    socket.on('restricted_student_detected', (data) => {
      setAlert(data);
      playRestrictedAlarm();
      toast.error(`🚨 Restricted student detected: ${data.studentName}`, { duration: 8000 });
      setUnread(p => p + 1);
    });
    return () => {
      socket.off('new_registration');
      socket.off('attendance_marked');
      socket.off('notification_created', refreshUnreadCount);
      socket.off('restricted_student_detected');
    };
  }, [socket, refreshUnreadCount, playRestrictedAlarm]);

  useEffect(() => () => stopRestrictedAlarm(), [stopRestrictedAlarm]);

  useEffect(() => {
    const handleBusy = (event) => {
      setAppBusy(Boolean(event.detail?.active));
      setAppBusyLabel(event.detail?.label || '');
    };
    window.addEventListener('app:busy', handleBusy);
    return () => window.removeEventListener('app:busy', handleBusy);
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); toast.success('Logged out'); };
  const handleNavStart = (event) => {
    if (appBusy) {
      event?.preventDefault();
      toast('Please wait for the current process to finish or cancel it first.');
      return;
    }
    if (window.innerWidth < 768) setSidebarOpen(false);
    setAccountOpen(false);
    setRouteLoading(true);
    window.setTimeout(() => setRouteLoading(false), 450);
  };
  const openProfilePage = () => {
    setAccountOpen(false);
    if (window.innerWidth < 768) setSidebarOpen(false);
    navigate(isTeacher ? '/admin/profile' : '/admin');
  };

  const handleScopeSaved = (nextUser) => {
    updateUser(nextUser);
    sessionStorage.setItem('adminScopeSelected', nextUser._id);
    setScopeModalOpen(false);
    window.dispatchEvent(new Event('admin-scope:changed'));
  };

  return (
    <div className="app-shell h-dvh overflow-hidden flex bg-slate-950">
      <AppConfirmModal
        open={logoutOpen}
        title="Sign Out?"
        message="You will be signed out of the admin panel. Pending delete undo windows will remain available to admins until they expire."
        confirmLabel="Sign Out"
        tone="logout"
        onCancel={() => setLogoutOpen(false)}
        onConfirm={handleLogout}
      />
      {(mustChooseScope || scopeModalOpen) && (
        <AdminScopeModal
          user={user}
          onSaved={handleScopeSaved}
          onClose={() => setScopeModalOpen(false)}
          forced={mustChooseScope}
        />
      )}
      {sidebarOpen && <div className="fixed inset-0 bg-slate-950/70 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />}
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`app-sidebar w-[min(15rem,84vw)] md:w-64 flex-shrink-0 flex flex-col bg-slate-900/95 md:bg-slate-900/80 border-r border-white/5 fixed h-full z-20 transition-all duration-200 ${appBusy ? 'pointer-events-none select-none blur-[2px] opacity-45' : ''}`}
          >
            {/* Logo */}
            <div className="p-4 sm:p-5 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
                  <Scan className="w-5 h-5 text-primary-400" />
                </div>
                <div>
                  <span className="font-display font-bold text-white text-lg">StudySphere</span>
                  <p className="text-xs text-slate-500">Admin Workspace</p>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 min-h-0 p-3 sm:p-4 space-y-1 overflow-y-auto">
              {visibleNavItems.map(({ to, icon: Icon, label, end }) => (
                <NavLink key={to} to={to} end={end}
                  onClick={handleNavStart}
                  aria-disabled={appBusy}
                  aria-label={label}
                  title={label}
                  className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{label}</span>
                  {label === 'Notifications' && unreadLoading && (
                    <SkeletonLine className="ml-auto h-2.5 w-6 rounded-full" />
                  )}
                  {label === 'Notifications' && !unreadLoading && unread > 0 && (
                    <span className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]" aria-label="Unread notifications" />
                  )}
                </NavLink>
              ))}
            </nav>

            {/* User */}
            <div className="border-t border-white/5 p-2 md:p-3 md:pb-4">
              <button
                type="button"
                onClick={() => setAccountOpen(value => !value)}
                className="mb-2 flex w-full items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.07] md:px-2.5 md:py-2"
                aria-expanded={accountOpen}
                aria-label="Open account menu"
                title="Account"
              >
                <div className="grid h-7 w-7 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-primary-600/30 text-[11px] font-semibold text-primary-300 md:h-8 md:w-8 md:text-xs">
                  {user?.profileImage ? <img src={user.profileImage} alt="" className="h-full w-full object-cover" /> : user?.name?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-white md:text-xs">{user?.name}</p>
                  <p className="truncate text-[9px] text-slate-500 md:text-[10px]">
                    {isTeacher && user?.adminSemesterScope ? `Sem ${user.adminSemesterScope} Teacher` : isDepartmentAdmin ? `${user?.department || 'Department'} Admin` : 'Administrator'}
                  </p>
                </div>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence initial={false}>
                {accountOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="mb-2 overflow-hidden rounded-xl border border-white/5 bg-slate-950/45 p-1"
                  >
                    {isTeacher && (
                      <button
                        type="button"
                        onClick={openProfilePage}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <User className="h-3.5 w-3.5" /> Profile Page
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setAccountOpen(false); setLogoutOpen(true); }}
                      aria-label="Sign Out"
                      title="Sign Out"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    >
                      <LogOut className="h-3.5 w-3.5" /> Sign Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
              {isTeacher && (
                <button
                  onClick={() => setScopeModalOpen(true)}
                  aria-label="Switch Year / Semester"
                  title="Switch Year / Semester"
                  className="mb-2 flex w-full items-center justify-between gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-2 py-2.5 text-left text-primary-200 hover:bg-primary-500/15 transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <GraduationCap className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate text-sm">Switch Year / Semester</span>
                  </span>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                </button>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 ${sidebarOpen ? 'md:ml-64' : 'ml-0'} ${appBusy ? 'pointer-events-none select-none blur-[1.5px]' : ''}`}>
        {/* Top bar */}
        <header className="app-topbar h-14 sm:h-16 flex-shrink-0 bg-slate-900/60 border-b border-white/5 flex items-center justify-between px-3 sm:px-6 sticky top-0 z-10 backdrop-blur-xl">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} className="mobile-icon-btn rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            {isTeacher && (
              <button
                type="button"
                onClick={() => setScopeModalOpen(true)}
                className="hidden sm:flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:border-primary-400/40 hover:bg-primary-500/10 transition-colors"
                title="Switch year and semester"
              >
                <GraduationCap className="w-4 h-4 text-primary-300" />
                <span>{user?.adminAcademicYear ? `Year ${user.adminAcademicYear}` : 'Year'} · Sem {user?.adminSemesterScope || '-'}</span>
              </button>
            )}
            {isTeacher && (
              <button
                type="button"
                onClick={() => setScopeModalOpen(true)}
                className="sm:hidden mobile-icon-btn rounded-xl text-primary-300 hover:text-white hover:bg-primary-500/10 transition-colors flex items-center justify-center"
                title="Switch year and semester"
              >
                <GraduationCap className="w-5 h-5" />
              </button>
            )}
            <ThemeToggle />
            <NavLink to="/admin/notifications" onClick={handleNavStart} aria-disabled={appBusy} aria-label="Notifications" title="Notifications" className="mobile-icon-btn relative text-slate-400 hover:text-white hover:bg-white/10 transition-colors rounded-xl flex items-center justify-center">
              <Bell className="w-5 h-5" />
              {unreadLoading && <span className="skeleton-shimmer absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-slate-900" />}
              {!unreadLoading && unread > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-slate-900" />}
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
              <button onClick={stopRestrictedAlarm} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/15">
                Stop Beep
              </button>
              <button onClick={() => { stopRestrictedAlarm(); setAlert(null); }} className="text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="app-main flex-1 min-h-0 p-3 sm:p-6 pb-24 md:pb-6 overflow-y-auto overflow-x-hidden">
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

      {isSuperAdmin || isDepartmentAdmin || isTeacher ? <PendingDeletionTray /> : null}
      {routeLoading && (
        <div className="route-loading-overlay" role="status" aria-live="polite" aria-label="Loading page">
          <div className="route-loading-card">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        </div>
      )}
      {appBusy && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm" role="status" aria-live="polite" aria-label="Processing request">
          <div className="w-full max-w-sm rounded-2xl border border-primary-400/25 bg-slate-950/90 p-5 text-center shadow-2xl shadow-primary-950/40">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-300" />
            <p className="mt-3 text-sm font-semibold text-white">{appBusyLabel || 'Processing...'}</p>
            <p className="mt-1 text-xs text-slate-400">Please wait. Navigation is locked until this process completes.</p>
          </div>
        </div>
      )}

    </div>
  );
}
