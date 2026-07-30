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

interface KeyboardContextValue {
  register: (handlers: ScreenShortcuts) => () => void;
}

const KeyboardContext = createContext<KeyboardContextValue>({ register: () => () => {} });

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

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  // A stack, not a single slot: a modal open over a list registers its own handlers and must take
  // the keys until it closes, then hand them back to the list underneath.
  const stack = useRef<ScreenShortcuts[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState('');

  const register = useCallback((handlers: ScreenShortcuts) => {
    stack.current.push(handlers);
    return () => {
      stack.current = stack.current.filter((h) => h !== handlers);
    };
  }, []);

  const top = () => stack.current[stack.current.length - 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Before the typing guard: Enter-to-next-field only ever fires while typing, which is the
      // one case that guard exists to skip.
      if (enterMovesOn(e)) return;
      if (isTyping(e)) return;
      const handlers = top();

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
      if (e.key === 'F2' && fire(handlers?.onNew)) return;
      if (e.key === 'F3' && fire(handlers?.onSearch)) return;
      if (e.key === 'F9' && fire(handlers?.onSave)) return;
      if (e.key === 'F7' && fire(handlers?.onPrint)) return;
      if (e.key === 'F8' && fire(handlers?.onDelete)) return;
      if (e.key === 'Escape' && fire(handlers?.onClose)) return;
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

  const value = useMemo(() => ({ register }), [register]);

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
