import React from 'react';
import { Button, Checkbox, Dropdown, Space } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

/**
 * اعدادات الواجهة — let each user hide the columns they never read.
 *
 * A document table that has to serve a salesman, a storekeeper and an accountant ends up with
 * every column all three of them might want, and then none of them can read it. Rather than
 * argue about which columns are "the right ones", each person turns off what they don't use.
 *
 * The choice is per screen and per browser (localStorage), deliberately: it is a preference about
 * reading, not data about the business, and putting it on the server would mean a migration and a
 * settings screen for something a click already solves. It also means one user's tidy-up never
 * changes what a colleague sees.
 */

export interface ColumnChoice {
  key: string;
  title: string;
  /** Columns the table cannot be read without — offered but never hideable. */
  locked?: boolean;
}

/** Reads the saved choice for a screen. Unknown keys default to visible, so a column added in a
 *  later release shows up instead of silently staying hidden for everyone who used the old one. */
export function useHiddenColumns(storageKey: string, defaultHidden: string[] = []) {
  const full = `cols:${storageKey}`;
  const [hidden, setHidden] = React.useState<string[]>(() => {
    try {
      // No stored preference means the table has never been tuned, so the defaults apply. A
      // stored `[]` is a real choice — somebody turned everything ON — and is left alone.
      const saved = localStorage.getItem(full);
      return saved === null ? defaultHidden : JSON.parse(saved);
    } catch {
      return defaultHidden;
    }
  });

  const update = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(full, JSON.stringify(next));
    } catch {
      /* a browser with storage disabled just loses the preference, not the table */
    }
  };

  /** Drop the hidden ones from a column list, keeping order. */
  const apply = <T extends { key?: React.Key; dataIndex?: any }>(columns: T[]): T[] =>
    columns.filter((c) => {
      const key = String(c.key ?? c.dataIndex ?? '');
      return !hidden.includes(key);
    });

  return { hidden, setHidden: update, apply };
}

interface Props {
  choices: ColumnChoice[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}

export default function ColumnSettings({ choices, hidden, onChange }: Props) {
  const toggle = (key: string, show: boolean) =>
    onChange(show ? hidden.filter((k) => k !== key) : [...hidden, key]);

  return (
    <Dropdown
      trigger={['click']}
      dropdownRender={() => (
        <div style={{
          background: '#fff', padding: 12, borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: '60vh', overflowY: 'auto',
        }}>
          <div style={{ fontSize: 12, color: '#8a8a8a', marginBottom: 8 }}>
            الأعمدة الظاهرة
          </div>
          <Space direction="vertical">
            {choices.map((c) => (
              <Checkbox
                key={c.key}
                disabled={c.locked}
                checked={!hidden.includes(c.key)}
                onChange={(e) => toggle(c.key, e.target.checked)}
              >
                {c.title}
              </Checkbox>
            ))}
          </Space>
          <div style={{ marginTop: 10 }}>
            <Button size="small" onClick={() => onChange([])}>إظهار الكل</Button>
          </div>
        </div>
      )}
    >
      {/* Never shrink. It sits beside headings and toolbars that take `flex: 1`, and a squeezed
          button loses its label first and then itself — which is how it ended up half off-screen
          with only the gear showing. */}
      <Button icon={<SettingOutlined />} style={{ flexShrink: 0 }}>الأعمدة</Button>
    </Dropdown>
  );
}
