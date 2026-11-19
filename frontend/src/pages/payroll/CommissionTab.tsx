import React, { useEffect, useState } from 'react';
import { Button, Divider, Input, Table, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { api } from '../../api/client';
import { ListStat } from '../../components/ListPage';
import { InputNumber } from '../../components/NumberInput';
import { money } from '../../utils/money';
import type { TabParts } from './PayrollExtras';

type Pool = { key: string; id?: number; name: string; poly?: number; white?: number };

const n = (v: any) => Number(v || 0);
const fail = (err: any, fallback: string) => {
  message.error(err?.response?.data?.detail?.message || fallback, 6);
};
let seq = 0;
const toRows = (list: any[]): Pool[] => list.map((p) => ({
  key: `p${p.id}`, id: p.id, name: p.name, poly: n(p.poly) || undefined, white: n(p.white) || undefined,
}));

export function useCommissionTab({ active, branchId, period, data, onData }: {
  active: boolean; branchId?: number; period: Dayjs; data: any | null; onData: (d: any) => void;
}): TabParts {
  const [rows, setRows] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const year = period.year();
  const month = period.month() + 1;
  const locked = data?.run?.status === 'posted';

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/salary/pools', { params: { year, month, branch_id: branchId } });
      setRows(toRows(res.data || []));
      setDirty(false);
    } catch (err: any) { fail(err, 'تعذر تحميل التحصيل'); } finally { setLoading(false); }
  };

  useEffect(() => { if (active) load(); }, [active, branchId, year, month]);

  const edit = (key: string, patch: Partial<Pool>) => {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/api/v1/hr/salary/pools', {
        year, month, branch_id: branchId,
        rows: rows.map((r) => ({ id: r.id ?? null, name: r.name, poly: String(r.poly ?? 0), white: String(r.white ?? 0) })),
      });
      setRows(toRows(res.data.pools || []));
      setDirty(false);
      onData(res.data.month);
      message.success(res.data.month?.run ? 'تم الحفظ وإعادة حساب العمولات' : 'تم الحفظ');
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const polyTotal = rows.reduce((t, r) => t + n(r.poly), 0);
  const whiteTotal = rows.reduce((t, r) => t + n(r.white), 0);
  const earners = (data?.lines || []).filter((l: any) => n(l.commission))
    .map((l: any) => ({
      ...l,
      parts: (l.details || []).filter((d: any) => d.source === 'commission'),
    }));
  const commissionTotal = earners.reduce((t: number, l: any) => t + n(l.commission), 0);

  return {
    actions: (<>
      <Button icon={<PlusOutlined />} disabled={locked}
        onClick={() => { setRows([...rows, { key: `n${++seq}`, name: '' }]); setDirty(true); }}>
        جهة تحصيل
      </Button>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={locked || !dirty} onClick={save}>
        حفظ
      </Button>
    </>),
    summary: (<>
      <ListStat label="تحصيل البولي" value={money(polyTotal)} />
      <ListStat label="تحصيل الأبيض" value={money(whiteTotal)} />
      <ListStat label="إجمالي التحصيل" value={money(polyTotal + whiteTotal)} tone="strong" />
      <ListStat label="إجمالي العمولات" value={money(commissionTotal)} tone="pos" />
      {locked ? <ListStat label="الحالة" value={<Tag color="green">مرحّل</Tag>} /> : null}
    </>),
    body: (<>
      <Table<Pool>
        className="sl-table" rowKey="key" size="small" loading={loading} pagination={false}
        dataSource={rows} locale={{ emptyText: 'لا توجد جهات تحصيل' }}
        columns={[
          { title: 'الجهة', dataIndex: 'name', key: 'name', width: 220,
            render: (v: string, r) => (
              <Input value={v} disabled={locked} placeholder="اسم الجهة"
                onChange={(e) => edit(r.key, { name: e.target.value })} />) },
          { title: 'تحصيل البولي', dataIndex: 'poly', key: 'poly', width: 170,
            render: (v: number | undefined, r) => (
              <InputNumber style={{ width: '100%' }} min={0} value={v} disabled={locked}
                onChange={(x) => edit(r.key, { poly: x ?? undefined })} />) },
          { title: 'تحصيل الأبيض', dataIndex: 'white', key: 'white', width: 170,
            render: (v: number | undefined, r) => (
              <InputNumber style={{ width: '100%' }} min={0} value={v} disabled={locked}
                onChange={(x) => edit(r.key, { white: x ?? undefined })} />) },
          { title: 'الإجمالي', key: 'total', align: 'left',
            render: (_: any, r) => <b>{money(n(r.poly) + n(r.white))}</b> },
          { title: '', key: 'x', width: 60,
            render: (_: any, r) => (
              <Button type="text" danger icon={<DeleteOutlined />} disabled={locked}
                onClick={() => { setRows(rows.filter((x) => x.key !== r.key)); setDirty(true); }} />) },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
            <Table.Summary.Cell index={1}><b>{money(polyTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={2}><b>{money(whiteTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={3}><b>{money(polyTotal + whiteTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={4} />
          </Table.Summary.Row>
        )}
      />

      <Divider style={{ margin: '14px 0 6px' }}>عمولات الموظفين</Divider>
      <Table
        className="sl-table" rowKey="employee_id" size="small" pagination={false}
        dataSource={earners}
        locale={{ emptyText: data?.run ? 'لا توجد عمولات في هذا الشهر' : 'لم تُحسب مرتبات هذا الشهر' }}
        columns={[
          { title: 'الموظف', dataIndex: 'name', key: 'name', width: 200 },
          { title: 'طريقة الحساب', key: 'parts',
            render: (_: any, l: any) => (l.commission_override !== null && l.commission_override !== undefined
              ? <Tag color="orange">مبلغ يدوي</Tag>
              : l.parts.map((d: any, i: number) => (
                <div key={i}>{d.label}{d.quantity ? ` — التحصيل ${money(d.quantity)}` : ''}: <b>{money(d.amount)}</b></div>
              ))) },
          { title: 'العمولة', dataIndex: 'commission', key: 'commission', align: 'left', width: 140,
            render: (v: string) => <b>{money(v)}</b> },
        ]}
      />
    </>),
  };
}
