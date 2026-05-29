import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, CheckCheck, AlertTriangle, Info, CheckCircle, XCircle, Video, Users, Trash2, Loader2, Bookmark, BookmarkCheck, CalendarDays } from 'lucide-react';
import {
  useDeleteAllNotificationsMutation,
  useDeleteNotificationMutation,
  useGetNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useSetNotificationAutoDeleteProtectionMutation
} from '../../services/apiSlice';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import AppConfirmModal from '../../components/AppConfirmModal';
import { CardSkeleton } from '../../components/LoadingStates';

const notifyUnreadChanged = () => window.dispatchEvent(new Event('notifications:changed'));

const typeIcon = {
  registration_request: Users,
  account_approved: CheckCircle,
  account_rejected: XCircle,
  account_deactivated: XCircle,
  account_restricted: AlertTriangle,
  unwanted_student_detected: AlertTriangle,
  attendance_opened: Video,
  attendance_marked: CheckCircle,
  attendance_closed: Video,
  lecture_created: Video,
  lecture_reminder: Video,
  teacher_assignment: CheckCircle,
  subject_classes_stopped: AlertTriangle,
  subject_classes_resumed: CheckCircle,
  low_attendance_alert: AlertTriangle,
  attendance_dispute_created: AlertTriangle,
  attendance_dispute_resolved: CheckCircle,
  academic_calendar: CalendarDays,
  general: Info,
};
const typeColor = {
  registration_request: 'text-amber-400 bg-amber-400/10',
  account_approved: 'text-emerald-400 bg-emerald-400/10',
  account_rejected: 'text-red-400 bg-red-400/10',
  account_deactivated: 'text-red-400 bg-red-400/10',
  account_restricted: 'text-red-400 bg-red-400/10',
  unwanted_student_detected: 'text-red-400 bg-red-400/10',
  attendance_opened: 'text-primary-400 bg-primary-400/10',
  attendance_marked: 'text-emerald-400 bg-emerald-400/10',
  attendance_closed: 'text-slate-400 bg-slate-400/10',
  lecture_created: 'text-primary-400 bg-primary-400/10',
  lecture_reminder: 'text-cyan-400 bg-cyan-400/10',
  teacher_assignment: 'text-emerald-400 bg-emerald-400/10',
  subject_classes_stopped: 'text-amber-400 bg-amber-400/10',
  subject_classes_resumed: 'text-emerald-400 bg-emerald-400/10',
  low_attendance_alert: 'text-red-400 bg-red-400/10',
  attendance_dispute_created: 'text-amber-400 bg-amber-400/10',
  attendance_dispute_resolved: 'text-emerald-400 bg-emerald-400/10',
  academic_calendar: 'text-amber-400 bg-amber-400/10',
  general: 'text-blue-400 bg-blue-400/10',
};

export default function StudentNotifications() {
  const { data, isLoading: loading } = useGetNotificationsQuery(undefined, { refetchOnReconnect: true });
  const [markReadRequest] = useMarkNotificationReadMutation();
  const [markAllReadRequest] = useMarkAllNotificationsReadMutation();
  const [deleteNotificationRequest] = useDeleteNotificationMutation();
  const [deleteAllNotificationsRequest] = useDeleteAllNotificationsMutation();
  const [setAutoDeleteProtectionRequest] = useSetNotificationAutoDeleteProtectionMutation();
  const [notifications, setNotifications] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [preservingIds, setPreservingIds] = useState(new Set());

  useEffect(() => {
    const items = data?.notifications || [];
    if (!items.length) {
      setNotifications([]);
      return;
    }
    if (items.some(n => !n.isRead)) {
      markAllReadRequest().then(() => notifyUnreadChanged());
      setNotifications(items.map(n => ({ ...n, isRead: true })));
      return;
    }
    setNotifications(items);
  }, [data, markAllReadRequest]);

  const markRead = async (id) => {
    await markReadRequest(id).unwrap();
    setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    notifyUnreadChanged();
  };

  const markAllRead = async () => {
    await markAllReadRequest().unwrap();
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    notifyUnreadChanged();
  };

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteOne = async (id) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await deleteNotificationRequest(id).unwrap();
      setNotifications(prev => prev.filter(n => n._id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      notifyUnreadChanged();
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setDeletingSelected(true);
    setDeletingIds(prev => new Set([...prev, ...ids]));
    try {
      await Promise.all(ids.map(id => notificationAPI.deleteOne(id)));
      setNotifications(prev => prev.filter(n => !selectedIds.has(n._id)));
      setSelectedIds(new Set());
      notifyUnreadChanged();
    } finally {
      setDeletingSelected(false);
      setDeletingIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const deleteAll = async () => {
    setDeletingAll(true);
    try {
      await deleteAllNotificationsRequest().unwrap();
      setNotifications([]);
      setSelectedIds(new Set());
      notifyUnreadChanged();
    } finally {
      setDeletingAll(false);
    }
  };

  const toggleAutoDeleteProtection = async (notification) => {
    setPreservingIds(prev => new Set(prev).add(notification._id));
    try {
      const preserve = !notification.autoDeleteProtected;
      const res = await setAutoDeleteProtectionRequest({ id: notification._id, preserve }).unwrap();
      setNotifications(prev => prev.map(item => item._id === notification._id ? { ...item, ...res.notification } : item));
    } finally {
      setPreservingIds(prev => {
        const next = new Set(prev);
        next.delete(notification._id);
        return next;
      });
    }
  };

  const unread = notifications.filter(n => !n.isRead).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <AppConfirmModal
        open={deleteAllOpen}
        title="Delete All Notifications?"
        message="This will remove all visible notifications from your inbox."
        confirmLabel="Delete All"
        loading={deletingAll}
        onCancel={() => setDeleteAllOpen(false)}
        onConfirm={async () => {
          await deleteAll();
          setDeleteAllOpen(false);
        }}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2 flex-wrap">
            <Bell className="w-6 h-6 text-primary-400" /> Notifications
            {unread > 0 && <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]" aria-label="Unread notifications" />}
          </h1>
          <p className="text-slate-400 mt-1">Your latest updates and alerts</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <button onClick={deleteSelected} disabled={deletingSelected || deletingAll} className="btn-secondary mobile-icon-btn sm:w-auto flex items-center gap-2 py-2 px-4 text-sm text-red-300 hover:text-red-200 disabled:opacity-60 disabled:cursor-not-allowed" title="Delete selected">
              {deletingSelected ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              <span className="mobile-label">{deletingSelected ? 'Deleting...' : 'Delete selected'}</span>
            </button>
          )}
          {notifications.length > 0 && (
            <button onClick={() => setDeleteAllOpen(true)} disabled={deletingAll || deletingSelected} className="btn-secondary mobile-icon-btn sm:w-auto flex items-center gap-2 py-2 px-4 text-sm disabled:opacity-60 disabled:cursor-not-allowed" title="Delete all">
              {deletingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              <span className="mobile-label">{deletingAll ? 'Deleting...' : 'Delete all'}</span>
            </button>
          )}
          {unread > 0 && (
            <button onClick={markAllRead} className="btn-secondary mobile-icon-btn sm:w-auto flex items-center gap-2 py-2 px-4 text-sm" title="Mark all read">
              <CheckCheck className="w-4 h-4" /> <span className="mobile-label">Mark all read</span>
            </button>
          )}
        </div>
      </div>

      <AdminBreadcrumb items={[{ label: 'StudySphere' }, { label: 'Notifications' }]} />

      <div className="rounded-2xl border border-primary-400/20 bg-primary-500/10 px-3 py-2.5 text-xs leading-5 text-primary-100 sm:px-4 sm:py-3 sm:text-sm">
          Notifications are automatically cleared 24 hours after arrival. Use the bookmark icon to preserve important alerts in your inbox.
      </div>

      {loading ? (
        <CardSkeleton rows={6} />
      ) : notifications.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="notification-list">
          {notifications.map((n, i) => {
            const Icon = typeIcon[n.type] || Info;
            const color = typeColor[n.type] || 'text-slate-400 bg-slate-400/10';
            const isDeleting = deletingIds.has(n._id) || deletingAll;
            return (
              <motion.div key={n._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                onClick={() => !n.isRead && markRead(n._id)}
                className={`notification-card glass-card compact-card cursor-pointer transition-all hover:border-white/10 border ${n.isRead ? 'border-transparent opacity-70' : 'border-primary-500/20'} ${isDeleting ? 'pointer-events-none opacity-50' : ''}`}>
                <div className="notification-row flex items-start gap-3 sm:gap-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(n._id)}
                    disabled={isDeleting}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(n._id)}
                    className="mt-3 h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                    aria-label={`Select ${n.title}`}
                  />
                  <div className={`notification-icon w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div className="notification-body flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <p className="notification-title font-medium text-white">{n.title}</p>
                      {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />}
                      {n.priority === 'critical' && <span className="badge-danger text-xs">CRITICAL</span>}
                      {n.autoDeleteProtected && <span className="badge-info text-xs">Saved</span>}
                    </div>
                    <p className="notification-message text-slate-400 mt-0.5">{n.message}</p>
                    <p className="text-slate-600 text-xs mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="notification-actions">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleAutoDeleteProtection(n); }}
                    disabled={isDeleting || preservingIds.has(n._id)}
                    className={`p-2 rounded-lg transition-colors disabled:cursor-wait ${n.autoDeleteProtected ? 'text-primary-300 bg-primary-500/10 hover:text-primary-200' : 'text-slate-500 hover:text-primary-300 hover:bg-primary-500/10'}`}
                    aria-label={n.autoDeleteProtected ? `Allow auto delete for ${n.title}` : `Preserve ${n.title}`}
                    title={n.autoDeleteProtected ? 'Allow auto delete' : 'Preserve from auto-delete'}
                  >
                    {preservingIds.has(n._id) ? <Loader2 className="w-4 h-4 animate-spin" /> : n.autoDeleteProtected ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteOne(n._id); }}
                    disabled={isDeleting}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:cursor-wait"
                    aria-label={`Delete ${n.title}`}
                  >
                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
