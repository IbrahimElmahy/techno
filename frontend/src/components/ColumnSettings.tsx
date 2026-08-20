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

  const persist = (next: StoredPrefs) => {
    try {
      localStorage.setItem(full, JSON.stringify(next));
    } catch {
      /* a browser with storage disabled just loses the preference, not the table */
    }
    return next;
  };

  const save = (next: StoredPrefs) => {
    setPrefs(persist(next));
  };

  /**
   * زي `save` بس بيبني الجديد من اللي قبله — للضغطات المتتالية.
   *
   * Clicking the arrow three times quickly moved the column ONE step: React batches the three
   * renders, so all three handlers read the same `prefs` from their closure and each computed the
   * same single move from the same starting order. Reading the previous value inside the updater
   * makes each click build on the one before it, which is what somebody holding the button means.
   */
  const update = (fn: (prev: StoredPrefs) => StoredPrefs) => {
    setPrefs((prev) => persist(fn(prev)));
  };

  const setHidden = (hidden: string[]) => save({ ...prefs, hidden });

  /** حرّك عمود خطوة لفوق أو لتحت — من جوّه النافذة، فيسه ما اللي مرتّبه. */
  const move = (key: string, direction: -1 | 1, allKeys: string[]) => update((prev) => {
    // The working order is the CURRENT rendered order — saved ranks first, then the unranked
    // tail in the author's order — never a bare `prev.order`, which for an untouched table is
    // empty and would make the very first drag jump the column to one end.
    const current = orderKeys(allKeys, prev.order);
    const i = current.indexOf(key);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= current.length) return prev;
    [current[i], current[j]] = [current[j], current[i]];
    return { ...prev, order: current };
  });

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
          <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 8 }}>
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

/**
 * سطر واحد بيدّي الجدول أعمدته والزرار بتاعه.
 *
 * The hook and the dropdown are the engine, but adopting them still meant a dozen lines per table:
 * derive the keys, build the `choices` array, wire `hidden`/`order`/`onMove`, then remember to run
 * `apply` on the columns. Written out at every table that is a dozen lines to get subtly wrong
 * forty times over — and the one that is easiest to forget is `apply`, which fails silently: the
 * dropdown works, the user hides a column, and the table ignores it.
 *
 * So the wiring lives here once. A screen says which table it is and what it must not lose, and
 * gets back the columns to render and the control to drop in the toolbar.
 *
 *     const cols = useTableColumns('customers', columns, { locked: ['name'] });
 *     …
 *     extra={<Space>{cols.control}<Button…/></Space>}
 *     <Table columns={cols.columns} … />
 *
 * `storageKey` names the TABLE, not the screen — a page with two tables needs two keys, or the two
 * of them fight over one saved arrangement.
 */
export function useTableColumns<T extends { key?: React.Key; dataIndex?: any; title?: any }>(
  storageKey: string,
  columns: T[],
  opts: { defaultHidden?: string[]; locked?: string[] } = {},
) {
  const prefs = useHiddenColumns(storageKey, opts.defaultHidden);
  const keyOf = (c: T) => String(c.key ?? c.dataIndex ?? '');
  const allKeys = columns.map(keyOf);
  // Nothing otherwise stops somebody unticking every column and being left with a table of blank
  // rows and no way back except «إظهار الكل» — which is not obvious when there is nothing on screen
  // to read. The first column is the row's own identity on essentially every table here, so it
  // anchors by default; a screen whose first column is not that says so itself.
  const locked = opts.locked ?? allKeys.slice(0, 1);

  const control = (
    <ColumnSettings
      choices={columns.map((c) => ({
        key: keyOf(c),
        // An «إجراءات» column's title is usually a node, not a word; the list still has to name it.
        title: typeof c.title === 'string' && c.title ? c.title : 'إجراءات',
        locked: locked.includes(keyOf(c)),
      }))}
      hidden={prefs.hidden}
      onChange={prefs.setHidden}
      order={prefs.order}
      onMove={(k, d) => prefs.move(k, d, allKeys)}
    />
  );

  return { ...prefs, columns: prefs.apply(columns), control };
}
