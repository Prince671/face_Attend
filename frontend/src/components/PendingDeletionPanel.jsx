import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Clock, RotateCcw, Trash2, Users } from 'lucide-react';
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

  const displayItems = useMemo(() => {
    const batches = new Map();
    const singles = [];
    const legacyStudentGroups = new Map();

    items.forEach((item) => {
      if (!item.batchId) {
        if (item.resourceType === 'student') {
          const requester = item.requestedBy?._id || item.requestedBy || 'unknown';
          const expiryBucket = Math.floor(new Date(item.expiresAt).getTime() / 60000);
          const key = `${item.targetDepartment || 'all'}-${requester}-${expiryBucket}`;
          if (!legacyStudentGroups.has(key)) legacyStudentGroups.set(key, []);
          legacyStudentGroups.get(key).push(item);
          return;
        }
        singles.push({ type: 'single', item });
        return;
      }
      const existing = batches.get(item.batchId);
      if (existing) {
        existing.items.push(item);
        if (new Date(item.expiresAt).getTime() < new Date(existing.expiresAt).getTime()) {
          existing.expiresAt = item.expiresAt;
        }
      } else {
        batches.set(item.batchId, {
          type: 'batch',
          batchId: item.batchId,
          batchName: item.batchName || 'Bulk student delete',
          expiresAt: item.expiresAt,
          items: [item]
        });
      }
    });

    legacyStudentGroups.forEach((group) => {
      if (group.length >= 5) {
        const first = group[0];
        batches.set(`legacy-${first._id}`, {
          type: 'batch',
          legacy: true,
          batchId: `legacy-${first._id}`,
          batchName: `${group.length} ${first.targetDepartment || ''} students`.trim(),
          expiresAt: group.reduce((min, item) => (
            new Date(item.expiresAt).getTime() < new Date(min).getTime() ? item.expiresAt : min
          ), first.expiresAt),
          items: group
        });
      } else {
        group.forEach(item => singles.push({ type: 'single', item }));
      }
    });

    return [...batches.values(), ...singles]
      .sort((a, b) => new Date(a.expiresAt || a.item.expiresAt) - new Date(b.expiresAt || b.item.expiresAt));
  }, [items]);

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

  const undoBatch = async (batch) => {
    setLoadingId(batch.batchId);
    try {
      if (batch.legacy) {
        await Promise.all(batch.items.map(item => deletionAPI.undo(item._id)));
        toast.success(`${batch.items.length} students restored`);
      } else {
        const res = await deletionAPI.undoBatch(batch.batchId);
        toast.success(res.data.message || `${batch.items.length} students restored`);
      }
      await load();
      window.dispatchEvent(new Event('pending-deletions:changed'));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Undo all failed');
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
        {displayItems.map(entry => {
          if (entry.type === 'batch') {
            return (
              <div key={entry.batchId} className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-200">
                    <Users className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">Delete All Students</p>
                    <p className="text-xs text-amber-100/80 truncate">{entry.batchName}</p>
                    <p className="text-xs text-slate-400 mt-1">{entry.items.length} student deletes grouped into one undo request.</p>
                    <p className="text-xs text-amber-300 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {remaining(entry.expiresAt)} left
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => undoBatch(entry)} disabled={loadingId === entry.batchId} className="btn-primary py-2 px-3 text-sm inline-flex items-center justify-center gap-2">
                  <RotateCcw className="w-4 h-4" /> {loadingId === entry.batchId ? 'Restoring...' : 'Undo All'}
                </button>
              </div>
            );
          }

          const { item } = entry;
          return (
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
          );
        })}
      </div>
    </section>
  );
}
