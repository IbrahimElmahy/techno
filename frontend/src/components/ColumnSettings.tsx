import React from 'react';
import { Button, Checkbox, Dropdown, Space } from 'antd';
import { SettingOutlined, HolderOutlined } from '@ant-design/icons';
import ExportExcelButton, { type ExcelExport } from './ExportExcelButton';

export interface ColumnChoice {
  key: string;
  title: string;
  locked?: boolean;
}

interface StoredPrefs {
  hidden: string[];
  order?: string[];
}

function load(key: string, defaultHidden: string[]): StoredPrefs {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return { hidden: defaultHidden, order: undefined };
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) return { hidden: parsed, order: undefined };
    return { hidden: parsed.hidden ?? defaultHidden, order: parsed.order };
  } catch {
    return { hidden: defaultHidden, order: undefined };
  }
}

export function useHiddenColumns(storageKey: string, defaultHidden: string[] = []) {
  const full = `cols:${storageKey}`;
  const [prefs, setPrefs] = React.useState<StoredPrefs>(() => load(full, defaultHidden));

  const persist = (next: StoredPrefs) => {
    try {
      localStorage.setItem(full, JSON.stringify(next));
    } catch {
    }
    return next;
  };

  const save = (next: StoredPrefs) => {
    setPrefs(persist(next));
  };

  const update = (fn: (prev: StoredPrefs) => StoredPrefs) => {
    setPrefs((prev) => persist(fn(prev)));
  };

  const setHidden = (hidden: string[]) => save({ ...prefs, hidden });

  const move = (key: string, direction: -1 | 1, allKeys: string[]) => update((prev) => {
    const current = orderKeys(allKeys, prev.order);
    const i = current.indexOf(key);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= current.length) return prev;
    [current[i], current[j]] = [current[j], current[i]];
    return { ...prev, order: current };
  });

  const reset = () => save({ hidden: [], order: undefined });

  const apply = <T extends { key?: React.Key; dataIndex?: any }>(columns: T[]): T[] => {
    const keyOf = (c: T, idx: number) => String(c.key ?? c.dataIndex ?? `__col_${idx}__`);
    const decorated = columns.map((c, idx) => ({ col: c, key: keyOf(c, idx) }));
    const visible = decorated.filter(({ key }) => !prefs.hidden.includes(key));
    const rankedKeys = orderKeys(visible.map(({ key }) => key), prefs.order);
    const byKey = new Map(visible.map(({ key, col }) => [key, col]));
    return rankedKeys.map((k) => byKey.get(k)!).filter(Boolean);
  };

  return { hidden: prefs.hidden, order: prefs.order, setHidden, move, reset, apply };
}

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
  order?: string[];
  onMove?: (key: string, direction: -1 | 1) => void;
  onResetOrder?: () => void;
  onResetWidths?: () => void;
}

export default function ColumnSettings({
  choices, hidden, onChange, order, onMove, onResetOrder, onResetWidths,
}: Props) {
  const toggle = (key: string, show: boolean) =>
    onChange(show ? hidden.filter((k) => k !== key) : [...hidden, key]);
  const [dragKey, setDragKey] = React.useState<string | null>(null);
  const [overKey, setOverKey] = React.useState<string | null>(null);
  const dropOn = (targetKey: string) => {
    if (!onMove || !dragKey || dragKey === targetKey) return;
    const from = ranked.indexOf(dragKey);
    const to = ranked.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const dir: -1 | 1 = to > from ? 1 : -1;
    for (let n = 0; n < Math.abs(to - from); n += 1) onMove(dragKey, dir);
  };

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
          <div style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 8, fontWeight: 600 }}>
            الأعمدة الظاهرة{onMove ? ' وترتيبها' : ''}
          </div>
          <Space direction="vertical" style={{ width: '100%' }}>
            {rows.map((c) => (
              <div key={c.key}
                draggable={!!onMove}
                onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { if (dragKey) { e.preventDefault(); setOverKey(c.key); } }}
                onDragLeave={() => setOverKey((k) => (k === c.key ? null : k))}
                onDrop={(e) => { e.preventDefault(); dropOn(c.key); setDragKey(null); setOverKey(null); }}
                onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, padding: '2px 4px', borderRadius: 6,
                  background: overKey === c.key && dragKey !== c.key ? '#eaf5e2' : undefined,
                  borderTop: overKey === c.key && dragKey !== c.key ? '2px solid #6AB42D' : '2px solid transparent',
                  opacity: dragKey === c.key ? 0.5 : 1 }}>
                <Checkbox
                  checked={!hidden.includes(c.key)}
                  onChange={(e) => toggle(c.key, e.target.checked)}
                >
                  {c.title}
                </Checkbox>
                {onMove && (
                  <HolderOutlined title="اسحب لتغيير الترتيب"
                    style={{ cursor: 'grab', color: '#555b65', fontSize: 15 }} />
                )}
              </div>
            ))}
          </Space>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 6, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
            <Button size="small" type="primary" ghost onClick={() => { onChange([]); if (onResetOrder) onResetOrder(); }}>
              إظهار الكل
            </Button>
            {onResetOrder && (
              <Button size="small" onClick={onResetOrder}>
                استعادة الترتيب
              </Button>
            )}
            {onResetWidths && (
              <Button size="small" onClick={onResetWidths}>
                إعادة العرض الافتراضي
              </Button>
            )}
          </div>
        </div>
      )}
    >
      <Button icon={<SettingOutlined />} style={{ flexShrink: 0 }}>الأعمدة</Button>
    </Dropdown>
  );
}

export function useTableColumns<T extends { key?: React.Key; dataIndex?: any; title?: any }>(
  storageKey: string,
  columns: T[],
  opts: { defaultHidden?: string[]; locked?: string[]; export?: ExcelExport } = {},
) {
  const prefs = useHiddenColumns(storageKey, opts.defaultHidden);
  const keyOf = (c: T, idx: number) => String(c.key ?? c.dataIndex ?? `__col_${idx}__`);
  const allKeys = columns.map((c, idx) => keyOf(c, idx));
  const locked = opts.locked ?? allKeys.slice(0, 1);
  const visible = prefs.apply(columns);

  const control = (
    <>
      <ColumnSettings
        choices={columns.map((c, idx) => ({
          key: keyOf(c, idx),
          title: typeof c.title === 'string' && c.title ? c.title : 'إجراءات',
          locked: locked.includes(keyOf(c, idx)),
        }))}
        hidden={prefs.hidden}
        onChange={prefs.setHidden}
        order={prefs.order}
        onMove={(k, d) => prefs.move(k, d, allKeys)}
        onResetOrder={prefs.reset}
      />
      {opts.export && (
        <ExportExcelButton {...opts.export} tableColumns={visible as any} />
      )}
    </>
  );

  return { ...prefs, columns: visible, control };
}
