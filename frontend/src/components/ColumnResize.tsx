import React, { useEffect } from 'react';
import { PREFS_EVENT, pushPref } from '../utils/userPrefs';

const STORAGE_KEY = 'techno.col-widths';
const GRIP = 8;
const MIN_WIDTH = 48;
const DRAG_THRESHOLD = 4;

type Widths = Record<string, number>;

function load(): Widths {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function save(w: Widths) {
  try {
    const text = JSON.stringify(w);
    localStorage.setItem(STORAGE_KEY, text);
    pushPref(STORAGE_KEY, text);
  } catch {}
}

export const WIDTHS_EVENT = 'techno:col-widths';
let shared: Widths = load();
window.addEventListener(PREFS_EVENT, () => { shared = load(); emit(); });
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

function leafIndex(th: HTMLElement): number {
  if ((th as HTMLTableCellElement).colSpan > 1) return -1;
  const thead = th.closest('thead');
  if (!thead) return -1;
  const taken: boolean[][] = [];
  const rows = [...thead.querySelectorAll(':scope > tr')] as HTMLTableRowElement[];
  for (let r = 0; r < rows.length; r += 1) {
    taken[r] = taken[r] || [];
    let c = 0;
    for (const cell of [...rows[r].children] as HTMLTableCellElement[]) {
      while (taken[r][c]) c += 1;
      if (cell === th) return c;
      const span = cell.colSpan || 1;
      for (let dr = 0; dr < (cell.rowSpan || 1); dr += 1) {
        taken[r + dr] = taken[r + dr] || [];
        for (let dc = 0; dc < span; dc += 1) taken[r + dr][c + dc] = true;
      }
      c += span;
    }
  }
  return -1;
}

function onGrip(th: HTMLElement, clientX: number): boolean {
  if ((th as HTMLTableCellElement).colSpan > 1) return false;
  const r = th.getBoundingClientRect();
  const rtl = getComputedStyle(th).direction === 'rtl';
  return rtl ? clientX - r.left <= GRIP : r.right - clientX <= GRIP;
}

function gripTarget(e: { target: EventTarget | null; clientX: number; clientY: number }): HTMLElement | null {
  const th = (e.target as HTMLElement)?.closest?.('.ant-table-thead th') as HTMLElement | null;
  if (!th) return null;
  if (onGrip(th, e.clientX)) return th;
  const r = th.getBoundingClientRect();
  const rtl = getComputedStyle(th).direction === 'rtl';
  const near = rtl ? r.right - e.clientX <= GRIP : e.clientX - r.left <= GRIP;
  if (!near) return null;
  const probe = document.elementFromPoint(rtl ? r.right + 2 : r.left - 2, e.clientY);
  const other = (probe as HTMLElement | null)?.closest?.('.ant-table-thead th') as HTMLElement | null;
  if (!other || other === th || other.closest('thead') !== th.closest('thead')) return null;
  return (other as HTMLTableCellElement).colSpan > 1 ? null : other;
}

function indexOf(th: HTMLElement): number {
  return leafIndex(th);
}

function setWidth(table: HTMLElement, index: number, w: number) {
  colsAt(table, index).forEach((col) => {
    if (col.style.width !== `${w}px`) col.style.width = `${w}px`;
    if (col.style.minWidth !== `${w}px`) col.style.minWidth = `${w}px`;
  });
}

function clearWidth(table: HTMLElement, index: number) {
  colsAt(table, index).forEach((col) => { col.style.width = ''; col.style.minWidth = ''; });
}

function leafCells(thead: Element): HTMLElement[] {
  return ([...thead.querySelectorAll(':scope > tr > th')] as HTMLElement[])
    .filter((c) => leafIndex(c) >= 0)
    .sort((a, b) => leafIndex(a) - leafIndex(b));
}

function fitTable(table: HTMLElement, widths: Widths) {
  const thead = table.querySelector(':scope > thead');
  const root = table.closest('.ant-table') || table;
  const tables = [...root.querySelectorAll('table')] as HTMLElement[];
  const cells = thead ? leafCells(thead) : [];
  const cg = table.querySelector(':scope > colgroup');
  const cols = cg ? cg.children.length : 0;
  const ws = cells.map((c) => (headingOf(c) ? widths[keyFor(c)] : undefined));
  const full = cells.length > 0 && ws.every(Boolean) && (cells.length === cols || cells.length === cols - 1);
  if (full) {
    const sum = ws.reduce<number>((t, w) => t + (w ?? 0), 0);
    tables.forEach((t) => {
      t.dataset.fitted = '1';
      if (t.style.width !== `${sum}px`) t.style.width = `${sum}px`;
      t.style.minWidth = '0';
    });
  } else {
    tables.forEach((t) => {
      if (!t.dataset.fitted) return;
      delete t.dataset.fitted;
      t.style.width = '';
      t.style.minWidth = '';
    });
  }
}

function applyStored(widths: Widths) {
  document.querySelectorAll<HTMLElement>('.ant-table-thead').forEach((thead) => {
    const table = thead.closest('table') as HTMLElement | null;
    if (!table) return;
    thead.querySelectorAll<HTMLElement>(':scope > tr > th').forEach((cell) => {
      const w = widths[keyFor(cell)];
      if (!w) return;
      const i = leafIndex(cell);
      if (i < 0) return;
      setWidth(table, i, w);
    });
    fitTable(table, widths);
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
    let pending: { th: HTMLElement; table: HTMLElement; index: number; startX: number } | null = null;
    let swallowClick = false;

    const begin = (p: NonNullable<typeof pending>) => {
      const startWidth = Math.round(p.th.getBoundingClientRect().width);
      const thead = p.th.closest('thead');
      if (thead) {
        leafCells(thead).forEach((c) => {
          if (!headingOf(c)) return;
          const k = keyFor(c);
          if (!widths[k]) {
            widths[k] = Math.round(c.getBoundingClientRect().width);
            setWidth(p.table, leafIndex(c), widths[k]);
          }
        });
      }
      drag = {
        th: p.th, table: p.table, index: p.index, startX: p.startX,
        startWidth, key: keyFor(p.th),
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    };

    const onMove = (e: PointerEvent) => {
      if (!drag && pending) {
        if (Math.abs(e.clientX - pending.startX) < DRAG_THRESHOLD) return;
        begin(pending);
        pending = null;
      }
      if (!drag) {
        const th = (e.target as HTMLElement)?.closest?.('.ant-table-thead th') as HTMLElement | null;
        if (th) th.style.cursor = gripTarget(e) ? 'col-resize' : '';
        return;
      }
      const rtl = getComputedStyle(drag.th).direction === 'rtl';
      const delta = rtl ? drag.startX - e.clientX : e.clientX - drag.startX;
      const next = Math.max(MIN_WIDTH, Math.round(drag.startWidth + delta));
      setWidth(drag.table, drag.index, next);
      widths[drag.key] = next;
      fitTable(drag.table, widths);
      syncHeaders();
      emit();
      e.preventDefault();
    };

    const onUp = () => {
      pending = null;
      if (!drag) return;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      drag = null;
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      save(widths);
    };

    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const th = gripTarget(e);
      if (!th) return;
      const table = th.closest('table') as HTMLElement | null;
      const index = indexOf(th);
      if (!table || index < 0) return;
      pending = { th, table, index, startX: e.clientX };
      e.preventDefault();
      e.stopPropagation();
    };

    const onDoubleClick = (e: MouseEvent) => {
      const th = gripTarget(e);
      if (!th) return;
      const table = th.closest('table') as HTMLElement | null;
      const index = indexOf(th);
      if (!table || index < 0) return;
      delete widths[keyFor(th)];
      clearWidth(table, index);
      fitTable(table, widths);
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
    document.addEventListener('click', onClick, true);
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
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return <>{children}</>;
}
