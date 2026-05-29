import React from 'react';

export function PageLoader({ label = 'Loading content...' }) {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-label={label}>
      <SkeletonHeader />
      <SkeletonStats count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton rows={4} />
        <CardSkeleton rows={4} />
      </div>
    </div>
  );
}

export function InlineLoader({ label = 'Loading...' }) {
  return (
    <span className="inline-flex min-w-40 items-center gap-2 text-sm text-slate-400" role="status" aria-live="polite" aria-label={label}>
      <SkeletonLine className="h-4 w-4 rounded-full bg-primary-300/25" />
      <SkeletonLine className="h-4 w-28 bg-white/15" />
    </span>
  );
}

export function LoadingOverlay({ show, label = 'Loading latest data...' }) {
  if (!show) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-slate-950/62 backdrop-blur-sm">
      <div className="rounded-xl border border-white/10 bg-slate-900/95 px-4 py-3 shadow-2xl">
        <InlineLoader label={label} />
      </div>
    </div>
  );
}

export function CardSkeleton({ rows = 3 }) {
  return (
    <div className="glass-card space-y-4">
      <div className="skeleton-shimmer h-4 w-1/3 rounded" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton-shimmer h-12 rounded-lg" />
      ))}
    </div>
  );
}

export const SkeletonLine = ({ className = '' }) => <div className={`skeleton-shimmer rounded-full ${className}`} />;

export const AuthButtonSkeleton = ({ className = '' }) => (
  <span className={`flex w-full items-center justify-center gap-2 ${className}`} role="status" aria-live="polite">
    <SkeletonLine className="h-4 w-4 rounded-full bg-white/25" />
    <SkeletonLine className="h-4 w-24 bg-white/25" />
  </span>
);

export function AuthPageSkeleton({ mode = 'login' }) {
  const isRegister = mode === 'register';
  return (
    <div className="auth-login-page min-h-dvh flex items-center justify-center relative overflow-hidden px-3 py-6" role="status" aria-live="polite">
      <div className="auth-login-bg absolute inset-0">
        <div
          className="auth-login-grid absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }}
        />
      </div>
      <div className="relative z-10 grid w-full max-w-6xl items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="glass-card hidden min-h-[520px] p-8 lg:flex lg:flex-col lg:justify-between">
          <div>
            <SkeletonLine className="mb-7 h-16 w-16 rounded-2xl" />
            <SkeletonLine className="h-12 w-64" />
            <SkeletonLine className="mt-4 h-5 w-80" />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <SkeletonLine className="h-3 w-24" />
            <SkeletonLine className="mt-3 h-7 w-64" />
            <SkeletonLine className="mt-4 h-4 w-full" />
            <SkeletonLine className="mt-2 h-4 w-4/5" />
            <div className="mt-5 flex gap-2">
              <SkeletonLine className="h-1.5 w-9" />
              <SkeletonLine className="h-1.5 w-4" />
              <SkeletonLine className="h-1.5 w-4" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map(index => <SkeletonLine key={index} className="h-11 rounded-xl" />)}
          </div>
        </div>
        <div className="glass-card mx-auto w-full max-w-sm space-y-4">
          <div className="text-center lg:hidden">
            <SkeletonLine className="mx-auto h-12 w-12 rounded-xl" />
            <SkeletonLine className="mx-auto mt-3 h-7 w-40" />
            <SkeletonLine className="mx-auto mt-2 h-3 w-52" />
          </div>
          <SkeletonLine className="h-6 w-32" />
          <div className="space-y-3">
            {Array.from({ length: isRegister ? 8 : 2 }).map((_, index) => (
              <div key={index} className={isRegister ? '' : 'space-y-2'}>
                <SkeletonLine className="h-3 w-24" />
                <SkeletonLine className="mt-2 h-11 rounded-xl" />
              </div>
            ))}
          </div>
          <SkeletonLine className="h-11 rounded-xl bg-primary-300/20" />
          {!isRegister && (
            <>
              <SkeletonLine className="h-px w-full" />
              <SkeletonLine className="h-11 rounded-xl" />
              <SkeletonLine className="h-10 rounded-lg" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SkeletonHeader = ({ withAction = true }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="space-y-2">
      <SkeletonLine className="h-8 w-56 max-w-full" />
      <SkeletonLine className="h-4 w-80 max-w-full" />
    </div>
    {withAction && <SkeletonLine className="h-11 w-full rounded-xl sm:w-36" />}
  </div>
);

const SkeletonBreadcrumb = ({ items = 3 }) => (
  <div className="flex flex-wrap gap-2">
    {Array.from({ length: items }).map((_, index) => <SkeletonLine key={index} className="h-8 w-24" />)}
  </div>
);

const SkeletonStats = ({ count = 4 }) => (
  <div className="stats-strip sm:grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="stat-tile">
        <SkeletonLine className="h-14 w-14 rounded-2xl sm:h-16 sm:w-16" />
        <div className="w-full space-y-2">
          <SkeletonLine className="mx-auto h-3 w-24" />
          <SkeletonLine className="mx-auto h-7 w-16" />
        </div>
      </div>
    ))}
  </div>
);

const SkeletonTable = ({ rows = 6 }) => (
  <div className="glass-card">
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <SkeletonLine className="h-6 w-44" />
      <div className="grid gap-2 sm:grid-cols-3">
        <SkeletonLine className="h-10 w-full rounded-xl sm:w-32" />
        <SkeletonLine className="h-10 w-full rounded-xl sm:w-32" />
        <SkeletonLine className="h-10 w-full rounded-xl sm:w-32" />
      </div>
    </div>
    <div className="hidden overflow-hidden rounded-xl border border-white/10 sm:block">
      <div className="grid grid-cols-5 gap-3 bg-white/[0.035] p-3">
        {Array.from({ length: 5 }).map((_, index) => <SkeletonLine key={index} className="h-3 w-20" />)}
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="grid grid-cols-5 gap-3 border-t border-white/10 p-3">
          {Array.from({ length: 5 }).map((__, cell) => <SkeletonLine key={cell} className="h-4 w-full" />)}
        </div>
      ))}
    </div>
    <div className="space-y-3 sm:hidden">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <SkeletonLine className="h-5 w-3/4" />
          <SkeletonLine className="mt-2 h-3 w-1/2" />
          <div className="mt-3 flex gap-2">
            <SkeletonLine className="h-8 flex-1 rounded-lg" />
            <SkeletonLine className="h-8 w-10 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const SkeletonCardGrid = ({ cards = 6 }) => (
  <div className="card-strip sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: cards }).map((_, index) => (
      <div key={index} className="glass-card compact-card">
        <div className="flex items-start gap-3">
          <SkeletonLine className="h-11 w-11 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine className="h-5 w-4/5" />
            <SkeletonLine className="h-3 w-2/3" />
            <SkeletonLine className="h-8 w-full rounded-lg" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

export function SidebarSkeleton({ compact = false }) {
  return (
    <div className="flex h-full flex-col bg-slate-900/80">
      <div className="border-b border-white/5 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <SkeletonLine className="h-9 w-9 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine className="h-4 w-28" />
            <SkeletonLine className="h-3 w-20" />
          </div>
        </div>
      </div>
      <nav className="min-h-0 flex-1 space-y-2 overflow-hidden p-3 sm:p-4">
        {Array.from({ length: compact ? 6 : 9 }).map((_, index) => (
          <div key={index} className="flex h-11 items-center gap-3 rounded-xl px-3">
            <SkeletonLine className="h-5 w-5 rounded-md" />
            <SkeletonLine className={`h-3.5 ${index % 3 === 0 ? 'w-24' : 'w-32'}`} />
          </div>
        ))}
      </nav>
      <div className="border-t border-white/5 p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <SkeletonLine className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine className="h-4 w-28" />
            <SkeletonLine className="h-3 w-20" />
          </div>
        </div>
        <SkeletonLine className="mt-3 h-10 rounded-xl" />
      </div>
    </div>
  );
}

export function AppShellSkeleton({ compactSidebar = false }) {
  return (
    <div className="app-shell flex h-dvh overflow-hidden bg-slate-950">
      <aside className="app-sidebar hidden w-60 flex-shrink-0 border-r border-white/5 md:block lg:w-64">
        <SidebarSkeleton compact={compactSidebar} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-topbar flex h-14 flex-shrink-0 items-center justify-between border-b border-white/5 bg-slate-900/60 px-3 backdrop-blur-xl sm:h-16 sm:px-6">
          <div className="flex items-center gap-3">
            <SkeletonLine className="h-10 w-10 rounded-xl md:hidden" />
            <div className="space-y-2">
              <SkeletonLine className="h-4 w-36" />
              <SkeletonLine className="h-3 w-24" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SkeletonLine className="h-10 w-20 rounded-xl" />
            <SkeletonLine className="h-10 w-10 rounded-xl" />
          </div>
        </header>
        <main className="app-main min-h-0 flex-1 overflow-hidden p-3 sm:p-6">
          <PageSkeleton />
        </main>
      </div>
    </div>
  );
}

const SkeletonDetail = () => (
  <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(18rem,0.45fr)]">
    <div className="space-y-4">
      <div className="glass-card">
        <SkeletonLine className="h-7 w-64 max-w-full" />
        <SkeletonLine className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SkeletonLine className="h-20 rounded-xl" />
          <SkeletonLine className="h-20 rounded-xl" />
          <SkeletonLine className="h-20 rounded-xl" />
        </div>
      </div>
      <SkeletonTable rows={5} />
    </div>
    <div className="space-y-4">
      <CardSkeleton rows={4} />
      <CardSkeleton rows={3} />
    </div>
  </div>
);

export function PageSkeleton({ variant = 'default', stats = 4, cards = 6, rows = 6, withAction = true }) {
  if (variant === 'table') {
    return <div className="space-y-6"><SkeletonHeader withAction={withAction} /><SkeletonBreadcrumb /><SkeletonTable rows={rows} /></div>;
  }
  if (variant === 'grid') {
    return <div className="space-y-6"><SkeletonHeader withAction={withAction} /><SkeletonBreadcrumb /><SkeletonCardGrid cards={cards} /></div>;
  }
  if (variant === 'detail') {
    return <div className="space-y-6"><SkeletonHeader withAction={withAction} /><SkeletonBreadcrumb /><SkeletonDetail /></div>;
  }
  if (variant === 'analytics') {
    return (
      <div className="space-y-6">
        <SkeletonHeader withAction={withAction} />
        <SkeletonStats count={stats} />
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton rows={5} />
          <CardSkeleton rows={5} />
        </div>
        <SkeletonTable rows={rows} />
      </div>
    );
  }
  if (variant === 'classroom') {
    return (
      <div className="space-y-6">
        <SkeletonHeader />
        <div className="flex gap-2 overflow-x-auto">
          {Array.from({ length: 7 }).map((_, index) => <SkeletonLine key={index} className="h-10 w-28 flex-shrink-0 rounded-xl" />)}
        </div>
        <SkeletonStats count={4} />
        <div className="grid gap-4 lg:grid-cols-2"><CardSkeleton rows={4} /><CardSkeleton rows={4} /></div>
      </div>
    );
  }
  if (variant === 'timetable') {
    return (
      <div className="space-y-6">
        <SkeletonHeader />
        <div className="glass-card">
          <div className="grid gap-2 sm:grid-cols-6">
            {Array.from({ length: 30 }).map((_, index) => <SkeletonLine key={index} className="h-16 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }
  if (variant === 'chat') {
    return (
      <div className="student-rooms grid h-dvh overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="hidden border-r border-white/10 p-4 lg:block">
          <SkeletonLine className="h-7 w-32" />
          <SkeletonLine className="mt-4 h-11 rounded-xl" />
          <div className="mt-4 space-y-3">{Array.from({ length: 6 }).map((_, index) => <SkeletonLine key={index} className="h-16 rounded-xl" />)}</div>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex h-16 items-center gap-3 border-b border-white/10 p-3">
            <SkeletonLine className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2"><SkeletonLine className="h-4 w-40" /><SkeletonLine className="h-3 w-64 max-w-full" /></div>
          </div>
          <div className="flex-1 space-y-4 p-4">
            {Array.from({ length: 8 }).map((_, index) => <SkeletonLine key={index} className={`h-12 rounded-2xl ${index % 2 ? 'ml-auto w-2/3' : 'w-3/4'}`} />)}
          </div>
          <div className="border-t border-white/10 p-3"><SkeletonLine className="h-14 rounded-full" /></div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <SkeletonHeader withAction={withAction} />
      <SkeletonBreadcrumb />
      <SkeletonStats count={stats} />
      <div className="grid gap-4 lg:grid-cols-2"><CardSkeleton rows={4} /><CardSkeleton rows={4} /></div>
    </div>
  );
}
