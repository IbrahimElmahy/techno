import React from 'react';
import { Button, Checkbox, Dropdown, Space } from 'antd';
import { SettingOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

/**
 * اعدادات الأعمدة — إظهار / إخفاء وترتيب، في مكان واحد.
 *
 * A document table that has to serve a salesman, a storekeeper and an accountant ends up with
 * every column all three of them might want, and then none of them can read it — one person's
 * five columns are buried among another's twenty. Rather than argue about "the right columns" or
 * "the right order", each person tunes both for themselves.
 *
 * One engine, used everywhere a table needs this — `useHiddenColumns` and `<ColumnSettings>` are
 * the whole thing. A screen adopts them by calling the hook and rendering the component; nothing
 * about hiding or reordering is ever written twice. This file used to do only hiding — order was
 * added here, in the same hook and the same dropdown, rather than as a second mechanism a page
 * would have to wire up separately.
 *
 * The choice is per screen and per browser (localStorage), deliberately: it is a preference about
 * reading, not data about the business, and putting it on the server would mean a migration and a
 * settings screen for something a click already solves. It also means one user's tidy-up never
 * changes what a colleague sees.
 */

export interface ColumnChoice {
  key: string;
  title: string;
  /** Columns the table cannot be read without — offered but never hideable, and not reorderable:
   *  a locked column anchors the table (usually the row's own identity), and letting it wander
   *  would make «الصف ده» mean a different column depending on who is looking. */
  locked?: boolean;
}

interface StoredPrefs {
  hidden: string[];
  /** Keys in the order the user wants them shown. Missing entirely on anything saved before
   *  reordering existed, and partial on a screen that later grew a column nobody has ranked yet —
   *  both read as "unranked, keep the author's order" rather than as an error. */
  order?: string[];
}

function load(key: string, defaultHidden: string[]): StoredPrefs {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return { hidden: defaultHidden, order: undefined };
    const parsed = JSON.parse(saved);
    // Before reordering existed, the stored value WAS the hidden array — `["notes", "rep_id"]`,
    // not `{hidden: [...]}`. Reading that shape as `{hidden: undefined}` would silently show every
    // column again for everybody who had already tuned a screen.
    if (Array.isArray(parsed)) return { hidden: parsed, order: undefined };
    return { hidden: parsed.hidden ?? defaultHidden, order: parsed.order };
  } catch {
    return { hidden: defaultHidden, order: undefined };
  }
}

/**
 * تفضيلات جدول واحد — الأعمدة المخفية وترتيبها، محفوظين مع بعض.
 *
 * `apply(columns)` does both in one pass: drops what is hidden, then places what remains in the
 * saved order — unranked columns (new ones, or prefs saved before ordering existed) keep the
 * author's original order and sort AFTER anything the user has explicitly ranked, so a column
 * added later does not jump to the front of a table someone already arranged.
 */
export function useHiddenColumns(storageKey: string, defaultHidden: string[] = []) {
  const full = `cols:${storageKey}`;
  const [prefs, setPrefs] = React.useState<StoredPrefs>(() => load(full, defaultHidden));

  const save = (next: StoredPrefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(full, JSON.stringify(next));
    } catch {
      /* a browser with storage disabled just loses the preference, not the table */
    }
  };

  const setHidden = (hidden: string[]) => save({ ...prefs, hidden });

  /** حرّك عمود خطوة لفوق أو لتحت — من جوّه النافذة، فيسه ما اللي مرتّبه. */
  const move = (key: string, direction: -1 | 1, allKeys: string[]) => {
    // The working order is the CURRENT rendered order — saved ranks first, then the unranked
    // tail in the author's order — never a bare `prefs.order`, which for an untouched table is
    // empty and would make the very first drag jump the column to one end.
    const current = orderKeys(allKeys, prefs.order);
    const i = current.indexOf(key);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= current.length) return;
    [current[i], current[j]] = [current[j], current[i]];
    save({ ...prefs, order: current });
  };

  const reset = () => save({ hidden: [], order: undefined });

  const apply = <T extends { key?: React.Key; dataIndex?: any }>(columns: T[]): T[] => {
    const keyOf = (c: T) => String(c.key ?? c.dataIndex ?? '');
    const visible = columns.filter((c) => !prefs.hidden.includes(keyOf(c)));
    const ranked = orderKeys(visible.map(keyOf), prefs.order);
    const byKey = new Map(visible.map((c) => [keyOf(c), c]));
    return ranked.map((k) => byKey.get(k)!).filter(Boolean);
  };

  return { hidden: prefs.hidden, order: prefs.order, setHidden, move, reset, apply };
}

/** الترتيب الفعلي: اللي اتصنّف الأول بالترتيب اللي اتحفظ، وبعده الباقي بترتيبهم الأصلي. */
export function orderKeys(allKeys: string[], saved: string[] | undefined): string[] {
  if (!saved || !saved.length) return [...allKeys];
  const known = new Set(allKeys);
  const ranked = saved.filter((k) => known.has(k));
  const rankedSet = new Set(ranked);
  const rest = allKeys.filter((k) => !rankedSet.has(k));
  return [...ranked, ...rest];
}

interface Props {
  choices: ColumnChoice[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  /** بيفعّل قسم الترتيب. سيبها فاضية على أي جدول لسه بس بيخفي/يظهر. */
  order?: string[];
  onMove?: (key: string, direction: -1 | 1) => void;
}

export default function ColumnSettings({ choices, hidden, onChange, order, onMove }: Props) {
  const toggle = (key: string, show: boolean) =>
    onChange(show ? hidden.filter((k) => k !== key) : [...hidden, key]);

  // Rendered rank order, same rule the hook applies to the table itself — so the list in the
  // dropdown reads top-to-bottom exactly like the columns read right-to-left.
  const ranked = onMove ? orderKeys(choices.map((c) => c.key), order) : choices.map((c) => c.key);
  const byKey = new Map(choices.map((c) => [c.key, c]));
  const rows = ranked.map((k) => byKey.get(k)).filter((c): c is ColumnChoice => !!c);

  return (
    <Dropdown
      trigger={['click']}
      dropdownRender={() => (
        <div style={{
          background: '#fff', padding: 12, borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: '60vh', overflowY: 'auto',
          minWidth: 220,
        }}>
          <div style={{ fontSize: 12, color: '#8a8a8a', marginBottom: 8 }}>
            الأعمدة الظاهرة{onMove ? ' وترتيبها' : ''}
          </div>
          <Space direction="vertical" style={{ width: '100%' }}>
            {rows.map((c, i) => (
              <div key={c.key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8 }}>
                <Checkbox
                  disabled={c.locked}
                  checked={!hidden.includes(c.key)}
                  onChange={(e) => toggle(c.key, e.target.checked)}
                >
                  {c.title}
                </Checkbox>
                {/* Locked columns anchor the table and do not move — moving the row's own
                    identity would make «الصف ده» ambiguous. */}
                {onMove && !c.locked && (
                  <Space size={0}>
                    <Button type="text" size="small" icon={<ArrowUpOutlined />}
                      disabled={i === 0 || rows[i - 1]?.locked}
                      onClick={() => onMove(c.key, -1)} />
                    <Button type="text" size="small" icon={<ArrowDownOutlined />}
                      disabled={i === rows.length - 1}
                      onClick={() => onMove(c.key, 1)} />
                  </Space>
                )}
              </div>
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
