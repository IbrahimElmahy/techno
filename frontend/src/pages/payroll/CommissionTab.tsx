import React, { useEffect, useState } from 'react';
import { Button, Divider, Input, Select, Table, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { api } from '../../api/client';
import { ListStat } from '../../components/ListPage';
import { InputNumber } from '../../components/NumberInput';
import { money } from '../../utils/money';
import type { TabParts } from './PayrollExtras';

type Pool = { key: string; id?: number; name: string; rep_user_id?: number | null; poly?: number; white?: number; other?: number };

const n = (v: any) => Number(v || 0);
const fail = (err: any, fallback: string) => {
  message.error(err?.response?.data?.detail?.message || fallback, 6);
};
let seq = 0;
const toRows = (list: any[]): Pool[] => list.map((p) => ({
  key: `p${p.id}`, id: p.id, name: p.name, rep_user_id: p.rep_user_id ?? null,
  poly: n(p.poly) || undefined, white: n(p.white) || undefined, other: n(p.other) || undefined,
}));

export function useCommissionTab({ active, branchId, period, data, onData }: {
  active: boolean; branchId?: number; period: Dayjs; data: any | null; onData: (d: any) => void;
}): TabParts {
  const [rows, setRows] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reps, setReps] = useState<{ value: number; label: string }[]>([]);
  const year = period.year();
  const month = period.month() + 1;
  const locked = data?.run?.status === 'posted';

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/salary/pools', { params: { year, month, branch_id: branchId } });
      setRows(toRows(res.data || []));
      setDirty(false);
      const r = await api.get('/api/v1/hr/salary/pools/reps', { params: { branch_id: branchId } });
      setReps((r.data || []).map((u: any) => ({ value: u.id, label: u.name })));
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
        rows: rows.map((r) => ({
          id: r.id ?? null, name: r.name, rep_user_id: r.rep_user_id ?? null,
          poly: String(r.poly ?? 0), white: String(r.white ?? 0),
        })),
      });
      setRows(toRows(res.data.pools || []));
      setDirty(false);
      onData(res.data.month);
      message.success(res.data.month?.run ? 'تم الحفظ وإعادة حساب العمولات' : 'تم الحفظ');
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const polyTotal = rows.reduce((t, r) => t + n(r.poly), 0);
  const whiteTotal = rows.reduce((t, r) => t + n(r.white), 0);
  const otherTotal = rows.reduce((t, r) => t + n(r.other), 0);
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
      {otherTotal ? <ListStat label="غير مصنّف" value={money(otherTotal)} tone="warn" /> : null}
      <ListStat label="إجمالي التحصيل" value={money(polyTotal + whiteTotal + otherTotal)} tone="strong" />
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
          { title: 'من تحصيل المندوب', dataIndex: 'rep_user_id', key: 'rep', width: 230,
            render: (v: number | null | undefined, r) => (
              <Select allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
                placeholder="إدخال يدوي" value={v ?? undefined} options={reps} disabled={locked}
                onChange={(x) => edit(r.key, { rep_user_id: x ?? null })} />) },
          { title: 'تحصيل البولي', dataIndex: 'poly', key: 'poly', width: 170,
            render: (v: number | undefined, r) => (r.rep_user_id ? money(v ?? 0) : (
              <InputNumber style={{ width: '100%' }} min={0} value={v} disabled={locked}
                onChange={(x) => edit(r.key, { poly: x ?? undefined })} />)) },
          { title: 'تحصيل الأبيض', dataIndex: 'white', key: 'white', width: 170,
            render: (v: number | undefined, r) => (r.rep_user_id ? money(v ?? 0) : (
              <InputNumber style={{ width: '100%' }} min={0} value={v} disabled={locked}
                onChange={(x) => edit(r.key, { white: x ?? undefined })} />)) },
          { title: 'غير مصنّف', dataIndex: 'other', key: 'other', width: 120, align: 'left',
            render: (v: number | undefined) => (n(v) ? money(v) : '—') },
          { title: 'الإجمالي', key: 'total', align: 'left',
            render: (_: any, r) => <b>{money(n(r.poly) + n(r.white) + n(r.other))}</b> },
          { title: '', key: 'x', width: 60,
            render: (_: any, r) => (
              <Button type="text" danger icon={<DeleteOutlined />} disabled={locked}
                onClick={() => { setRows(rows.filter((x) => x.key !== r.key)); setDirty(true); }} />) },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2}><b>{money(polyTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={3}><b>{money(whiteTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={4}><b>{otherTotal ? money(otherTotal) : '—'}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={5}><b>{money(polyTotal + whiteTotal + otherTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={6} />
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
