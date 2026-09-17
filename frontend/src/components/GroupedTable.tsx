import React, { useMemo, useState } from 'react';
import { Collapse, Table, Tag } from 'antd';
import type { TableProps } from 'antd';

/**
 * جدول مجمّع — زي «Group By» في أودو.
 *
 * الفلتر بيشيل صفوف؛ التجميع بيسيبها كلها ويرتّبها. السؤال اللي بيتسأل بعد «وريني
 * فواتير الشهر» على طول هو «مقسومة على مين»، والإجابة قبل كده كانت: صدّر الجدول
 * واعمل PivotTable بره النظام.
 *
 * **المجموعة بتقول عددها ومجموعها في عنوانها.** المجموعة اللي عنوانها اسم بس
 * بتخلّي اللي عايز الإجمالي يفتحها ويجمع بعينه — وده بالظبط الشغل اللي التجميع
 * المفروض يوفّره.
 *
 * والمجموعات بتتفتح كلها لما يكونوا قليّلين ومقفولة لما يكونوا كتير: عشرين مجموعة
 * مفتوحة صفحة أطول من الجدول اللي مش مجمّع، وواحدة مقفولة إخفاء لحاجة انت عارف
 * إنها جوّه.
 */

export interface GroupDef<T> {
  value: string;
  label: string;
  /** مفتاح المجموعة اللي الصف بيقع فيها، واسمها. `null` = «بدون». */
  of: (row: T) => { key: string; label: string } | null;
  /** رقم بيتجمع في عنوان المجموعة — الإجمالي غالباً. */
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
  /** تنسيق المجموع في العنوان. الافتراضي رقم بعلامتين عشريتين. */
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

  // المفاتيح المفتوحة بتتحسب مرة وقت أول عرض: لو اتحسبت في كل رندر، قفل مجموعة
  // بإيد كان هيترجع مفتوح تاني أول ما أي حاجة في الصفحة تتغيّر.
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
