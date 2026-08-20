import React, { useMemo } from 'react';
import { Tooltip } from 'antd';
import { KEY_MAP, ShortcutAction, ScreenShortcuts, useScreenShortcuts } from './keyboard';

/**
 * شريط أدوات المستند — the strip of actions across the top of a document screen.
 *
 * Modelled on the toolbar of the DOS-era system this client has used for years: one row, icon
 * above a word, the same verbs in the same places on every document — جديد · تعديل · تراجع · حفظ ·
 * التالى · بحث · السابق · حذف · طباعة. People who have driven that system for a decade reach for
 * a position, not a menu, and the position is what is being reproduced here.
 *
 * Two things it keeps from that design and one it does not:
 *
 * **Disabled, not hidden.** Their حفظ greys out when there is nothing to save; it does not vanish.
 * A button that disappears makes the row shift and the next one land where the eye expected the
 * last — which is how a practised hand deletes something it meant to print.
 *
 * **The key is on the button, and the button IS the key.** Each action shows its F-key in the
 * tooltip — and the toolbar registers that key itself, wired to the same `onClick` the button
 * calls. Before this the tooltips advertised F2 · F9 · F7 on every document screen in the system
 * and not one of them was bound to anything: the toolbar promised a keyboard the keyboard never
 * had. Binding here rather than in each screen also means the two can never drift, because there
 * is only one of them.
 *
 * **Colour is ours.** Their icons are the 16-colour palette of the machine they were drawn on. The
 * layout carries over; the paint does not.
 */

export interface ToolbarAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  /** Greyed rather than removed — the row must not move under the hand. */
  disabled?: boolean;
  /** Shown in the tooltip, e.g. «F9». */
  shortcut?: string;
  danger?: boolean;
}

/** «F9» as written on the button → the action the keyboard knows it by. */
const BY_KEYS: Record<string, ShortcutAction> = Object.fromEntries(
  KEY_MAP.map((k) => [k.keys.toLowerCase(), k.action]));

export default function DocumentToolbar({ actions }: { actions: ToolbarAction[] }) {
  const handlers = useMemo(() => {
    const out: ScreenShortcuts = {};
    actions.forEach((a) => {
      // A greyed button does nothing when clicked, so its key must do nothing when pressed — and
      // must not be registered at all, or it would swallow the key from a screen underneath that
      // could have answered it.
      if (a.disabled || !a.onClick || !a.shortcut) return;
      const action = BY_KEYS[a.shortcut.trim().toLowerCase()];
      if (!action) return;
      const slot = `on${action[0].toUpperCase()}${action.slice(1)}` as keyof ScreenShortcuts;
      // First writer wins: a toolbar showing two «حفظ» is a mistake, and the left-most is the one
      // the eye and the finger both reach for.
      if (!out[slot]) out[slot] = a.onClick;
    });
    return out;
  }, [actions]);
  useScreenShortcuts(handlers);

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 6px', marginBottom: 8,
        background: '#f6faf3', border: '1px solid #e2ede0', borderRadius: 8,
      }}
    >
      {actions.map((a) => {
        const dim = a.disabled;
        return (
          <Tooltip key={a.key} title={a.shortcut ? `${a.label} — ${a.shortcut}` : a.label}>
            {/* A plain button, not antd's: the shape here is icon-over-label in a fixed-width
                cell, which is what makes the positions memorable. */}
            <button
              type="button"
              disabled={dim}
              onClick={a.onClick}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                minWidth: 58, padding: '3px 8px', border: '1px solid transparent',
                borderRadius: 6, background: 'transparent',
                cursor: dim ? 'default' : 'pointer',
                color: dim ? '#bfbfbf' : (a.danger ? '#cf1322' : '#2f4f2f'),
                font: 'inherit', lineHeight: 1.2,
              }}
              onMouseEnter={(e) => {
                if (!dim) {
                  e.currentTarget.style.background = '#e8f4e3';
                  e.currentTarget.style.borderColor = '#cfe3c9';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              <span style={{ fontSize: 16, display: 'block', lineHeight: 1.2 }}>{a.icon}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{a.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
