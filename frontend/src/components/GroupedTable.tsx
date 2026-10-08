import React, { useMemo, useState } from 'react';
import { Collapse, Table, Tag } from 'antd';
import type { TableProps } from 'antd';

export interface GroupDef<T> {
  value: string;
  label: string;
  of: (row: T) => { key: string; label: string } | null;
  sum?: (row: T) => number;
}

const UNSET = '__none__';

export default function GroupedTable<T extends object>({
  groupBy, groups, dataSource, rowKey, money, ...table
}: {
  groupBy?: string | null;
  groups: GroupDef<T>[];
  dataSource: T[];
  rowKey: string | ((row: T) => React.Key);
  money?: (v: number) => string;
} & Omit<TableProps<T>, 'dataSource' | 'rowKey'>) {
  const def = groups.find((g) => g.value === groupBy);

  const buckets = useMemo(() => {
    if (!def) return [];
    const out = new Map<string, { label: string; rows: T[]; total: number }>();
    for (const row of dataSource || []) {
      const hit = def.of(row) || { key: UNSET, label: '— بدون —' };
      const bucket = out.get(hit.key)
        || { label: hit.label, rows: [] as T[], total: 0 };
      bucket.rows.push(row);
      if (def.sum) bucket.total += Number(def.sum(row)) || 0;
      out.set(hit.key, bucket);
    }
    return [...out.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length);
  }, [def, dataSource]);

  const fmt = money || ((v: number) =>
    v.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const [openKeys, setOpenKeys] = useState<string[] | null>(null);
  const defaultOpen = buckets.length <= 6 ? buckets.map(([k]) => k) : [];

  if (!def) {
    return <Table<T> {...table} rowKey={rowKey as any} dataSource={dataSource} />;
  }

  return (
    <Collapse
      activeKey={openKeys ?? defaultOpen}
      onChange={(keys) => setOpenKeys(Array.isArray(keys) ? keys : [keys as string])}
      items={buckets.map(([key, bucket]) => ({
        key,
        label: (
          <span>
            <b>{bucket.label}</b>
            <Tag style={{ marginInlineStart: 8 }}>{bucket.rows.length}</Tag>
            {def.sum && <Tag color="blue">{fmt(bucket.total)}</Tag>}
          </span>
        ),
        children: (
          <Table<T>
            {...table}
            rowKey={rowKey as any}
            dataSource={bucket.rows}
            pagination={false}
          />
        ),
      }))}
    />
  );
}
