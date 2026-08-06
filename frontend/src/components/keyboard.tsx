import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Modal, Input, List, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { allScreens } from './navigation';

/**
 * Working the whole system from the keyboard.
 *
 * The people using this enter documents all day. A salesman typing forty invoice lines does not
 * want a mouse in the loop, and the system they are coming from does not make them use one — the
 * hand stays on the keyboard from the customer field to the last line to the save. Every reach for
 * the mouse is a second lost forty times an hour, and worse, it breaks the rhythm that makes fast
 * data entry accurate: the eye stays on the paper, not on the screen hunting for a button.
 *
 * The design has three parts:
 *
 * **The keys live here, the meaning lives in the screen.** A screen says «this is what New means
 * for me» and this decides that New is F2. One place to look when the mapping is questioned, and no
 * screen inventing its own key for the same idea — which is how a system ends up where F2 saves on
 * one screen and deletes on another.
 *
 * **Shortcuts are discoverable.** F1 lists everything active right now, including what the current
 * screen registered. A shortcut nobody knows about is a shortcut nobody uses; theirs are undocumented
 * and learned by being shown, which is fine for the person who was shown and useless for the next.
 *
 * **Typing always wins.** A key pressed inside a text box is text, never a command, unless it is a
 * function key or carries a modifier. Anything else and a customer named «فاروق» would trigger
 * whatever F was bound to.
 */

export type ShortcutAction = 'new' | 'save' | 'search' | 'delete' | 'print' | 'close';

export interface ScreenShortcuts {
  onNew?: () => void;
  onSave?: () => void;
  onSearch?: () => void;
  onDelete?: () => void;
  onPrint?: () => void;
  onClose?: () => void;
}

/** The mapping, in one place. Labels are what F1 shows. */
export const KEY_MAP: { action: ShortcutAction; keys: string; label: string }[] = [
  { action: 'new', keys: 'F2', label: 'جديد — يفتح نموذج إضافة في الشاشة المفتوحة' },
  { action: 'search', keys: 'F3', label: 'بحث — يركّز على خانة البحث' },
  { action: 'save', keys: 'F9', label: 'حفظ — يحفظ النموذج المفتوح' },
  { action: 'print', keys: 'F7', label: 'طباعة' },
  { action: 'delete', keys: 'F8', label: 'حذف السطر أو السجل المحدد' },
  { action: 'close', keys: 'Esc', label: 'إغلاق النافذة المفتوحة' },
];

/**
 * A table that has told the keyboard how to walk it. Registered by `useTableKeyboard`.
 *
 * `isLive` is what settles which table gets the arrows when several are mounted at once — a list
 * with a modal over it, or five open tabs. Rather than tracking visibility in React state, each
 * registration is asked whether its rows are on screen right now, which is the only version of that
 * question that cannot go stale.
 */
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

/**
 * Whether the screen reading this is the one on screen.
 *
 * Open tabs stay MOUNTED and are merely `display:none`, which keeps their half-typed forms alive —
 * and means five screens can be registering shortcuts at once. Without this, F2 and Esc went to
 * whichever screen happened to mount last, so Esc «worked» by closing a dialog on a tab nobody was
 * looking at. Defaults to true so a screen rendered outside the tab workspace still keeps its keys.
 */
export const TabActiveContext = createContext(true);

/** True when the key should be treated as text rather than a command. */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  // A keydown can be raised on the document or the window itself, where there is no element to
  // inspect. Guard rather than assume: an exception thrown here kills the whole handler, and every
  // shortcut in the system stops working with no visible cause.
  if (!el || typeof (el as any).closest !== 'function') return false;
  const tag = el.tagName;
  const editable = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    || el.closest('.ant-select') !== null;
  if (!editable) return false;
  // Function keys and modified keys are commands even mid-typing — that is the point of them.
  if (/^F\d+$/.test(e.key)) return false;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  // Escape is never text. Treating it as typing meant «اقفل» did nothing at the one moment anyone
  // presses it — standing in a field, halfway through a form they have changed their mind about.
  if (e.key === 'Escape') return false;
  return true;
}


/** Every control in `container` that a person can land on, in the order they read them.
 *
 * Deliberately DOM order and not tabindex: forms here are laid out in the order the paper form
 * asks its questions, and honouring anything else would send the cursor somewhere the eye is not.
 */
function fieldsIn(container: HTMLElement): HTMLElement[] {
  // An antd Select is a div wrapper (`.ant-select-selector`) around a real `input[role=combobox]`.
  // The wrapper is what you see; the input is what can hold focus. Targeting the wrapper makes
  // `.focus()` a no-op, and the cursor then sticks on the field BEFORE every dropdown — which is
  // exactly how far it got the first time this was written.
  const sel = [
    'input:not([type=hidden]):not([disabled])',
    'textarea:not([disabled]):not([readonly])',
    'select:not([disabled])',
  ].join(',');
  return [...container.querySelectorAll<HTMLElement>(sel)]
    // `readonly` normally means «not a field to land on» — except on a Select without a search
    // box, where antd marks its combobox readonly precisely because you pick rather than type.
    // Excluding those skipped every plain dropdown on the form, which is most of them.
    .filter((el) => !el.hasAttribute('readonly') || el.closest('.ant-select') !== null)
    // Rendered but not on screen — a field inside a collapsed section is not somewhere to land.
    .filter((el) => el.offsetParent !== null || el.closest('.ant-select') !== null);
}

/** The form, modal or drawer the focused control belongs to — the boundary Enter walks inside.
 *
 * Scoped rather than global on purpose: a screen commonly has a filter bar above a table and a
 * modal on top of it, and Enter in the modal must not walk out into the filters behind it. */
function formOf(el: HTMLElement): HTMLElement | null {
  return el.closest('.ant-modal-content, .ant-drawer-body, form') as HTMLElement | null;
}

/**
 * Enter moves to the next field — the habit the old system built and fingers keep.
 *
 * Someone entering documents all day never reaches for the mouse: they type, press Enter, type,
 * press Enter. A form where Enter instead submits half-filled work, or does nothing at all, makes
 * them stop and look down, and that pause is the whole cost of the screen.
 *
 * Returns true when it handled the key.
 */
function enterMovesOn(e: KeyboardEvent): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
  // Somebody already answered this key. A picker that selects the highlighted row on Enter, a
  // search that submits — they call preventDefault and mean it. This listener sits on the window
  // and therefore runs LAST, so without this check it would undo their work by moving focus on
  // afterwards: «اختر الصنف» picked the product and then the cursor walked away from it.
  if (e.defaultPrevented) return false;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;

  // A textarea is where Enter means «new line», and «وصف» is exactly the field people write two
  // lines in. Taking that away to save a keystroke elsewhere is a bad trade.
  if (el.tagName === 'TEXTAREA') return false;
  // On a button — including «حفظ» — Enter is the press, not a move.
  if (el.tagName === 'BUTTON' || el.closest('button')) return false;
  // An open dropdown owns Enter: it is choosing the highlighted option. The move happens on the
  // NEXT Enter, once the choice has been made, which is what picking from a list feels like.
  const select = el.closest('.ant-select');
  if (select && select.classList.contains('ant-select-open')) return false;

  const form = formOf(el);
  if (!form) return false;
  const fields = fieldsIn(form);
  // Focus can sit on the Select's wrapper rather than its input when a click put it there.
  const current = (el.classList.contains('ant-select-selector')
    ? select?.querySelector('input') : el) as HTMLElement | null;
  const i = current ? fields.indexOf(current) : -1;
  if (i === -1) return false;

  e.preventDefault();
  const next = fields[i + 1];
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement && next.type !== 'checkbox') next.select();
    return true;
  }
  // Past the last field, land on the primary button rather than pressing it. Enter again saves,
  // so saving is still one key — but it is never something the form did while you were typing.
  const submit = form.querySelector<HTMLElement>(
    'button[type=submit], .ant-modal-footer .ant-btn-primary, .ant-btn-primary'
  );
  submit?.focus();
  return true;
}


/**
 * Arrows move between the LINES of a document — up a row, down a row, in the same column.
 *
 * Enter walks a form field by field, which is right for a form: its questions have an order. A
 * document's lines are not a form. They are a column of the same question asked twenty times, and
 * the movement anybody actually wants there is up and down — go back to line four because the
 * quantity was wrong, without leaving the keyboard or counting Enters to get there.
 *
 * **The trade this makes.** On a number box, antd binds Up and Down to «+1 / -1». Those keys can
 * only mean one thing, so the line inputs are declared `keyboard={false}` and the arrows are spent
 * on moving instead of stepping. Stepping a quantity by one is worth very little to somebody who
 * types the number anyway; getting back to the wrong line is worth a lot.
 *
 * Left and right are deliberately NOT taken. In a text box they move the caret, and in an RTL
 * screen «the next column to the right» is the PREVIOUS one — a direction that means two different
 * things is worse than a direction that means nothing.
 *
 * A cell opts in with `data-grid-col="<name>"`. Movement is within one table and one column, so a
 * screen with a lines table above a totals table never jumps between them.
 */
function arrowsMoveLines(e: KeyboardEvent): boolean {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.defaultPrevented) return false;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  const cell = el.closest<HTMLElement>('[data-grid-col]');
  if (!cell) return false;
  // An open dropdown owns the arrows: they are moving the highlight through its options.
  const select = cell.closest('.ant-select');
  if (select && select.classList.contains('ant-select-open')) return false;

  // Usually a table. But a lines editor built from `Form.List` is rows of `Col`, not `<tr>`, and
  // looking only for a table left the arrows dead on exactly the screens that needed them most.
  // Widening the boundary is safe because movement is confined to ONE column name: a wider
  // container can only ever reach more cells asking the same question.
  const table = cell.closest('table') || cell.closest('.ant-table')
    || cell.closest('.ant-modal-body') || cell.closest('form')
    || cell.closest('.ant-card-body');
  if (!table) return false;
  const col = cell.getAttribute('data-grid-col');
  const cells = [...table.querySelectorAll<HTMLElement>(`[data-grid-col="${col}"]`)]
    .filter((c) => c.offsetParent !== null);
  const i = cells.indexOf(cell);
  if (i === -1) return false;
  const next = cells[e.key === 'ArrowDown' ? i + 1 : i - 1];
  // At the top or the bottom, do nothing rather than wrap. Wrapping means a held arrow key cycles
  // forever and the line you land on is whichever one you stopped on — silently, twenty rows away.
  if (!next) { e.preventDefault(); return true; }
  e.preventDefault();
  next.focus();
  if (next instanceof HTMLInputElement && next.type !== 'checkbox') next.select();
  return true;
}

/**
 * The last resort: press the button the key is written on.
 *
 * Thirty list screens have a «جديد» button and no way to reach it from the keyboard. Registering a
 * handler on each one means thirty copies of a function that already exists, and every copy is a
 * place where the key and the button can quietly come to mean different things.
 *
 * So the button carries `data-shortcut="F2"` and the key CLICKS IT. There is nothing to keep in
 * sync, because there is only the button. A disabled button ignores `.click()` for free, which is
 * exactly the behaviour wanted — a key that cannot be pressed with the mouse cannot be pressed with
 * the keyboard either.
 *
 * Hidden tabs stay mounted, so a visibility test is what keeps F2 from opening a form on a screen
 * nobody is looking at.
 */
function pressMarkedButton(keys: string): boolean {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-shortcut="${keys}"]`)]
    .filter((el) => el.offsetParent !== null);
  // More than one visible claimant means the screen is ambiguous about what F2 does; the first in
  // reading order is the one at the top of the page, which is where the eye looks for it.
  const el = all[0];
  if (!el) return false;
  el.click();
  return true;
}

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  // A stack, not a single slot: a modal open over a list registers its own handlers and must take
  // the keys until it closes, then hand them back to the list underneath.
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

  /** Clicking a row makes that table the one the arrows belong to, so mouse and keyboard agree
   *  about which of two tables on a screen is being worked in. */
  const promoteTable = useCallback((nav: TableNav) => {
    tables.current = [...tables.current.filter((t) => t !== nav), nav];
  }, []);

  /**
   * ↑ ↓ Home End Enter over a list — the same movement the document lines already have, given to
   * the registers and reports where a row is a thing you open rather than a thing you type in.
   *
   * Runs after `arrowsMoveLines` so a document's line grid always keeps its own arrows, and the
   * topmost LIVE table wins so a modal over a list takes them and hands them back on close.
   */
  const tableMoves = (e: KeyboardEvent): boolean => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'];
    if (!keys.includes(e.key)) return false;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return false;
    const el = e.target as HTMLElement | null;
    if (el && typeof el.closest === 'function') {
      // A document's line cell, an open dropdown and a textarea all own these keys already.
      if (el.closest('[data-grid-col]')) return false;
      if (el.closest('.ant-select')) return false;
      if (el.tagName === 'TEXTAREA') return false;
      const inField = el.tagName === 'INPUT' || el.isContentEditable;
      // From a search box the arrows mean «خلصت فلترة، ودّيني للنتايج» — a habit worth honouring,
      // because filtering then picking is most of what a register is used for. Enter and the jump
      // keys stay with the field: there, Enter is «الخانة اللي بعدها».
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
      // A live table that refuses the key (already at the last row) has still answered it. Falling
      // through to the table underneath would move a list nobody is looking at.
      return false;
    }
    return false;
  };

  /**
   * The nearest screen that implements this action, searching from the top of the stack down.
   *
   * NOT simply the top entry. `useScreenShortcuts` already strips the actions a screen does not
   * implement, saying in as many words that the stack must not swallow a key a screen underneath
   * would have handled — and then the dispatcher only ever read the topmost set, so the stripping
   * did nothing. A search bar that registers F3 alone would have taken F2 away from the list it
   * sits in. Each key now finds its own owner, and the topmost implementer still wins.
   */
  const handlerFor = (action: keyof ScreenShortcuts) => {
    for (let i = stack.current.length - 1; i >= 0; i -= 1) {
      const fn = stack.current[i][action];
      if (fn) return fn;
    }
    return undefined;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Before the typing guard: Enter-to-next-field only ever fires while typing, which is the
      // one case that guard exists to skip.
      if (enterMovesOn(e)) return;
      if (arrowsMoveLines(e)) return;
      // Before the typing guard, so ↓ out of a search box reaches the results it just filtered.
      if (tableMoves(e)) return;
      if (isTyping(e)) return;

      // --- global -------------------------------------------------------------------------
      if (e.key === 'F1') { e.preventDefault(); setHelpOpen(true); return; }
      if (e.key === 'F4' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); setQuery(''); setPaletteOpen(true); return;
      }

      // --- screen -------------------------------------------------------------------------
      const fire = (fn?: () => void) => {
        if (!fn) return false;
        e.preventDefault();
        fn();
        return true;
      };
      if (e.key === 'F2' && fire(handlerFor('onNew'))) return;
      // Only once nothing registered it: a screen that says what New means for it always wins over
      // a button that merely looks like it.
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

  // Every screen in the system, searchable by name — the fastest route to a screen when the menu
  // is seven sections deep.
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

      <Modal
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
          locale={{ emptyText: 'مفيش شاشة بالاسم ده' }}
          renderItem={(s) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => { setPaletteOpen(false); navigate(s.key); }}
            >
              {s.label}
            </List.Item>
          )}
        />
      </Modal>

      <Modal
        open={helpOpen} onCancel={() => setHelpOpen(false)} footer={null}
        title="اختصارات الكيبورد" width={480} destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          الشغل كله ينفع من الكيبورد. الاختصارات دي شغالة في أي شاشة، واللي منها مش متاح في الشاشة
          المفتوحة بيتجاهل.
        </Typography.Paragraph>
        <List
          size="small"
          dataSource={[
            { keys: 'F1', label: 'القائمة دي' },
            { keys: 'F4 أو Ctrl+K', label: 'اذهب إلى شاشة — بحث بالاسم في كل شاشات النظام' },
            ...KEY_MAP.map((k) => ({ keys: k.keys, label: k.label })),
            // The movement keys. They were the two things in here nobody could find out about
            // except by pressing them and noticing — which is the definition of undiscoverable.
            { keys: 'Enter', label: 'الخانة اللي بعدها — وفي سطور المستند: يفتح نافذة الصنف' },
            { keys: '↑ ↓', label: 'سطر فوق / سطر تحت في جدول المستند، في نفس العمود' },
            // The list keys. Same two arrows, different table: in a register they walk the rows
            // rather than the cells, because there a row is a thing you open.
            { keys: '↑ ↓ في القوايم', label: 'يتنقّل بين سطور القايمة — ومن خانة البحث ينزّلك للنتايج' },
            { keys: 'Enter على سطر', label: 'يفتح السطر — تفاصيله أو شاشة تعديله حسب الشاشة' },
            { keys: 'Home / End', label: 'أول سطر / آخر سطر في القايمة' },
          ]}
          renderItem={(row) => (
            <List.Item>
              <Tag color="green" style={{ fontFamily: 'monospace' }}>{row.keys}</Tag>
              <span style={{ flex: 1, textAlign: 'right' }}>{row.label}</span>
            </List.Item>
          )}
        />
      </Modal>
    </KeyboardContext.Provider>
  );
}

/**
 * Declare what the shortcuts mean on this screen.
 *
 * Registered while mounted and removed on unmount, so a modal that opens over a list takes the keys
 * and gives them back when it closes. Handlers are read through a ref, so a screen may pass fresh
 * closures on every render without re-registering on each one.
 */
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
    // Only advertise the actions the screen actually implements, so F1 does not promise a key that
    // does nothing and the stack does not swallow a key a screen underneath would have handled.
    (Object.keys(proxy) as (keyof ScreenShortcuts)[]).forEach((k) => {
      const src = k as keyof ScreenShortcuts;
      if (!handlers[src]) delete proxy[src];
    });
    return register(proxy);
  }, [enabled, onScreen, register,
    Object.keys(handlers).filter((k) => (handlers as any)[k]).join(',')]);
}

/**
 * القايمة تتمشى بالكيبورد، والسطر يفتح.
 *
 * **Why one hook does both.** Two thirds of the tables in this system were dead to the mouse: forty
 * rows of numbers and nothing happens when you click one. Making Enter open a row forces each
 * screen to answer what «open» even means for it — and once that is answered there is no reason the
 * mouse should not get the same answer. So the hook takes ONE `onOpen` and hands back both the
 * click binding and the key binding. They cannot drift apart, because there is only one of them.
 *
 * **The cursor appears only after an arrow key.** A highlighted row shown to somebody who has
 * touched nothing reads as «this one is selected», and the next thing they press is aimed at a row
 * they did not choose.
 *
 * **Focus moves to the row itself.** The row is given `tabIndex=-1` and focused as the cursor
 * moves, which is what makes Enter arrive without the screen having to own a global key handler —
 * and what lets ↓ carry somebody out of a search box and into the results they just filtered.
 *
 * Usage is one line at the call site:
 *
 * ```tsx
 * const kb = useTableKeyboard({ rows, rowKey: (r) => r.id, onOpen: openDoc });
 * <Table {...kb.tableProps} dataSource={rows} />
 * ```
 */
/**
 * Where the cursor lands. Pulled out of the hook so it can be checked directly.
 *
 * The boundaries are the whole of it, and they are the part that is wrong when this kind of thing
 * is wrong: what ↓ does from nowhere, what ↑ does from nowhere, and what either does at the end of
 * the list. Returns -1 for «don't move», so a held arrow key stops at the last row instead of
 * wrapping round — wrapping means the row you land on is whichever one you happened to stop on,
 * silently, twenty rows away.
 */
export function nextRowIndex(
  current: number, count: number, to: 'up' | 'down' | 'first' | 'last',
): number {
  if (count <= 0) return -1;
  if (to === 'first') return 0;
  if (to === 'last') return count - 1;
  // From nowhere, the direction pressed is the end it comes in from: ↓ starts at the top, ↑ at the
  // bottom. Starting both at the top would make ↑ on a fresh list move DOWN.
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
  /** Must match the Table's own `rowKey`, since the row is found in the DOM by it. */
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

  // Read through refs so the registration survives every render — `rows` is a fresh array each
  // time, and re-registering on that would put this table back on top of the stack constantly,
  // stealing the arrows from a modal open over it.
  const latest = useRef({ rows, onOpen, keyOf, activeKey });
  latest.current = { rows, onOpen, keyOf, activeKey };
  const navRef = useRef<TableNav | null>(null);

  // Stamped on every row so this table can find its OWN rows. Without it a screen showing two
  // lists would match the first `tr[data-row-key="3"]` in the document, and the cursor would appear
  // to move in one table while Enter opened a row from the other.
  const tableId = useRef<string>();
  if (!tableId.current) { tableSeq += 1; tableId.current = `kbt${tableSeq}`; }

  /** The rendered `<tr>` for a key. antd stamps `data-row-key`, so no ref plumbing is needed. */
  const trFor = (k: string | number): HTMLElement | null => {
    const esc = String(k).replace(/["\\]/g, '\\$&');
    const el = document.querySelector<HTMLElement>(
      `tr[data-kbt="${tableId.current}"][data-row-key="${esc}"]`);
    return el && el.offsetParent !== null ? el : null;
  };

  useEffect(() => {
    if (!enabled || !onScreen) return undefined;
    const nav: TableNav = {
      // Live means «my rows are on screen right now». A hidden tab stays mounted, so asking React
      // would answer yes; asking the DOM answers what the person is actually looking at.
      isLive: () => {
        const { rows: rs, keyOf: k } = latest.current;
        if (!rs.length) return false;
        const tr = trFor(k(rs[0]));
        if (!tr) return false;
        // An open dialog owns the keys. The list behind it is still on screen and still passes the
        // visibility test — «مفتوح» and «مرئي» are not the same thing — so without this, ↓ walks a
        // register the reader cannot see while they are reading the document they opened from it.
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
        // After the row re-renders with the cursor class, not before it.
        requestAnimationFrame(() => {
          const tr = trFor(key);
          tr?.focus({ preventScroll: true });
          tr?.scrollIntoView({ block: 'nearest' });
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

  // Kept in range as the list is filtered underneath the cursor — a cursor pointing at a row that
  // was filtered away makes Enter open nothing with no visible reason why.
  useEffect(() => {
    if (activeKey === null) return;
    if (!rows.some((r) => keyOf(r) === activeKey)) setActiveKey(null);
  }, [rows, activeKey, keyOf]);

  const onRow = useCallback((row: T) => ({
    onClick: (e: React.MouseEvent) => {
      // A click on something inside the row that already means something — a quantity box, a
      // «إلغاء» button, a link to the customer — is that thing's click, not the row's. Without
      // this, typing into the count box on the stocktake opens the movement log every time, and
      // the row swallows the one control the screen exists for.
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest(
        'input, textarea, select, button, a, .ant-select, .ant-switch, .ant-picker, .ant-checkbox',
      )) return;
      // The click puts the cursor where the mouse is, so a following ↓ carries on from the row
      // just clicked rather than from wherever the keyboard was left.
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
    /** Spread onto the Table: `<Table {...kb.tableProps} />`. */
    tableProps: { onRow, rowClassName },
  };
}
