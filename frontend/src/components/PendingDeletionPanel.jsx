import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Clock, RotateCcw, Trash2 } from 'lucide-react';
import { deletionAPI } from '../services/api';

const remaining = (expiresAt) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expiring now';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export default function PendingDeletionPanel() {
  const [items, setItems] = useState([]);
  const [loadingId, setLoadingId] = useState('');
  const [, tick] = useState(0);

  const load = async () => {
    try {
      const res = await deletionAPI.getPending();
      setItems((res.data.deletions || []).filter(item => new Date(item.expiresAt).getTime() > Date.now()));
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    load();
    window.addEventListener('pending-deletions:changed', load);
    return () => window.removeEventListener('pending-deletions:changed', load);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => tick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (items.length === 0) return null;

  const undo = async (item) => {
    setLoadingId(item._id);
    try {
      await deletionAPI.undo(item._id);
      toast.success(`${item.resourceName} restored`);
      await load();
      window.dispatchEvent(new Event('pending-deletions:changed'));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Undo failed');
    } finally {
      setLoadingId('');
    }
  };

  return (
    <section className="glass-card border border-amber-500/30">
      <h2 className="font-semibold text-white flex items-center gap-2">
        <Trash2 className="w-5 h-5 text-amber-300" /> Pending Delete Undo
      </h2>
      <p className="text-sm text-slate-400 mt-1">These items are hidden now but can still be restored before the timer expires.</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
        {items.map(item => (
          <div key={item._id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-white font-medium truncate">{item.resourceName}</p>
              <p className="text-xs text-slate-500 capitalize">{item.resourceType}</p>
              <p className="text-xs text-amber-300 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {remaining(item.expiresAt)} left
              </p>
            </div>
            <button type="button" onClick={() => undo(item)} disabled={loadingId === item._id} className="btn-primary py-2 px-3 text-sm inline-flex items-center justify-center gap-2">
              <RotateCcw className="w-4 h-4" /> {loadingId === item._id ? 'Restoring...' : 'Undo'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
