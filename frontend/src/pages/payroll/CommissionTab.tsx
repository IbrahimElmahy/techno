import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Divider, Input, Select, Table, Tag, Tooltip, message } from 'antd';
import { DeleteOutlined, EditOutlined, FileSearchOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { api } from '../../api/client';
import { ListStat } from '../../components/ListPage';
import { InputNumber } from '../../components/NumberInput';
import { TabModal } from '../../components/TabModal';
import { money } from '../../utils/money';
import type { TabParts } from './PayrollExtras';

type Pool = {
  key: string; id?: number; name: string; rep_user_id?: number | null; manual?: boolean;
  poly?: number; white?: number; other?: number;
  auto?: { poly: string; white: string; other: string } | null;
};
type Doc = {
  kind: string; number: string; date: string | null; customer: string | null;
  family: string | null; bucket: string; amount: string;
};

const n = (v: any) => Number(v || 0);
const fail = (err: any, fallback: string) => {
  message.error(err?.response?.data?.detail?.message || fallback, 6);
};
let seq = 0;
const toRows = (list: any[]): Pool[] => list.map((p) => ({
  key: `p${p.id}`, id: p.id, name: p.name, rep_user_id: p.rep_user_id ?? null, manual: !!p.manual,
  poly: n(p.poly) || undefined, white: n(p.white) || undefined, other: n(p.other) || undefined,
  auto: p.auto ?? null,
}));
const BUCKET: Record<string, string> = { poly: 'بولي', white: 'أبيض', other: 'غير مصنّف' };

export function useCommissionTab({ active, branchId, period, data, onData, onCard }: {
  active: boolean; branchId?: number; period: Dayjs; data: any | null; onData: (d: any) => void;
  onCard: (employeeId: number) => void;
}): TabParts {
  const [rows, setRows] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reps, setReps] = useState<{ value: number; label: string }[]>([]);
  const [docsOf, setDocsOf] = useState<Pool | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
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
          id: r.id ?? null, name: r.name, rep_user_id: r.rep_user_id ?? null, manual: !!r.manual,
          poly: String(r.poly ?? 0), white: String(r.white ?? 0),
        })),
      });
      setRows(toRows(res.data.pools || []));
      setDirty(false);
      onData(res.data.month);
      message.success(res.data.month?.run ? 'تم الحفظ وإعادة حساب العمولات' : 'تم الحفظ');
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const openDocs = async (r: Pool) => {
    setDocsOf(r);
    setDocs([]);
    try {
      const res = await api.get(`/api/v1/hr/salary/pools/${r.id}/documents`, {
        params: { year, month, branch_id: branchId },
      });
      setDocs(res.data || []);
    } catch (err: any) { fail(err, 'تعذر تحميل المستندات'); }
  };

  const editable = (r: Pool) => !locked && (!r.rep_user_id || !!r.manual);
  const amountCell = (field: 'poly' | 'white') => (v: number | undefined, r: Pool) => (editable(r) ? (
    <InputNumber style={{ width: '100%' }} min={0} value={v}
      onChange={(x) => edit(r.key, { [field]: x ?? undefined })} />
  ) : r.manual && r.auto ? (
    <Tooltip title={`حساب النظام: ${money(r.auto[field])}`}>{money(v ?? 0)}</Tooltip>
  ) : money(v ?? 0));

  const polyTotal = rows.reduce((t, r) => t + n(r.poly), 0);
  const whiteTotal = rows.reduce((t, r) => t + n(r.white), 0);
  const otherTotal = rows.reduce((t, r) => t + n(r.other), 0);
  const earners = (data?.lines || []).filter((l: any) => n(l.commission))
    .map((l: any) => ({ ...l, parts: (l.details || []).filter((d: any) => d.source === 'commission') }));
  const commissionTotal = earners.reduce((t: number, l: any) => t + n(l.commission), 0);
  const docSum = (b: string) => docs.filter((d) => d.bucket === b).reduce((t, d) => t + n(d.amount), 0);

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
        dataSource={rows} locale={{ emptyText: 'لا توجد جهات تحصيل' }} scroll={{ x: 'max-content' }}
        columns={[
          { title: 'الجهة', dataIndex: 'name', key: 'name', width: 170,
            render: (v: string, r) => (
              <Input value={v} disabled={locked} placeholder="اسم الجهة"
                onChange={(e) => edit(r.key, { name: e.target.value })} />) },
          { title: 'من تحصيل المندوب', dataIndex: 'rep_user_id', key: 'rep', width: 220,
            render: (v: number | null | undefined, r) => (
              <Select allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
                placeholder="إدخال يدوي" value={v ?? undefined} options={reps} disabled={locked}
                onChange={(x) => edit(r.key, { rep_user_id: x ?? null, manual: false })} />) },
          { title: 'يدوي', dataIndex: 'manual', key: 'manual', width: 60, align: 'center',
            render: (v: boolean, r) => (r.rep_user_id ? (
              <Checkbox checked={!!v} disabled={locked}
                onChange={(e) => edit(r.key, e.target.checked
                  ? { manual: true, poly: n(r.poly) + n(r.other), white: r.white }
                  : { manual: false })} />
            ) : null) },
          { title: 'تحصيل البولي', dataIndex: 'poly', key: 'poly', width: 160, render: amountCell('poly') },
          { title: 'تحصيل الأبيض', dataIndex: 'white', key: 'white', width: 160, render: amountCell('white') },
          { title: 'غير مصنّف', dataIndex: 'other', key: 'other', width: 110, align: 'left',
            render: (v: number | undefined) => (n(v) ? money(v) : '—') },
          { title: 'الإجمالي', key: 'total', align: 'left', width: 130,
            render: (_: any, r) => <b>{money(n(r.poly) + n(r.white) + n(r.other))}</b> },
          { title: '', key: 'x', width: 90,
            render: (_: any, r) => (<>
              {r.rep_user_id && r.id ? (
                <Button type="text" icon={<FileSearchOutlined />} title="المستندات" onClick={() => openDocs(r)} />
              ) : null}
              <Button type="text" danger icon={<DeleteOutlined />} disabled={locked}
                onClick={() => { setRows(rows.filter((x) => x.key !== r.key)); setDirty(true); }} />
            </>) },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2} />
            <Table.Summary.Cell index={3}><b>{money(polyTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={4}><b>{money(whiteTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={5}><b>{otherTotal ? money(otherTotal) : '—'}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={6}><b>{money(polyTotal + whiteTotal + otherTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={7} />
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
          { title: '', key: 'x', width: 110,
            render: (_: any, l: any) => (
              <Button size="small" icon={<EditOutlined />} onClick={() => onCard(l.employee_id)}>النسب</Button>) },
        ]}
      />

      <TabModal open={!!docsOf} width={900} footer={null} destroyOnClose
        title={docsOf ? `تحصيل ${docsOf.name}` : ''} onCancel={() => setDocsOf(null)}>
        <div style={{ marginBottom: 8 }}>
          بولي: <b>{money(docSum('poly'))}</b> — أبيض: <b>{money(docSum('white'))}</b>
          {docSum('other') ? <> — غير مصنّف: <b>{money(docSum('other'))}</b></> : null}
          {' '}— الإجمالي: <b>{money(docSum('poly') + docSum('white') + docSum('other'))}</b>
        </div>
        <Table<Doc>
          size="small" rowKey={(d) => `${d.kind}-${d.number}`} dataSource={docs}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          columns={[
            { title: 'المستند', dataIndex: 'kind', key: 'kind', width: 90 },
            { title: 'الرقم', dataIndex: 'number', key: 'number', width: 150 },
            { title: 'التاريخ', dataIndex: 'date', key: 'date', width: 110 },
            { title: 'العميل', dataIndex: 'customer', key: 'customer' },
            { title: 'النوع', dataIndex: 'bucket', key: 'bucket', width: 100,
              filters: Object.entries(BUCKET).map(([value, text]) => ({ value, text })),
              onFilter: (v, d) => d.bucket === v,
              render: (v: string) => <Tag color={v === 'poly' ? 'blue' : v === 'white' ? 'default' : 'orange'}>{BUCKET[v]}</Tag> },
            { title: 'المبلغ', dataIndex: 'amount', key: 'amount', align: 'left', width: 120,
              render: (v: string) => money(v) },
          ]}
        />
      </TabModal>
    </>),
  };
}
