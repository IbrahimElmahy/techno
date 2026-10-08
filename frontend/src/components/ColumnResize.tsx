import React, { useEffect } from 'react';

const STORAGE_KEY = 'techno.col-widths';
const GRIP = 8;
const MIN_WIDTH = 48;

type Widths = Record<string, number>;

function load(): Widths {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function save(w: Widths) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(w)); } catch {}
}

function headingOf(th: HTMLElement): string {
  return (th.textContent || '').trim().slice(0, 40);
}

function scopeOf(): string {
  return window.location.hash ? window.location.hash.split('?')[0] : window.location.pathname;
}

function keyFor(th: HTMLElement): string {
  return `${scopeOf()}|${headingOf(th)}`;
}

function colsAt(table: HTMLElement, index: number): HTMLElement[] {
  const root = table.closest('.ant-table') || table;
  return [...root.querySelectorAll('colgroup')]
    .map((cg) => cg.children[index] as HTMLElement | undefined)
    .filter((c): c is HTMLElement => !!c);
}

function onGrip(th: HTMLElement, clientX: number): boolean {
  const r = th.getBoundingClientRect();
  const rtl = getComputedStyle(th).direction === 'rtl';
  return rtl ? clientX - r.left <= GRIP : r.right - clientX <= GRIP;
}

function indexOf(th: HTMLElement): number {
  const row = th.parentElement;
  return row ? [...row.children].indexOf(th) : -1;
}

function applyStored(widths: Widths) {
  document.querySelectorAll<HTMLElement>('.ant-table-thead').forEach((thead) => {
    const row = thead.querySelector('tr');
    const table = thead.closest('table') as HTMLElement | null;
    if (!row || !table) return;
    [...row.children].forEach((cell, i) => {
      const w = widths[keyFor(cell as HTMLElement)];
      if (!w) return;
      const root = table.closest('.ant-table');
      root?.querySelectorAll('table').forEach((t) => {
        (t as HTMLElement).style.tableLayout = 'fixed';
      });
      colsAt(table, i).forEach((col) => { col.style.width = `${w}px`; });
    });
  });
}

export default function ColumnResizeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let widths = load();
    let drag: { th: HTMLElement; table: HTMLElement; index: number; startX: number;
      startWidth: number; key: string } | null = null;

    const onMove = (e: PointerEvent) => {
      if (!drag) {
        const th = (e.target as HTMLElement)?.closest?.('.ant-table-thead th') as HTMLElement | null;
        if (th) th.style.cursor = onGrip(th, e.clientX) ? 'col-resize' : '';
        return;
      }
      const rtl = getComputedStyle(drag.th).direction === 'rtl';
      const delta = rtl ? drag.startX - e.clientX : e.clientX - drag.startX;
      const next = Math.max(MIN_WIDTH, Math.round(drag.startWidth + delta));
      colsAt(drag.table, drag.index).forEach((col) => { col.style.width = `${next}px`; });
      widths[drag.key] = next;
      e.preventDefault();
    };

    const onUp = () => {
      if (!drag) return;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      drag = null;
      save(widths);
    };

    const onDown = (e: PointerEvent) => {
      const th = (e.target as HTMLElement)?.closest?.('.ant-table-thead th') as HTMLElement | null;
      if (!th || !onGrip(th, e.clientX)) return;
      const table = th.closest('table') as HTMLElement | null;
      const index = indexOf(th);
      if (!table || index < 0) return;

      table.closest('.ant-table')?.querySelectorAll('table').forEach((t) => {
        (t as HTMLElement).style.tableLayout = 'fixed';
      });

      drag = {
        th, table, index, startX: e.clientX,
        startWidth: th.getBoundingClientRect().width, key: keyFor(th),
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
      e.stopPropagation();
    };

    const onDoubleClick = (e: MouseEvent) => {
      const th = (e.target as HTMLElement)?.closest?.('.ant-table-thead th') as HTMLElement | null;
      if (!th || !onGrip(th, e.clientX)) return;
      const table = th.closest('table') as HTMLElement | null;
      const index = indexOf(th);
      if (!table || index < 0) return;
      delete widths[keyFor(th)];
      colsAt(table, index).forEach((col) => { col.style.width = ''; });
      save(widths);
      e.preventDefault();
      e.stopPropagation();
    };

    let queued: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = setTimeout(() => { queued = null; applyStored(widths); }, 16);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    applyStored(widths);

    return () => {
      if (queued) clearTimeout(queued);
      observer.disconnect();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return <>{children}</>;
}
