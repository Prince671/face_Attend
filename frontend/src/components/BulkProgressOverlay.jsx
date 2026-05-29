import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function BulkProgressOverlay({ open, title, progress = 0, message, onCancel }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress || 0)));

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('app:busy', { detail: { active: Boolean(open), title } }));
    return () => window.dispatchEvent(new CustomEvent('app:busy', { detail: { active: false } }));
  }, [open, title]);

  const overlay = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="app-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            className="glass-card w-full max-w-md border border-primary-500/25"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-primary-300">Please wait</p>
                <h2 className="mt-1 font-display text-xl font-semibold text-white">{title}</h2>
                <p className="mt-2 text-sm text-slate-400">{message || `${pct}% uploaded`}</p>
              </div>
              {onCancel && (
                <button type="button" onClick={onCancel} className="icon-action bg-white/5 text-slate-300 hover:bg-white/10" title="Cancel process">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mt-5 h-3 overflow-hidden rounded-full border border-white/10 bg-white/5">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary-500 to-emerald-400"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>{pct}% uploaded</span>
              <span>{pct >= 100 ? 'Processing...' : 'Uploading...'}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}
