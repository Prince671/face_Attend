import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronUp, Clock, RotateCcw, Trash2 } from 'lucide-react';
import { deletionAPI } from '../services/api';

const formatRemaining = (expiresAt) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expiring now';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export default function PendingDeletionTray({ refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [loadingId, setLoadingId] = useState('');
  const [minimized, setMinimized] = useState(() => localStorage.getItem('pendingDeletionTrayMinimized') === 'true');
  const [, tick] = useState(0);

  const loadPending = async () => {
    try {
      const res = await deletionAPI.getPending();
      setItems(res.data.deletions || []);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    loadPending();
    window.addEventListener('pending-deletions:changed', loadPending);
    return () => window.removeEventListener('pending-deletions:changed', loadPending);
  }, [refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => tick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(loadPending, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('pendingDeletionTrayMinimized', minimized ? 'true' : 'false');
  }, [minimized]);

  const activeItems = useMemo(
    () => items.filter(item => new Date(item.expiresAt).getTime() > Date.now()),
    [items]
  );

  if (activeItems.length === 0) return null;

  const undo = async (item) => {
    setLoadingId(item._id);
    try {
      await deletionAPI.undo(item._id);
      toast.success(`${item.resourceName} restored`);
      await loadPending();
      window.dispatchEvent(new Event('pending-deletions:changed'));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Undo failed');
    } finally {
      setLoadingId('');
    }
  };

  return (
    <div className="fixed bottom-20 md:bottom-5 right-3 sm:right-5 z-[70] w-[calc(100vw-1.5rem)] max-w-md">
      <div className="glass-card border border-amber-500/30 shadow-2xl p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setMinimized(value => !value)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
        >
          <span className="flex items-center gap-2 text-white font-semibold">
            <Trash2 className="w-4 h-4 text-amber-300" />
            Pending Deletes
            <span className="badge badge-warning">{activeItems.length}</span>
          </span>
          {minimized ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {!minimized && (
          <div className="border-t border-white/10 p-3 space-y-2 max-h-80 overflow-y-auto">
            {activeItems.map(item => (
              <div key={item._id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{item.resourceName}</p>
                    <p className="text-xs text-slate-500 capitalize">{item.resourceType} delete scheduled</p>
                    <p className="text-xs text-amber-300 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Undo available for {formatRemaining(item.expiresAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => undo(item)}
                    disabled={loadingId === item._id}
                    className="btn-primary py-2 px-3 text-sm inline-flex items-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {loadingId === item._id ? 'Restoring...' : 'Undo'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
