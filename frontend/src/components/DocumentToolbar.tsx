import React, { useMemo } from 'react';
import { Button, Tooltip } from 'antd';
import { KEY_MAP, ShortcutAction, ScreenShortcuts, useScreenShortcuts } from './keyboard';

export interface ToolbarAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  shortcut?: string;
  danger?: boolean;
  primary?: boolean;
}

const BY_KEYS: Record<string, ShortcutAction> = Object.fromEntries(
  KEY_MAP.map((k) => [k.keys.toLowerCase(), k.action]));

export default function DocumentToolbar({ actions, inline = false, variant = 'plain' }: {
  actions: ToolbarAction[];
  inline?: boolean;
  variant?: 'plain' | 'buttons';
}) {
  const handlers = useMemo(() => {
    const out: ScreenShortcuts = {};
    actions.forEach((a) => {
      if (a.disabled || !a.onClick || !a.shortcut) return;
      const action = BY_KEYS[a.shortcut.trim().toLowerCase()];
      if (!action) return;
      const slot = `on${action[0].toUpperCase()}${action.slice(1)}` as keyof ScreenShortcuts;
      if (!out[slot]) out[slot] = a.onClick;
    });
    return out;
  }, [actions]);
  useScreenShortcuts(handlers);

  if (variant === 'buttons') {
    return (
      <div className="doc-toolbar-buttons"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {actions.map((a) => (
          <Tooltip key={a.key} title={a.shortcut ? `${a.label} — ${a.shortcut}` : undefined}>
            <Button size="small" icon={a.icon} disabled={a.disabled} onClick={a.onClick}
              type={a.primary ? 'primary' : 'default'} danger={a.danger}
              className={a.primary ? 'doc-tb-primary' : undefined}
              style={{ fontWeight: 600, fontSize: 14 }}>
              {a.label}
            </Button>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 2, padding: inline ? 0 : '2px 4px',
        marginBottom: inline ? 0 : 6,
        background: inline ? 'transparent' : '#f6faf3',
        border: inline ? 'none' : '1px solid #e2ede0', borderRadius: 8,
      }}
    >
      {actions.map((a) => {
        const dim = a.disabled;
        return (
          <Tooltip key={a.key} title={a.shortcut ? `${a.label} — ${a.shortcut}` : a.label}>
            <button
              type="button"
              disabled={dim}
              onClick={a.onClick}
              style={{
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4,
                padding: '2px 8px', border: '1px solid transparent',
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
              <span style={{ fontSize: 15, display: 'block', lineHeight: 1 }}>{a.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{a.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
