import { useEffect } from 'react';

export function useQtyFocus(
  focusKey: string | number | null,
  setFocusKey: (v: null) => void,
  pickerOpen: boolean,
  lines: unknown,
): void {
  useEffect(() => {
    if (focusKey === null || pickerOpen) return undefined;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-qty-key="${focusKey}"]`);
      if (el && document.activeElement === el) { setFocusKey(null); return; }
      el?.focus();
      el?.select();
      if (++frames < 40) raf = requestAnimationFrame(tryFocus);
      else setFocusKey(null);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [focusKey, pickerOpen, lines, setFocusKey]);
}

export function advanceFrom<T extends { key: string | number }>(
  lines: T[],
  setFocusKey: (k: T['key']) => void,
  openPicker: () => void,
): (key: T['key']) => void {
  return (key) => {
    const idx = lines.findIndex((l) => l.key === key);
    const next = idx >= 0 ? lines[idx + 1] : undefined;
    if (next) { setFocusKey(next.key); return; }
    openPicker();
  };
}
