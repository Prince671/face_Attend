import React from 'react';
import { ChevronRight } from 'lucide-react';

export default function AdminBreadcrumb({ items = [] }) {
  const crumbs = items.filter(Boolean);
  if (crumbs.length === 0) return null;

  return (
    <nav className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 sm:px-3 sm:py-2 overflow-x-auto" aria-label="Page location">
      <ol className="flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap min-w-max sm:gap-2 sm:text-sm">
        {crumbs.map((item, index) => {
          const isLast = index === crumbs.length - 1;
          const Icon = item.icon;
          return (
            <React.Fragment key={`${item.label}-${index}`}>
              {index > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600 flex-shrink-0 sm:w-4 sm:h-4" />}
              {item.onClick && !isLast ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-slate-400 hover:text-white hover:bg-white/5 transition-colors sm:gap-1.5 sm:px-1.5 sm:py-1"
                >
                  {Icon && <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  <span>{item.label}</span>
                </button>
              ) : (
                <span className={`inline-flex items-center gap-1 px-1 py-0.5 sm:gap-1.5 sm:px-1.5 sm:py-1 ${isLast ? 'text-primary-300' : 'text-slate-400'}`}>
                  {Icon && <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  <span>{item.label}</span>
                </span>
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
