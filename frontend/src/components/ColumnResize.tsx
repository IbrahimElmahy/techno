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

export const WIDTHS_EVENT = 'techno:col-widths';
let shared: Widths = load();
let raf = 0;
function emit() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    window.dispatchEvent(new Event(WIDTHS_EVENT));
  });
}

export function storedWidth(heading: string): number | undefined {
  return shared[`${scopeOf()}|${heading.trim().slice(0, 40)}`];
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

function syncHeaders(watch?: (el: Element) => void) {
  document.querySelectorAll<HTMLElement>('.ant-table-container').forEach((box) => {
    const header = box.querySelector<HTMLElement>(':scope > .ant-table-header');
    const body = box.querySelector<HTMLElement>(':scope > .ant-table-body');
    if (!header || !body) return;
    const bodyTable = body.querySelector<HTMLElement>(':scope > table');
    const headTable = header.querySelector<HTMLElement>(':scope > table');
    const measure = bodyTable?.querySelector<HTMLElement>(':scope > tbody > tr.ant-table-measure-row');
    if (!bodyTable || !headTable || !measure) return;
    watch?.(bodyTable);
    const widths = [...measure.children].map((c) => (c as HTMLElement).getBoundingClientRect().width);
    if (!widths.length || widths.some((w) => !w)) return;
    const cols = [...(headTable.querySelector(':scope > colgroup')?.children ?? [])] as HTMLElement[];
    widths.forEach((w, i) => {
      const col = cols[i];
      if (!col) return;
      const cur = parseFloat(col.style.width);
      if (!(Math.abs(cur - w) < 0.5)) col.style.width = `${w}px`;
    });
    if (cols.length === widths.length) {
      const bw = bodyTable.getBoundingClientRect().width;
      const hw = headTable.getBoundingClientRect().width;
      if (Math.abs(bw - hw) >= 0.5) headTable.style.width = `${bw}px`;
    }
  });
}

export default function ColumnResizeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let widths = shared;
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
      syncHeaders();
      widths[drag.key] = next;
      emit();
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
      emit();
      e.preventDefault();
      e.stopPropagation();
    };

    const watched = new WeakSet<Element>();
    let syncRaf = 0;
    const scheduleSync = () => {
      if (syncRaf) return;
      syncRaf = requestAnimationFrame(() => { syncRaf = 0; syncHeaders(watch); });
    };
    const sizes = new ResizeObserver(scheduleSync);
    const watch = (el: Element) => {
      if (watched.has(el)) return;
      watched.add(el);
      sizes.observe(el);
    };

    let queued: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = setTimeout(() => { queued = null; applyStored(widths); scheduleSync(); }, 16);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener(WIDTHS_EVENT, scheduleSync);
    applyStored(widths);
    scheduleSync();

    return () => {
      if (queued) clearTimeout(queued);
      if (syncRaf) cancelAnimationFrame(syncRaf);
      sizes.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener(WIDTHS_EVENT, scheduleSync);
      observer.disconnect();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return <>{children}</>;
}
