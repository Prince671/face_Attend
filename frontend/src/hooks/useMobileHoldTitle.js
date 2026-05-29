import { useEffect } from 'react';

const isMobilePointer = () => (
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none), (pointer: coarse)')?.matches
);

export default function useMobileHoldTitle() {
  useEffect(() => {
    if (!isMobilePointer()) return undefined;

    let holdTimer = null;
    let hideTimer = null;
    let tooltip = null;

    const removeTooltip = () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = null;
      tooltip?.remove();
      tooltip = null;
    };

    const showTooltip = (target) => {
      const label = target.getAttribute('aria-label') || target.getAttribute('title') || target.dataset.title;
      if (!label) return;
      removeTooltip();
      const rect = target.getBoundingClientRect();
      tooltip = document.createElement('div');
      tooltip.textContent = label;
      tooltip.className = 'mobile-hold-tooltip';
      tooltip.style.left = `${Math.min(Math.max(rect.left + rect.width / 2, 72), window.innerWidth - 72)}px`;
      tooltip.style.top = `${Math.max(rect.top - 12, 56)}px`;
      document.body.appendChild(tooltip);
      hideTimer = window.setTimeout(removeTooltip, 2000);
    };

    const startHold = (event) => {
      const target = event.target?.closest?.('button[aria-label], a[aria-label], [data-title], button[title], a[title]');
      if (!target) return;
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => showTooltip(target), 520);
    };

    const cancelHold = () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = null;
    };

    document.addEventListener('touchstart', startHold, { passive: true });
    document.addEventListener('touchend', cancelHold, { passive: true });
    document.addEventListener('touchcancel', cancelHold, { passive: true });
    document.addEventListener('pointercancel', cancelHold, { passive: true });

    return () => {
      cancelHold();
      removeTooltip();
      document.removeEventListener('touchstart', startHold);
      document.removeEventListener('touchend', cancelHold);
      document.removeEventListener('touchcancel', cancelHold);
      document.removeEventListener('pointercancel', cancelHold);
    };
  }, []);
}
