import { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value || 0)));

export function useSmoothBulkProgress() {
  const [bulkProgress, setBulkProgress] = useState(null);
  const timerRef = useRef(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      setBulkProgress(current => {
        if (!current || current.progress >= 100) return current;
        const ceiling = current.phase === 'processing' ? 98 : 88;
        if (current.progress >= ceiling) return current;
        const increment = current.phase === 'processing' ? 1 : (current.progress < 40 ? 3 : current.progress < 72 ? 2 : 1);
        return { ...current, progress: clamp(current.progress + increment, 1, ceiling) };
      });
    }, 260);
  }, [stopTimer]);

  const startBulkProgress = useCallback(({ title, controller, message } = {}) => {
    setBulkProgress({ title, controller, message, phase: 'uploading', progress: 1 });
    startTimer();
  }, [startTimer]);

  const markBulkUploadProgress = useCallback((event) => {
    if (!event?.total) return;
    const uploadPct = clamp((event.loaded * 88) / event.total, 1, 88);
    setBulkProgress(current => current ? {
      ...current,
      phase: 'uploading',
      progress: Math.max(current.progress || 1, Math.min(uploadPct, (current.progress || 1) + 8))
    } : current);
  }, []);

  const markBulkProcessing = useCallback((message) => {
    setBulkProgress(current => current ? {
      ...current,
      phase: 'processing',
      message,
      progress: Math.max(current.progress || 1, Math.min(92, (current.progress || 1) + 4))
    } : current);
  }, []);

  const completeBulkProgress = useCallback((message) => {
    stopTimer();
    setBulkProgress(current => current ? { ...current, phase: 'complete', message, progress: 100 } : current);
  }, [stopTimer]);

  const clearBulkProgress = useCallback((delay = 350) => {
    stopTimer();
    window.setTimeout(() => setBulkProgress(null), delay);
  }, [stopTimer]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  return {
    bulkProgress,
    startBulkProgress,
    markBulkUploadProgress,
    markBulkProcessing,
    completeBulkProgress,
    clearBulkProgress
  };
}
