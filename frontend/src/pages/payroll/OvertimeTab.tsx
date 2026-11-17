import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Input, Space, Table, Tag, message } from 'antd';
import { CalculatorOutlined, SaveOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { api } from '../../api/client';
import { ListStat } from '../../components/ListPage';
import { InputNumber } from '../../components/NumberInput';
import { TabModal } from '../../components/TabModal';
import { money } from '../../utils/money';
import type { TabParts } from './PayrollExtras';

type Entry = { extra_days?: number; overtime_hours?: number; absent_days?: number; absent_hours?: number };
type Component = { id: number; name: string; kind: string; active: boolean; in_daily_rate: boolean };

const num = (v: any) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const n = (v: any) => Number(v || 0);

const fail = (err: any, fallback: string) => {
  message.error(err?.response?.data?.detail?.message || fallback, 6);
};

function entryOf(l: any): Entry {
  const ot = n(l.overtime_hours);
  return {
    extra_days: num(l.extra_days),
    overtime_hours: ot > 0 ? ot : undefined,
    absent_days: num(l.absent_override),
    absent_hours: num(l.absent_hours) ?? (ot < 0 ? -ot : undefined),
  };
}

const same = (a: Entry, b: Entry) => (['extra_days', 'overtime_hours', 'absent_days', 'absent_hours'] as const)
  .every((k) => (a[k] ?? null) === (b[k] ?? null));

export function useOvertimeTab({ active, data, onData, onRecalc, busy }: {
  active: boolean; data: any | null; onData: (d: any) => void; onRecalc: () => Promise<void> | void;
  busy: boolean;
}): TabParts {
  const run = data?.run || null;
  const draft = run?.status === 'draft';
  const lines: any[] = data?.lines || [];
  const [edits, setEdits] = useState<Record<number, Entry>>({});
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [compsOpen, setCompsOpen] = useState(false);
  const [comps, setComps] = useState<Component[]>([]);
  const [compsChanged, setCompsChanged] = useState(false);

  useEffect(() => { if (active) setEdits({}); }, [active, run?.id]);

  const tried = useRef('');
  useEffect(() => {
    if (!active || !data || run || busy) return;
    const key = `${data.branch_id}-${data.year}-${data.month}`;
    if (tried.current === key) return;
    tried.current = key;
    onRecalc();
  }, [active, data, run, busy]);

  const current = (l: any): Entry => edits[l.employee_id] ?? entryOf(l);
  const changed = lines.filter((l) => edits[l.employee_id] && !same(edits[l.employee_id], entryOf(l)));

  const setField = (l: any, k: keyof Entry, v: number | null) => {
    setEdits((e) => ({ ...e, [l.employee_id]: { ...current(l), [k]: v ?? undefined } }));
  };

  const save = async () => {
    if (!run || !changed.length) return;
    setSaving(true);
    try {
      const body = changed.map((l) => {
        const e = edits[l.employee_id];
        return {
          employee_id: l.employee_id,
          extra_days: e.extra_days ?? null,
          overtime_hours: e.overtime_hours ?? null,
          absent_override: e.absent_days ?? null,
          absent_hours: e.absent_hours ?? null,
        };
      });
      const sent = Object.fromEntries(changed.map((l) => [l.employee_id, edits[l.employee_id]]));
      const res = await api.patch(`/api/v1/hr/salary/month/${run.id}/lines`, body);
      onData(res.data);
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id, v]) => v !== sent[Number(id)])));
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const openComps = async () => {
    setCompsOpen(true);
    setCompsChanged(false);
    try {
      const res = await api.get('/api/v1/hr/payroll/components');
      setComps((res.data || []).filter((c: Component) => c.kind === 'earning' && c.active));
    } catch (err: any) { fail(err, 'تعذر تحميل البنود'); }
  };

  const toggleComp = async (c: Component, on: boolean) => {
    try {
      const res = await api.patch(`/api/v1/hr/payroll/components/${c.id}`, { in_daily_rate: on });
      setComps((list) => list.map((x) => (x.id === c.id ? res.data : x)));
      setCompsChanged(true);
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const closeComps = async () => {
    setCompsOpen(false);
    if (compsChanged && draft) await onRecalc();
  };

  const shown = useMemo(() => lines.filter((l) => !q || (l.name || '').includes(q) || (l.code || '').includes(q)),
    [lines, q]);

  useEffect(() => {
    if (!active || !draft || !changed.length || saving) return;
    const t = window.setTimeout(() => { save(); }, 900);
    return () => window.clearTimeout(t);
  }, [edits, active, draft, saving]);

  const preview = (l: any, e: Entry = current(l)) => {
    const daily = n(l.daily_rate);
    const hourly = daily / 8;
    const absentDays = e.absent_days ?? n(l.days_absent);
    return {
      plus: (e.extra_days || 0) * daily + (e.overtime_hours || 0) * hourly,
      minus: absentDays * daily + (e.absent_hours || 0) * hourly,
    };
  };

  const cell = (l: any, k: keyof Entry, placeholder?: string) => (
    <InputNumber size="small" min={0} style={{ width: 90 }} disabled={!draft}
      value={current(l)[k]} placeholder={placeholder}
      onChange={(v) => setField(l, k, v as number | null)} />
  );

  const columns = [
    { title: 'الموظف', dataIndex: 'name', key: 'name', fixed: 'right' as const, width: 180,
      render: (v: string, l: any) => (
        <Space size={4}><b>{v}</b>
          {edits[l.employee_id] && !same(edits[l.employee_id], entryOf(l)) ? <Tag color="orange">لم يُحفظ</Tag> : null}
        </Space>
      ) },
    { title: 'أساس اليوم', key: 'base', width: 110, align: 'left' as const,
      render: (_: any, l: any) => money(n(l.daily_rate) * 30) },
    { title: 'اليوم', dataIndex: 'daily_rate', key: 'daily', width: 90, align: 'left' as const, render: money },
    { title: 'الساعة', key: 'hour', width: 80, align: 'left' as const,
      render: (_: any, l: any) => money(n(l.daily_rate) / 8) },
    { title: 'الإضافي', key: 'plus_grp', children: [
      { title: 'أيام', key: 'extra_days', width: 100, render: (_: any, l: any) => cell(l, 'extra_days') },
      { title: 'ساعات', key: 'overtime_hours', width: 100, render: (_: any, l: any) => cell(l, 'overtime_hours') },
      { title: 'القيمة', key: 'plus', width: 100, align: 'left' as const,
        render: (_: any, l: any) => <b style={{ color: '#389e0d' }}>{money(preview(l).plus)}</b> },
    ] },
    { title: 'الغياب', key: 'minus_grp', children: [
      { title: 'أيام', key: 'absent_days', width: 100,
        render: (_: any, l: any) => cell(l, 'absent_days', n(l.days_absent) ? String(n(l.days_absent)) : undefined) },
      { title: 'ساعات', key: 'absent_hours', width: 100, render: (_: any, l: any) => cell(l, 'absent_hours') },
      { title: 'القيمة', key: 'minus', width: 100, align: 'left' as const,
        render: (_: any, l: any) => <b style={{ color: '#cf1322' }}>{money(preview(l).minus)}</b> },
    ] },
    { title: 'الصافي', dataIndex: 'net', key: 'net', width: 110, align: 'left' as const,
      render: (v: string, l: any) => {
        const now = preview(l);
        const was = preview(l, entryOf(l));
        return <b>{money(n(v) + (now.plus - was.plus) - (now.minus - was.minus))}</b>;
      } },
  ];

  const totals = shown.reduce((t, l) => {
    const p = preview(l);
    return { plus: t.plus + p.plus, minus: t.minus + p.minus };
  }, { plus: 0, minus: 0 });

  return {
    actions: (<>
      <Input className="sl-f-search" allowClear placeholder="بحث بالاسم أو الرقم" prefix={<SearchOutlined />}
        value={q} onChange={(e) => setQ(e.target.value)} />
      {draft ? (
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!changed.length} onClick={save}>
          حفظ{changed.length ? ` (${changed.length})` : ''}
        </Button>
      ) : null}
      {!run ? (
        <Button type="primary" icon={<CalculatorOutlined />} loading={busy} onClick={() => onRecalc()}>
          حساب الشهر
        </Button>
      ) : null}
      <Button icon={<SettingOutlined />} onClick={openComps}>بنود حساب اليوم</Button>
    </>),
    summary: (<>
      <ListStat label="الموظفين" value={String(shown.length)} />
      <ListStat label="قيمة الإضافي" value={money(totals.plus)} tone="pos" />
      <ListStat label="قيمة الغياب" value={money(totals.minus)} tone="neg" />
      {run && !draft ? <ListStat label="الحالة" value={<Tag color="green">مُرحّل — للعرض فقط</Tag>} /> : null}
    </>),
    body: (<>
      {!run ? (
        <Empty style={{ marginTop: 60 }} description="لم تُحسب مرتبات هذا الشهر" />
      ) : (
        <Table className="sl-table" rowKey="employee_id" size="small" dataSource={shown}
          columns={columns as any} pagination={false} scroll={{ x: 'max-content' }} bordered />
      )}
      <TabModal open={compsOpen} title="بنود حساب اليوم" onCancel={closeComps} onOk={closeComps}
        okText="تم" cancelButtonProps={{ style: { display: 'none' } }} destroyOnClose>
        {comps.map((c) => (
          <div key={c.id} style={{ padding: '4px 0' }}>
            <Checkbox checked={c.in_daily_rate} onChange={(e) => toggleComp(c, e.target.checked)}>{c.name}</Checkbox>
          </div>
        ))}
      </TabModal>
    </>),
  };
}
