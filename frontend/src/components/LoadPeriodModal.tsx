import React from 'react';
import { Button, Space, Table, message } from 'antd';
import { TabModal } from './TabModal';
import DateRangeFilter from './DateRangeFilter';
import { api } from '../api/client';
import { money } from '../utils/money';

export interface PeriodColumn {
  title: string;
  key: string;
  width?: number;
  money?: boolean;
}

const DEFAULT_COLS: PeriodColumn[] = [
  { title: 'المستند', key: 'document_number', width: 150 },
  { title: 'التاريخ', key: 'date', width: 120 },
  { title: 'الطرف', key: 'party' },
  { title: 'الإجمالي', key: 'total', width: 130, money: true },
];

export default function LoadPeriodModal({
  open, onCancel, title, endpoint, params, columns = DEFAULT_COLS, onPick, rowsRef,
  onLoaded, openNewest = false, dateKey = 'date',
}: {
  open: boolean;
  onCancel: () => void;
  title: string;
  endpoint: string;
  params?: Record<string, unknown>;
  columns?: PeriodColumn[];
  onPick: (row: any) => void;
  rowsRef?: React.MutableRefObject<any[] | null>;
  onLoaded?: (rows: any[]) => void;
  openNewest?: boolean;
  dateKey?: string;
}) {
  const [range, setRange] = React.useState<any>(null);
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (rowsRef) rowsRef.current = rows;
  }, [rows, rowsRef]);

  const run = async () => {
    const from = range?.[0];
    const to = range?.[1];
    if (!from || !to) { message.warning('اختر الفترة أولاً'); return; }
    setBusy(true);
    try {
      const res = await api.get(endpoint, {
        params: {
          ...(params || {}),
          date_from: from.format('YYYY-MM-DD'),
          date_to: to.format('YYYY-MM-DD'),
          limit: 500,
        },
      });
      const d: any = res.data;
      const data = Array.isArray(d) ? d : (d?.rows ?? d?.items ?? []);
      if (openNewest) {
        const sorted = [...data].sort((a: any, b: any) =>
          String(b?.[dateKey] || '').localeCompare(String(a?.[dateKey] || ''))
          || Number(b?.id || 0) - Number(a?.id || 0));
        if (!sorted.length) { message.info('لا توجد مستندات في هذه الفترة'); return; }
        onLoaded?.(sorted);
        onCancel();
        onPick(sorted[0]);
        message.success(`تم تحميل ${sorted.length} مستند`);
        return;
      }
      setRows(data);
      onLoaded?.(data);
      if (!data.length) message.info('لا توجد مستندات في هذه الفترة');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الفترة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TabModal
      open={open}
      onCancel={onCancel}
      width={rows?.length ? 760 : 520}
      title={rows?.length ? `${title} — ${rows.length}` : title}
      destroyOnHidden={false}
      footer={rows?.length ? (
        <Space>
          <Button onClick={() => { setRows(null); setRange(null); }}>فترة أخرى</Button>
          <Button onClick={onCancel}>إغلاق</Button>
        </Space>
      ) : (
        <Space>
          <Button onClick={onCancel}>إلغاء</Button>
          <Button type="primary" loading={busy}
            disabled={!(range?.[0] && range?.[1])} onClick={run}>تحميل</Button>
        </Space>
      )}
    >
      {rows?.length ? (
        <Table size="small" rowKey="id" dataSource={rows}
          pagination={{ pageSize: 10, size: 'small' }}
          onRow={(r: any) => ({
            style: { cursor: 'pointer' },
            onClick: () => { onCancel(); onPick(r); },
          })}
          columns={columns.map((c) => ({
            title: c.title,
            dataIndex: c.key,
            width: c.width,
            ellipsis: !c.width,
            align: (c.money ? 'left' : undefined) as any,
            render: (v: any) => (c.money ? <b>{money(v ?? 0)}</b> : (v ?? '-')),
          }))} />
      ) : (
        <>
          <DateRangeFilter value={range} onChange={(v: any) => setRange(v)} />
        </>
      )}
    </TabModal>
  );
}
