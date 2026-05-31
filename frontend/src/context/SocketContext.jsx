import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const REALTIME_EVENTS = [
  'new_registration',
  'student_profile_changed',
  'student_profile_update_requested',
  'profile_update_resolved',
  'account_status_changed',
  'teacher_changed',
  'academic_structure_changed',
  'subject_updated',
  'new_lecture',
  'lecture_updated',
  'lectures_changed',
  'attendance_opened',
  'attendance_closed',
  'attendance_updated',
  'attendance_marked',
  'pending_deletions_changed',
  'timetable_changed',
  'holiday_changed',
  'lms_changed',
  'notification_created',
  'audit_logs_changed',
  'restricted_student_detected',
  'chat_group_created',
  'chat_group_updated',
  'chat_group_deleted',
  'chat_member_added',
  'chat_member_removed',
  'chat_member_left',
  'chat_message_created',
  'chat_message_updated',
  'chat_message_deleted',
  'chat_reaction_updated',
  'chat_mention',
  'chat_activity_created',
];

const eventDomains = {
  new_registration: ['students', 'dashboard'],
  student_profile_changed: ['students', 'subjects', 'attendance', 'analytics', 'dashboard'],
  student_profile_update_requested: ['students', 'dashboard'],
  profile_update_resolved: ['profile', 'notifications'],
  account_status_changed: ['profile', 'dashboard'],
  teacher_changed: ['teachers', 'subjects', 'dashboard'],
  academic_structure_changed: ['academic', 'subjects', 'teachers'],
  subject_updated: ['subjects', 'attendance', 'lectures', 'dashboard'],
  new_lecture: ['lectures', 'attendance', 'dashboard', 'timetable'],
  lecture_updated: ['lectures', 'attendance', 'dashboard'],
  lectures_changed: ['lectures', 'attendance', 'dashboard', 'timetable'],
  attendance_opened: ['attendance', 'lectures', 'dashboard'],
  attendance_closed: ['attendance', 'lectures', 'dashboard'],
  attendance_updated: ['attendance', 'lectures', 'analytics', 'dashboard'],
  attendance_marked: ['attendance', 'lectures', 'analytics', 'dashboard'],
  pending_deletions_changed: ['pending-deletions', 'students', 'teachers', 'subjects', 'lectures'],
  timetable_changed: ['timetable', 'lectures', 'dashboard'],
  holiday_changed: ['timetable', 'lectures', 'dashboard', 'notifications'],
  lms_changed: ['lms', 'subjects', 'dashboard'],
  notification_created: ['notifications', 'dashboard'],
  audit_logs_changed: ['audit'],
  restricted_student_detected: ['attendance', 'students', 'dashboard', 'notifications'],
  chat_group_created: ['chat'],
  chat_group_updated: ['chat'],
  chat_group_deleted: ['chat'],
  chat_member_added: ['chat'],
  chat_member_removed: ['chat'],
  chat_member_left: ['chat'],
  chat_message_created: ['chat', 'notifications'],
  chat_message_updated: ['chat'],
  chat_message_deleted: ['chat'],
  chat_reaction_updated: ['chat'],
  chat_mention: ['chat', 'notifications'],
  chat_activity_created: ['chat'],
};

const SocketContext = createContext({ socket: null, realtimeEvent: null, realtimeVersion: 0 });

const getSocketTransports = () => {
  const configured = String(import.meta.env.VITE_SOCKET_TRANSPORTS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  if (configured.length) return configured;
  if (/onrender\.com/i.test(String(import.meta.env.VITE_SOCKET_URL || ''))) return ['polling'];
  if (String(import.meta.env.VITE_SOCKET_POLLING_ONLY || '').toLowerCase() === 'true') return ['polling'];
  return ['polling', 'websocket'];
};

const shouldUpgradeSocket = () => {
  if (String(import.meta.env.VITE_SOCKET_DISABLE_UPGRADE || '').toLowerCase() === 'true') return false;
  if (/onrender\.com/i.test(String(import.meta.env.VITE_SOCKET_URL || ''))) return false;
  return getSocketTransports().includes('websocket');
};

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [realtimeEvent, setRealtimeEvent] = useState(null);
  const [realtimeVersion, setRealtimeVersion] = useState(0);

  useEffect(() => {
    // Don't connect until we actually have a user with an _id
    if (!user || !user._id) {
      // If socket exists from a previous session, disconnect it
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setRealtimeEvent(null);
        setRealtimeVersion(0);
      }
      return;
    }

    // Don't re-connect if socket already exists for this user
    if (socketRef.current && socketRef.current.connected) return;
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
    }

    const transports = getSocketTransports();
    const s = io(import.meta.env.VITE_SOCKET_URL || '/', {
      auth: { token: localStorage.getItem('token') },
      withCredentials: true,
      transports,
      upgrade: shouldUpgradeSocket(),
      timeout: 20000,
      pingTimeout: 30000,
      pingInterval: 25000,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    s.on('connect_error', (error) => {
      if (error?.message === 'Socket authentication failed' || error?.message === 'Socket authentication required') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.assign('/login');
      }
    });

    const joinRoom = () => {
      if (user.role === 'admin') {
        s.emit('join_admin', user.department);
        s.emit('join_user', user._id);
      } else if (user.role === 'teacher') {
        if (user.department) s.emit('join_admin', user.department);
        s.emit('join_user', user._id);
      } else {
        s.emit('join_student', user._id);
        s.emit('join_user', user._id);
      }
    };

    const announceRealtimeReconnect = () => {
      const event = {
        name: 'socket_reconnected',
        payload: {},
        domains: ['dashboard', 'students', 'teachers', 'subjects', 'lectures', 'attendance', 'timetable', 'lms', 'notifications', 'chat'],
        at: Date.now(),
      };
      setRealtimeEvent(event);
      setRealtimeVersion(value => value + 1);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app:realtime-change', { detail: event }));
        window.dispatchEvent(new CustomEvent('studysphere:data-refresh'));
      }
    };

    s.on('connect', () => {
      joinRoom();
    });

    // Re-join on every reconnect (network drop recovery)
    const handleReconnect = () => {
      joinRoom();
      announceRealtimeReconnect();
    };
    s.on('reconnect', handleReconnect);
    s.io.on('reconnect', handleReconnect);

    // If already connected (e.g. hot-reload), join immediately
    if (s.connected) joinRoom();

    const forwardRealtimeEvent = (eventName, payload = {}) => {
      if (!REALTIME_EVENTS.includes(eventName)) return;
      const event = {
        name: eventName,
        payload,
        domains: eventDomains[eventName] || [],
        at: Date.now(),
      };
      setRealtimeEvent(event);
      setRealtimeVersion(value => value + 1);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app:realtime-change', { detail: event }));
      }
    };

    s.onAny(forwardRealtimeEvent);

    socketRef.current = s;
    setSocket(s);

    return () => {
      s.off('connect');
      s.off('reconnect', handleReconnect);
      s.io.off('reconnect', handleReconnect);
      s.off('connect_error');
      s.offAny(forwardRealtimeEvent);
      if (s.connected) s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [user?._id, user?.role, user?.department]); // Re-run only when user identity or alert scope changes

  const value = useMemo(() => ({ socket, realtimeEvent, realtimeVersion }), [socket, realtimeEvent, realtimeVersion]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);

export const useRealtimeRefresh = (refresh, targets = [], deps = []) => {
  const { realtimeEvent, realtimeVersion } = useSocket();
  const refreshRef = useRef(refresh);
  const targetsRef = useRef(targets);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  const matches = useCallback((event) => {
    if (!event) return false;
    const wanted = targetsRef.current || [];
    if (!wanted.length) return true;
    return wanted.some(item => event.name === item || event.domains?.includes(item));
  }, []);

  useEffect(() => {
    if (!realtimeEvent || !matches(realtimeEvent)) return undefined;
    const timer = window.setTimeout(() => refreshRef.current?.(realtimeEvent), 120);
    return () => window.clearTimeout(timer);
  }, [realtimeVersion, realtimeEvent, matches, ...deps]);

  useEffect(() => {
    const handleRefresh = () => refreshRef.current?.({ name: 'data-refresh', domains: targetsRef.current || [] });
    window.addEventListener('studysphere:data-refresh', handleRefresh);
    return () => window.removeEventListener('studysphere:data-refresh', handleRefresh);
  }, [...deps]);
};
