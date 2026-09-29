import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard navigation inside a dialog and restore its opener on close. */
export function useModalFocus<T extends HTMLElement>(active: boolean, initialSelector?: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(element => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));
    const initial = (initialSelector && dialog.querySelector<HTMLElement>(initialSelector)) || focusable()[0];
    initial?.focus();

    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keepFocus, true);
    return () => {
      document.removeEventListener('keydown', keepFocus, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [active, initialSelector]);

  return ref;
}
