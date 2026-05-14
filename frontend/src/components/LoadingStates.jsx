import React from 'react';
import { Loader2 } from 'lucide-react';

export function PageLoader({ label = 'Loading content...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-8 h-8 animate-spin text-primary-400 mb-3" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function InlineLoader({ label = 'Loading...' }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
      {label}
    </span>
  );
}

export function LoadingOverlay({ show, label = 'Loading latest data...' }) {
  if (!show) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-slate-950/60 backdrop-blur-[2px]">
      <div className="rounded-lg border border-white/10 bg-slate-900/95 px-4 py-3 shadow-xl">
        <InlineLoader label={label} />
      </div>
    </div>
  );
}

export function CardSkeleton({ rows = 3 }) {
  return (
    <div className="glass-card animate-pulse space-y-4">
      <div className="h-4 w-1/3 rounded bg-white/10" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 rounded-lg bg-white/5" />
      ))}
    </div>
  );
}
