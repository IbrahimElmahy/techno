import React, { useEffect } from 'react';

/**
 * عرض العمود — تسحب الحد بين العناوين، زي الإكسل.
 *
 * The names in a stocktake are long and the codes are short, and antd's guess about which deserves
 * the room is made once by whoever wrote the screen. The person actually reading it wants «الصنف»
 * wide enough to see the whole name and «الوحدة» narrow enough not to waste half the row — and that
 * want changes with the job, not with the screen.
 *
 * **Done at the DOM, on purpose.** antd resizes columns through a per-table `components.header.cell`
 * override; with 173 tables that is 173 edits, 173 chances to miss one, and a screen written next
 * month that quietly cannot be resized. So this listens once at the document: any header cell in
 * the app can be dragged, including inside modals and pickers, and including tables nobody has
 * written yet — the same bargain the row-height control makes.
 *
 * **Widths are remembered by column NAME, not by position.** This system hides columns from
 * الأعمدة, so an index would slide every stored width one place across the moment somebody hid one.
 * Keyed by the heading text and the screen it is on, a hidden column takes its width with it and
 * gives it back when it returns.
 *
 * **The table is switched to a fixed layout when its first column is resized.** In `auto` layout a
 * `<col>` width is a suggestion the browser is free to ignore, which reads as a drag that did not
 * take. Switching only once somebody has actually dragged leaves every untouched table exactly as
 * it was.
 *
 * Double-click on the handle clears that column and lets it size itself again — the escape hatch
 * for a drag that went wrong, which in a spreadsheet is what double-clicking the edge does.
 */

const STORAGE_KEY = 'techno.col-widths';
/** How close to the edge counts as «on the handle». Wide enough to hit, narrow enough not to eat
 *  the click that sorts the column. */
const GRIP = 8;
const MIN_WIDTH = 48;

type Widths = Record<string, number>;

function load(): Widths {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function save(w: Widths) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(w)); } catch { /* private mode */ }
}

/** The heading as a person reads it — the stable half of the key. */
function headingOf(th: HTMLElement): string {
  return (th.textContent || '').trim().slice(0, 40);
}

/** Which screen this table is on, so «الصنف» on the stocktake and on the item card size apart. */
function scopeOf(): string {
  return window.location.hash ? window.location.hash.split('?')[0] : window.location.pathname;
}

function keyFor(th: HTMLElement): string {
  return `${scopeOf()}|${headingOf(th)}`;
}

/** Every `<col>` at this index — a scrolling table has a separate header and body table, and both
 *  have to move together or the headings stop lining up with the cells under them. */
function colsAt(table: HTMLElement, index: number): HTMLElement[] {
  const root = table.closest('.ant-table') || table;
  return [...root.querySelectorAll('colgroup')]
    .map((cg) => cg.children[index] as HTMLElement | undefined)
    .filter((c): c is HTMLElement => !!c);
}

/** True when the pointer is over the draggable edge — the inline-END one, which in this RTL app is
 *  the LEFT side of the cell. Getting this backwards puts the handle on the wrong border and the
 *  column that moves is not the one you grabbed. */
function onGrip(th: HTMLElement, clientX: number): boolean {
  const r = th.getBoundingClientRect();
  const rtl = getComputedStyle(th).direction === 'rtl';
  return rtl ? clientX - r.left <= GRIP : r.right - clientX <= GRIP;
}

function indexOf(th: HTMLElement): number {
  const row = th.parentElement;
  return row ? [...row.children].indexOf(th) : -1;
}

/** Put the remembered widths back after a re-render, a filter, a page change. */
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
        // Not dragging: just show the handle when the pointer is over an edge, so the affordance
        // is discoverable without anybody being told it exists.
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

      // A `<col>` width is only honoured in a fixed layout; in `auto` the browser may ignore it and
      // the drag looks like it did nothing.
      table.closest('.ant-table')?.querySelectorAll('table').forEach((t) => {
        (t as HTMLElement).style.tableLayout = 'fixed';
      });

      drag = {
        th, table, index, startX: e.clientX,
        startWidth: th.getBoundingClientRect().width, key: keyFor(th),
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      // The header is also the sort button. Without this, every resize sorts the table as well.
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

    // antd rebuilds a table on every filter, sort and page change, which throws the widths away.
    // Re-applying on mutation is what makes them stick rather than survive until the first click.
    //
    // Coalesced to one pass per frame: this watches the whole document, and typing into a cell can
    // fire mutations per keystroke. Re-scanning every table on each of those would make the grid
    // that most needs the widths the one that stutters.
    // A timer rather than `requestAnimationFrame`: rAF is SUSPENDED while the tab is in the
    // background, so a table that re-rendered there would leave the coalescing flag stuck set and
    // the widths would stay lost until something else happened to schedule another pass. Found by
    // testing this with the browser pane hidden, which is the same condition.
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
