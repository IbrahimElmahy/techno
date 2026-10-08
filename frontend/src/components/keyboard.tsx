import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Input, List, Tag
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { allScreens } from './navigation';
import { TabModal } from './TabModal';
import { keepInView } from '../utils/keepInView';

export type ShortcutAction = 'new' | 'save' | 'search' | 'delete' | 'print' | 'close';

export interface ScreenShortcuts {
  onNew?: () => void;
  onSave?: () => void;
  onSearch?: () => void;
  onDelete?: () => void;
  onPrint?: () => void;
  onClose?: () => void;
}

export const KEY_MAP: { action: ShortcutAction; keys: string; label: string }[] = [
  { action: 'new', keys: 'F2', label: 'جديد' },
  { action: 'search', keys: 'F3', label: 'بحث' },
  { action: 'save', keys: 'F9', label: 'حفظ' },
  { action: 'print', keys: 'F7', label: 'طباعة' },
  { action: 'delete', keys: 'F8', label: 'حذف السطر أو السجل المحدد' },
  { action: 'close', keys: 'Esc', label: 'إغلاق النافذة المفتوحة' },
];

interface TableNav {
  isLive: () => boolean;
  move: (to: 'up' | 'down' | 'first' | 'last') => boolean;
  open: () => boolean;
}

interface KeyboardContextValue {
  register: (handlers: ScreenShortcuts) => () => void;
  registerTable: (nav: TableNav) => () => void;
  promoteTable: (nav: TableNav) => void;
}

const KeyboardContext = createContext<KeyboardContextValue>({
  register: () => () => {},
  registerTable: () => () => {},
  promoteTable: () => {},
});

export const TabActiveContext = createContext(true);

export function useOnScreen(): boolean {
  return useContext(TabActiveContext);
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof (el as any).closest !== 'function') return false;
  const tag = el.tagName;
  const editable = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    || el.closest('.ant-select') !== null;
  if (!editable) return false;
  if (/^F\d+$/.test(e.key)) return false;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === 'Escape') return false;
  return true;
}

function fieldsIn(container: HTMLElement): HTMLElement[] {
  const sel = [
    'input:not([type=hidden]):not([disabled])',
    'textarea:not([disabled]):not([readonly])',
    'select:not([disabled])',
  ].join(',');
  return [...container.querySelectorAll<HTMLElement>(sel)]
    .filter((el) => !el.hasAttribute('readonly') || el.closest('.ant-select') !== null)
    .filter((el) => el.offsetParent !== null || el.closest('.ant-select') !== null);
}

function formOf(el: HTMLElement): HTMLElement | null {
  return el.closest('.ant-modal-content, .ant-drawer-body, form') as HTMLElement | null;
}

function nextInGridColumn(el: HTMLElement, dir: 1 | -1 = 1): boolean {
  const cell = el.closest<HTMLElement>('[data-grid-col]');
  if (!cell) return false;
  const table = cell.closest('table') || cell.closest('.ant-table')
    || cell.closest('.ant-modal-body') || cell.closest('form')
    || cell.closest('.ant-card-body');
  if (!table) return false;
  const col = cell.getAttribute('data-grid-col');
  const cells = [...table.querySelectorAll<HTMLElement>(`[data-grid-col="${col}"]`)]
    .filter((c) => c.offsetParent !== null);
  const i = cells.indexOf(cell);
  if (i === -1) return false;
  const next = cells[i + dir];
  if (!next) return true;
  next.focus({ preventScroll: true });
  keepInView(next.closest('tr') ?? next);
  if (next instanceof HTMLInputElement && next.type !== 'checkbox') next.select();
  return true;
}

function enterMovesOn(e: KeyboardEvent): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.defaultPrevented) return false;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;

  if (el.tagName === 'TEXTAREA') return false;
  if (el.tagName === 'BUTTON' || el.closest('button')) return false;
  const select = el.closest('.ant-select');
  if (select && select.classList.contains('ant-select-open')) return false;

  const form = formOf(el);
  if (!form) {
    if (!el.closest('[data-grid-col]')) return false;
    e.preventDefault();
    return nextInGridColumn(el);
  }
  const fields = fieldsIn(form);
  const current = (el.classList.contains('ant-select-selector')
    ? select?.querySelector('input') : el) as HTMLElement | null;
  const i = current ? fields.indexOf(current) : -1;
  if (i === -1) return false;

  e.preventDefault();
  const next = fields[i + 1];
  if (next) {
    next.focus({ preventScroll: true });
    keepInView(next);
    if (next instanceof HTMLInputElement && next.type !== 'checkbox') next.select();
    return true;
  }
  const submit = form.querySelector<HTMLElement>(
    'button[type=submit], .ant-modal-footer .ant-btn-primary, .ant-btn-primary'
  );
  submit?.focus();
  return true;
}

function arrowsMoveLines(e: KeyboardEvent): boolean {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.defaultPrevented) return false;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  const cell = el.closest<HTMLElement>('[data-grid-col]');
  if (!cell) return false;
  const select = cell.closest('.ant-select');
  if (select && select.classList.contains('ant-select-open')) return false;

  const moved = nextInGridColumn(el, e.key === 'ArrowDown' ? 1 : -1);
  if (moved) e.preventDefault();
  return moved;
}

function pressMarkedButton(keys: string): boolean {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-shortcut="${keys}"]`)]
    .filter((el) => el.offsetParent !== null);
  const el = all[0];
  if (!el) return false;
  el.click();
  return true;
}

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const stack = useRef<ScreenShortcuts[]>([]);
  const tables = useRef<TableNav[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState('');

  const register = useCallback((handlers: ScreenShortcuts) => {
    stack.current.push(handlers);
    return () => {
      stack.current = stack.current.filter((h) => h !== handlers);
    };
  }, []);

  const registerTable = useCallback((nav: TableNav) => {
    tables.current.push(nav);
    return () => { tables.current = tables.current.filter((t) => t !== nav); };
  }, []);

  const promoteTable = useCallback((nav: TableNav) => {
    tables.current = [...tables.current.filter((t) => t !== nav), nav];
  }, []);

  const tableMoves = (e: KeyboardEvent): boolean => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'];
    if (!keys.includes(e.key)) return false;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return false;
    const el = e.target as HTMLElement | null;
    if (el && typeof el.closest === 'function') {
      if (el.closest('[data-grid-col]')) return false;
      if (el.closest('.ant-select')) return false;
      if (el.tagName === 'TEXTAREA') return false;
      const inField = el.tagName === 'INPUT' || el.isContentEditable;
      if (inField && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
    }
    for (let i = tables.current.length - 1; i >= 0; i -= 1) {
      const t = tables.current[i];
      if (!t.isLive()) continue;
      const handled = e.key === 'Enter'
        ? t.open()
        : t.move(e.key === 'ArrowUp' ? 'up'
          : e.key === 'ArrowDown' ? 'down'
            : e.key === 'Home' ? 'first' : 'last');
      if (handled) { e.preventDefault(); return true; }
      return false;
    }
    return false;
  };

  const handlerFor = (action: keyof ScreenShortcuts) => {
    for (let i = stack.current.length - 1; i >= 0; i -= 1) {
      const fn = stack.current[i][action];
      if (fn) return fn;
    }
    return undefined;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (enterMovesOn(e)) return;
      if (arrowsMoveLines(e)) return;
      if (tableMoves(e)) return;
      if (isTyping(e)) return;

      if (e.key === 'F1') { e.preventDefault(); setHelpOpen(true); return; }
      if (e.key === 'F4' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); setQuery(''); setPaletteOpen(true); return;
      }

      const fire = (fn?: () => void) => {
        if (!fn) return false;
        e.preventDefault();
        fn();
        return true;
      };
      if (e.key === 'F2' && fire(handlerFor('onNew'))) return;
      if (e.key === 'F2' && pressMarkedButton('F2')) { e.preventDefault(); return; }
      if (e.key === 'F3' && fire(handlerFor('onSearch'))) return;
      if (e.key === 'F9' && fire(handlerFor('onSave'))) return;
      if (e.key === 'F7' && fire(handlerFor('onPrint'))) return;
      if (e.key === 'F8' && fire(handlerFor('onDelete'))) return;
      if (e.key === 'Escape' && fire(handlerFor('onClose'))) return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const screens = useMemo(() => allScreens(), []);
  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return screens.slice(0, 12);
    return screens.filter((s) => s.label.includes(q)).slice(0, 20);
  }, [query, screens]);

  const value = useMemo(
    () => ({ register, registerTable, promoteTable }),
    [register, registerTable, promoteTable],
  );

  return (
    <KeyboardContext.Provider value={value}>
      {children}

      <TabModal
        open={paletteOpen} onCancel={() => setPaletteOpen(false)} footer={null}
        title="اذهب إلى شاشة" width={520} destroyOnHidden
      >
        <Input
          autoFocus placeholder="اكتب اسم الشاشة…" value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={() => {
            const first = matches[0];
            if (first) { setPaletteOpen(false); navigate(first.key); }
          }}
        />
        <List
          size="small" style={{ marginTop: 12, maxHeight: 320, overflowY: 'auto' }}
          dataSource={matches}
          locale={{ emptyText: 'لا توجد شاشة بهذا الاسم' }}
          renderItem={(s) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => { setPaletteOpen(false); navigate(s.key); }}
            >
              {s.label}
            </List.Item>
          )}
        />
      </TabModal>

      <TabModal
        open={helpOpen} onCancel={() => setHelpOpen(false)} footer={null}
        title="اختصارات لوحة المفاتيح" width={480} destroyOnHidden
      >
        <List
          size="small"
          dataSource={[
            { keys: 'F1', label: 'هذه القائمة' },
            { keys: 'F4 أو Ctrl+K', label: 'الانتقال إلى شاشة بالاسم' },
            ...KEY_MAP.map((k) => ({ keys: k.keys, label: k.label })),
            { keys: 'Enter', label: 'الخانة التالية، وفي سطور المستند تفتح نافذة الصنف' },
            { keys: '↑ ↓', label: 'السطر السابق / السطر التالي في جدول المستند ضمن العمود نفسه' },
            { keys: '↑ ↓ في القوائم', label: 'التنقل بين سطور القائمة، ومن خانة البحث إلى النتائج' },
            { keys: 'Enter على سطر', label: 'فتح تفاصيل السطر أو شاشة تعديله' },
            { keys: 'Home / End', label: 'أول سطر / آخر سطر في القائمة' },
          ]}
          renderItem={(row) => (
            <List.Item>
              <Tag color="green" style={{ fontFamily: 'monospace' }}>{row.keys}</Tag>
              <span style={{ flex: 1, textAlign: 'right' }}>{row.label}</span>
            </List.Item>
          )}
        />
      </TabModal>
    </KeyboardContext.Provider>
  );
}

export function useScreenShortcuts(handlers: ScreenShortcuts, enabled = true) {
  const { register } = useContext(KeyboardContext);
  const onScreen = useContext(TabActiveContext);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled || !onScreen) return undefined;
    const proxy: ScreenShortcuts = {
      onNew: () => latest.current.onNew?.(),
      onSave: () => latest.current.onSave?.(),
      onSearch: () => latest.current.onSearch?.(),
      onDelete: () => latest.current.onDelete?.(),
      onPrint: () => latest.current.onPrint?.(),
      onClose: () => latest.current.onClose?.(),
    };
    (Object.keys(proxy) as (keyof ScreenShortcuts)[]).forEach((k) => {
      const src = k as keyof ScreenShortcuts;
      if (!handlers[src]) delete proxy[src];
    });
    return register(proxy);
  }, [enabled, onScreen, register,
    Object.keys(handlers).filter((k) => (handlers as any)[k]).join(',')]);
}

export function nextRowIndex(
  current: number, count: number, to: 'up' | 'down' | 'first' | 'last',
): number {
  if (count <= 0) return -1;
  if (to === 'first') return 0;
  if (to === 'last') return count - 1;
  if (current < 0) return to === 'down' ? 0 : count - 1;
  const next = to === 'down' ? current + 1 : current - 1;
  return next < 0 || next >= count ? -1 : next;
}

let tableSeq = 0;

export function useTableKeyboard<T>({
  rows, onOpen, rowKey, enabled = true,
}: {
  rows: readonly T[];
  onOpen?: (row: T) => void;
  rowKey?: (row: T) => string | number;
  enabled?: boolean;
}) {
  const { registerTable, promoteTable } = useContext(KeyboardContext);
  const onScreen = useContext(TabActiveContext);
  const [activeKey, setActiveKey] = useState<string | number | null>(null);

  const keyOf = useCallback(
    (r: T): string | number => (rowKey ? rowKey(r) : ((r as any)?.id ?? '')),
    [rowKey],
  );

  const latest = useRef({ rows, onOpen, keyOf, activeKey });
  latest.current = { rows, onOpen, keyOf, activeKey };
  const navRef = useRef<TableNav | null>(null);

  const tableId = useRef<string>();
  if (!tableId.current) { tableSeq += 1; tableId.current = `kbt${tableSeq}`; }

  const trFor = (k: string | number): HTMLElement | null => {
    const esc = String(k).replace(/["\\]/g, '\\$&');
    const el = document.querySelector<HTMLElement>(
      `tr[data-kbt="${tableId.current}"][data-row-key="${esc}"]`);
    return el && el.offsetParent !== null ? el : null;
  };

  useEffect(() => {
    if (!enabled || !onScreen) return undefined;
    const nav: TableNav = {
      isLive: () => {
        const { rows: rs, keyOf: k } = latest.current;
        if (!rs.length) return false;
        const tr = trFor(k(rs[0]));
        if (!tr) return false;
        const dialogs = [...document.querySelectorAll<HTMLElement>(
          '.ant-modal-wrap, .ant-drawer-content-wrapper')].filter((d) => d.offsetParent !== null);
        return !dialogs.some((d) => !d.contains(tr));
      },
      move: (to) => {
        const { rows: rs, keyOf: k, activeKey: cur } = latest.current;
        if (!rs.length) return false;
        const keys = rs.map(k);
        const next = nextRowIndex(cur === null ? -1 : keys.indexOf(cur), keys.length, to);
        if (next < 0) return false;
        const key = keys[next];
        setActiveKey(key);
        requestAnimationFrame(() => {
          const tr = trFor(key);
          tr?.focus({ preventScroll: true });
          keepInView(tr);
        });
        return true;
      },
      open: () => {
        const { rows: rs, keyOf: k, activeKey: cur, onOpen: fn } = latest.current;
        if (!fn || cur === null) return false;
        const row = rs.find((r) => k(r) === cur);
        if (!row) return false;
        fn(row);
        return true;
      },
    };
    navRef.current = nav;
    const unregister = registerTable(nav);
    return () => { navRef.current = null; unregister(); };
  }, [enabled, onScreen, registerTable]);

  useEffect(() => {
    if (activeKey === null) return;
    if (!rows.some((r) => keyOf(r) === activeKey)) setActiveKey(null);
  }, [rows, activeKey, keyOf]);

  const onRow = useCallback((row: T) => ({
    onClick: (e: React.MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest(
        'input, textarea, select, button, a, .ant-select, .ant-switch, .ant-picker, .ant-checkbox',
      )) return;
      setActiveKey(keyOf(row));
      if (navRef.current) promoteTable(navRef.current);
      onOpen?.(row);
    },
    tabIndex: -1,
    'data-kbt': tableId.current,
    style: onOpen ? { cursor: 'pointer' as const } : undefined,
  }), [onOpen, keyOf, promoteTable]);

  const rowClassName = useCallback(
    (row: T) => (keyOf(row) === activeKey ? 'row-cursor' : ''),
    [activeKey, keyOf],
  );

  return {
    activeKey,
    setActiveKey,
    onRow,
    rowClassName,
    tableProps: { onRow, rowClassName },
  };
}
