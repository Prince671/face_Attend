import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { LayoutDashboard, BookOpen, ClipboardCheck, Bell, LogOut, Menu, X, Scan, CreditCard, CalendarDays, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { notificationAPI } from '../../services/api';
import ThemeToggle from '../../components/ThemeToggle';
import AppConfirmModal from '../../components/AppConfirmModal';

const navItems = [
  { to: '/student', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/student/subjects', icon: BookOpen, label: 'My Subjects' },
  { to: '/student/timetable', icon: CalendarDays, label: 'Timetable' },
  { to: '/student/mark-attendance', icon: ClipboardCheck, label: 'Mark Attendance' },
  { to: '/student/id-card', icon: CreditCard, label: 'ID Card' },
  { to: '/student/profile', icon: User, label: 'Profile' },
  { to: '/student/notifications', icon: Bell, label: 'Notifications' },
];

export default function StudentLayout() {
  const { user, logout } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [unread, setUnread] = useState(0);
  const [logoutOpen, setLogoutOpen] = useState(false);

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
      toast.success(`Account ${data.status === 'active' ? 'activated' : 'deactivated'}`);
    });

    return () => {
      socket.off('new_lecture');
      socket.off('attendance_opened');
      socket.off('account_status_changed');
    };
  }, [socket]);

  const handleLogout = () => { logout(); navigate('/login'); toast.success('Logged out'); };

  return (
    <div className="h-screen overflow-hidden flex bg-slate-950">
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
            className="w-[min(14.5rem,82vw)] md:w-60 flex-shrink-0 flex flex-col bg-slate-900/95 md:bg-slate-900/80 border-r border-white/5 fixed h-full z-20">
            <div className="p-4 sm:p-5 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
                  <Scan className="w-5 h-5 text-primary-400" />
                </div>
                <div>
                  <span className="font-display font-bold text-white">FaceAttend</span>
                  <p className="text-xs text-slate-500">Student Portal</p>
                </div>
              </div>
            </div>

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

            <div className="p-3 sm:p-4 border-t border-white/5 pb-24 md:pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-primary-600/30 flex items-center justify-center text-primary-300 font-semibold text-sm overflow-hidden">
                  {user?.profileImage ? <img src={user.profileImage} alt="" className="w-full h-full object-cover" /> : user?.name?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{user?.studentId}</p>
                </div>
              </div>
              <button onClick={() => setLogoutOpen(true)} className="flex items-center gap-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl text-sm w-full transition-colors px-2 py-2.5">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className={`flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 ${sidebarOpen ? 'md:ml-60' : 'ml-0'}`}>
        <header className="h-14 sm:h-16 flex-shrink-0 bg-slate-900/60 border-b border-white/5 flex items-center justify-between px-3 sm:px-6 sticky top-0 z-10 backdrop-blur-xl">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="mobile-icon-btn rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <NavLink to="/student/notifications" className="mobile-icon-btn relative text-slate-400 hover:text-white hover:bg-white/10 transition-colors rounded-xl flex items-center justify-center">
              <Bell className="w-5 h-5" />
              {unread > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-slate-900" />}
            </NavLink>
          </div>
        </header>
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

      <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/92 backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-7 gap-1 px-2 pt-2">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] transition-colors ${isActive ? 'bg-primary-600/20 text-primary-300' : 'text-slate-500 hover:text-white'}`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate max-w-full">{label.replace('Mark Attendance', 'Mark').replace('My Subjects', 'Subjects')}</span>
              {label === 'Notifications' && unread > 0 && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
