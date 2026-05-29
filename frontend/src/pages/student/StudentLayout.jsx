import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { LayoutDashboard, BookOpen, ClipboardCheck, Bell, LogOut, Menu, X, Scan, CreditCard, CalendarDays, User, Loader2, MessagesSquare, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { notificationAPI } from '../../services/api';
import ThemeToggle from '../../components/ThemeToggle';
import AppConfirmModal from '../../components/AppConfirmModal';
import useMobileHoldTitle from '../../hooks/useMobileHoldTitle';
import { SkeletonLine } from '../../components/LoadingStates';

const navItems = [
  { to: '/student', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/student/subjects', icon: BookOpen, label: 'My Subjects' },
  { to: '/student/rooms', icon: MessagesSquare, label: 'Rooms' },
  { to: '/student/timetable', icon: CalendarDays, label: 'Timetable' },
  { to: '/student/mark-attendance', icon: ClipboardCheck, label: 'Mark Attendance' },
  { to: '/student/id-card', icon: CreditCard, label: 'ID Card' },
  { to: '/student/notifications', icon: Bell, label: 'Notifications' },
];

export default function StudentLayout() {
  useMobileHoldTitle();
  const { user, logout, updateUser } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [unread, setUnread] = useState(0);
  const [unreadLoading, setUnreadLoading] = useState(true);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [appBusy, setAppBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const roomsUnreadKey = `studysphere_rooms_unread_${user?._id || 'guest'}`;
  const [roomsUnread, setRoomsUnread] = useState(() => localStorage.getItem(`studysphere_rooms_unread_${user?._id || 'guest'}`) === 'true');

  const setRoomsUnreadState = useCallback((value) => {
    setRoomsUnread(value);
    localStorage.setItem(roomsUnreadKey, value ? 'true' : 'false');
  }, [roomsUnreadKey]);

  const refreshUnreadCount = useCallback(() => {
    setUnreadLoading(true);
    notificationAPI.getUnreadCount()
      .then(r => setUnread(r.data.count || 0))
      .catch(() => {})
      .finally(() => setUnreadLoading(false));
  }, []);

  useEffect(() => {
    refreshUnreadCount();
    window.addEventListener('notifications:changed', refreshUnreadCount);
    return () => window.removeEventListener('notifications:changed', refreshUnreadCount);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!socket) return;

    // FIX: Also handle new_lecture event to bump notification badge
    socket.on('new_lecture', (data) => {
      toast(`New lecture: ${data.lecture?.title || 'New Lecture Scheduled'}`, { icon: '📚', duration: 6000 });
      setUnread(p => p + 1);
    });

    socket.on('attendance_opened', (data) => {
      toast(`Attendance open: ${data.subjectName}. Ask your admin for the code in class.`, { duration: 8000 });
      setUnread(p => p + 1);
    });

    socket.on('account_status_changed', (data) => {
      if (user) updateUser({ ...user, ...data });
      if (data.isRestricted || data.status === 'restricted') {
        toast.error('Your profile is restricted. Attendance marking is disabled.');
      } else {
        toast.success(`Account ${data.status === 'active' ? 'activated' : 'deactivated'}`);
      }
    });
    socket.on('notification_created', refreshUnreadCount);
    socket.on('chat_message_created', () => {
      if (!location.pathname.startsWith('/student/rooms')) setRoomsUnreadState(true);
    });

    return () => {
      socket.off('new_lecture');
      socket.off('attendance_opened');
      socket.off('account_status_changed');
      socket.off('notification_created', refreshUnreadCount);
      socket.off('chat_message_created');
    };
  }, [socket, refreshUnreadCount, updateUser, user, location.pathname, setRoomsUnreadState]);

  useEffect(() => {
    setRoomsUnread(localStorage.getItem(roomsUnreadKey) === 'true');
  }, [roomsUnreadKey]);

  useEffect(() => {
    if (location.pathname.startsWith('/student/rooms')) setRoomsUnreadState(false);
  }, [location.pathname, setRoomsUnreadState]);

  useEffect(() => {
    const handleBusy = (event) => setAppBusy(Boolean(event.detail?.active));
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
    const nextPath = event?.currentTarget?.getAttribute?.('href') || '';
    if (nextPath.includes('/student/rooms')) setRoomsUnreadState(false);
    setRouteLoading(true);
    window.setTimeout(() => setRouteLoading(false), 450);
  };
  const openProfilePage = () => {
    setAccountOpen(false);
    if (window.innerWidth < 768) setSidebarOpen(false);
    navigate('/student/profile');
  };

  return (
    <div className="app-shell h-dvh overflow-hidden flex bg-slate-950">
      <AppConfirmModal
        open={logoutOpen}
        title="Sign Out?"
        message="You will be signed out of the student portal."
        confirmLabel="Sign Out"
        tone="logout"
        onCancel={() => setLogoutOpen(false)}
        onConfirm={handleLogout}
      />
      {sidebarOpen && <div className="fixed inset-0 bg-slate-950/70 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="app-sidebar w-[min(14.5rem,82vw)] md:w-60 flex-shrink-0 flex flex-col bg-slate-900/95 md:bg-slate-900/80 border-r border-white/5 fixed h-full z-20">
            <div className="p-3 sm:p-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
                  <Scan className="w-4 h-4 text-primary-400" />
                </div>
                <div className="min-w-0">
                  <span className="block truncate font-display text-sm font-bold text-white">StudySphere</span>
                  <p className="truncate text-[11px] text-slate-500">Student Workspace</p>
                </div>
              </div>
            </div>

            <nav className="flex-1 min-h-0 p-3 sm:p-4 space-y-1 overflow-y-auto">
              {navItems.map(({ to, icon: Icon, label, end }) => (
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
                  {label === 'Rooms' && roomsUnread && (
                    <span className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]" aria-label="New room message" />
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="border-t border-white/5 p-2 md:p-2.5 md:pb-3">
              <button
                type="button"
                onClick={() => setAccountOpen(value => !value)}
                className="flex w-full items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.07] md:px-2.5 md:py-2"
                aria-expanded={accountOpen}
                aria-label="Open account menu"
                title="Account"
              >
                <div className="grid h-7 w-7 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-primary-600/30 text-[11px] font-semibold text-primary-300 md:h-8 md:w-8 md:text-xs">
                  {user?.profileImage ? <img src={user.profileImage} alt="" className="h-full w-full object-cover" /> : user?.name?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-white md:text-xs">{user?.name}</p>
                  <p className="truncate font-mono text-[9px] text-slate-500 md:text-[10px]">{user?.studentId}</p>
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
                    className="mt-2 overflow-hidden rounded-xl border border-white/5 bg-slate-950/45 p-1"
                  >
                    <button
                      type="button"
                      onClick={openProfilePage}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <User className="h-3.5 w-3.5" /> Profile Page
                    </button>
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
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className={`flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 ${sidebarOpen ? 'md:ml-60' : 'ml-0'}`}>
        <header className="app-topbar h-14 sm:h-16 flex-shrink-0 bg-slate-900/60 border-b border-white/5 flex items-center justify-between px-3 sm:px-6 sticky top-0 z-10 backdrop-blur-xl">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} className="mobile-icon-btn rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <NavLink to="/student/notifications" onClick={handleNavStart} aria-disabled={appBusy} aria-label="Notifications" title="Notifications" className="mobile-icon-btn relative text-slate-400 hover:text-white hover:bg-white/10 transition-colors rounded-xl flex items-center justify-center">
              <Bell className="w-5 h-5" />
              {unreadLoading && <span className="skeleton-shimmer absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-slate-900" />}
              {!unreadLoading && unread > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-slate-900" />}
            </NavLink>
          </div>
        </header>
        <main className="app-main flex-1 min-h-0 p-3 sm:p-6 overflow-y-auto overflow-x-hidden">
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

      <nav className="mobile-bottom-nav hidden">
        <div className="grid grid-cols-7 gap-1 px-2 pt-2">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={handleNavStart}
              aria-disabled={appBusy}
              aria-label={label}
              title={label}
              className={({ isActive }) => `relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] transition-colors ${isActive ? 'bg-primary-600/20 text-primary-300' : 'text-slate-500 hover:text-white'}`}
            >
              <Icon className="h-5 w-5" />
              <span className="sr-only">{label}</span>
              {label === 'Notifications' && unreadLoading && <span className="skeleton-shimmer absolute right-3 top-1 h-2 w-2 rounded-full" />}
              {label === 'Notifications' && !unreadLoading && unread > 0 && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-red-500" />}
              {label === 'Rooms' && roomsUnread && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </NavLink>
          ))}
        </div>
      </nav>
      {routeLoading && (
        <div className="route-loading-overlay" role="status" aria-live="polite" aria-label="Loading page">
          <div className="route-loading-card">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        </div>
      )}
    </div>
  );
}
