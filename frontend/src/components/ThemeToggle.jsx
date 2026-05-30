import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { preferenceAPI } from '../services/api';

const getInitialTheme = () => {
  if (typeof window === 'undefined') return 'dark';
  return localStorage.getItem('theme') || 'dark';
};

const hasAuthToken = () => typeof window !== 'undefined' && Boolean(localStorage.getItem('token'));

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(getInitialTheme);
  const isLight = theme === 'light';

  useEffect(() => {
    if (!hasAuthToken()) return undefined;
    let mounted = true;
    preferenceAPI.get('theme')
      .then(res => {
        const savedTheme = res.data?.value;
        if (mounted && (savedTheme === 'light' || savedTheme === 'dark')) setTheme(savedTheme);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('light', isLight);
    document.documentElement.classList.toggle('dark', !isLight);
    localStorage.setItem('theme', theme);
    if (hasAuthToken()) preferenceAPI.set('theme', theme).catch(() => {});
  }, [isLight, theme]);

  return (
    <button
      type="button"
      onClick={() => setTheme(isLight ? 'dark' : 'light')}
      className={`theme-toggle inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-all hover:bg-white/20 ${className}`}
      aria-label={`Switch to ${isLight ? 'dark' : 'light'} mode`}
      title={`Switch to ${isLight ? 'dark' : 'light'} mode`}
    >
      {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
      <span className="hidden sm:inline">{isLight ? 'Dark' : 'Light'}</span>
    </button>
  );
}
