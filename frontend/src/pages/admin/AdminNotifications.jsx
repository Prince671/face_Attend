import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, CheckCheck, AlertTriangle, Info, CheckCircle, XCircle, Video, Users, Trash2, Loader2 } from 'lucide-react';
import { notificationAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import AppConfirmModal from '../../components/AppConfirmModal';

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
  general: 'text-blue-400 bg-blue-400/10',
};

function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  const fetchNotifs = () => {
    notificationAPI.getAll()
      .then(async (r) => {
        const items = r.data.notifications || [];
        if (items.some(n => !n.isRead)) {
          await notificationAPI.markAllRead();
          notifyUnreadChanged();
          setNotifications(items.map(n => ({ ...n, isRead: true })));
          return;
        }
        setNotifications(items);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchNotifs(); }, []);

  const markRead = async (id) => {
    await notificationAPI.markRead(id);
    setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    notifyUnreadChanged();
  };

  const markAllRead = async () => {
    await notificationAPI.markAllRead();
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
      await notificationAPI.deleteOne(id);
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
      await notificationAPI.deleteAll();
      setNotifications([]);
      setSelectedIds(new Set());
      notifyUnreadChanged();
    } finally {
      setDeletingAll(false);
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
            {unread > 0 && <span className="badge-warning ml-1">{unread} new</span>}
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

      <AdminBreadcrumb items={[{ label: 'Administration' }, { label: 'Notifications' }]} />

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n, i) => {
            const Icon = typeIcon[n.type] || Info;
            const color = typeColor[n.type] || 'text-slate-400 bg-slate-400/10';
            const isDeleting = deletingIds.has(n._id) || deletingAll;
            return (
              <motion.div key={n._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                onClick={() => !n.isRead && markRead(n._id)}
                className={`glass-card cursor-pointer transition-all hover:border-white/10 border ${n.isRead ? 'border-transparent opacity-70' : 'border-primary-500/20'} ${isDeleting ? 'pointer-events-none opacity-50' : ''}`}>
                <div className="flex items-start gap-3 sm:gap-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(n._id)}
                    disabled={isDeleting}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(n._id)}
                    className="mt-3 h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                    aria-label={`Select ${n.title}`}
                  />
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white text-sm">{n.title}</p>
                      {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />}
                      {n.priority === 'critical' && <span className="badge-danger text-xs">CRITICAL</span>}
                    </div>
                    <p className="text-slate-400 text-sm mt-0.5">{n.message}</p>
                    <p className="text-slate-600 text-xs mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteOne(n._id); }}
                    disabled={isDeleting}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:cursor-wait"
                    aria-label={`Delete ${n.title}`}
                  >
                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default NotificationsPage;
