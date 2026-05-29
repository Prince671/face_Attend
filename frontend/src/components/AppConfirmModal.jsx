import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, LogOut, Trash2, X } from 'lucide-react';

const iconMap = {
  danger: Trash2,
  logout: LogOut,
  warning: AlertTriangle
};

export default function AppConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel
}) {
  const Icon = iconMap[tone] || AlertTriangle;

  const modal = (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="app-modal-backdrop"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            className="glass-card w-full max-w-md border border-white/10 shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                tone === 'logout'
                  ? 'bg-primary-500/15 border-primary-400/30 text-primary-300'
                  : 'bg-red-500/15 border-red-400/30 text-red-300'
              }`}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-xl font-bold text-white">{title}</h2>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed">{message}</p>
              </div>
              <button type="button" onClick={onCancel} className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              <button type="button" onClick={onCancel} disabled={loading} className="btn-secondary flex-1">
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className={`${tone === 'logout' ? 'btn-primary' : 'btn-danger'} flex-1`}
              >
                {loading ? 'Please wait...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
