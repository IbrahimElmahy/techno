import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, DatePicker, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table,
  Tag, Tooltip, message,
} from 'antd';
import {
  FileSearchOutlined, MinusCircleOutlined, PlusCircleOutlined, ReloadOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';

interface Row {
  account_id: number; code: string | null; name: string;
  group_id: number; group_name: string;
  branch_id: number | null; branch_name: string | null;
  debit: string; credit: string; balance: string; lines: number; last_date: string | null;
}
interface Move {
  entry_id: number; entry_date: string | null; document: string | null; voucher_id: number | null;
  kind: string | null; description: string; debit: string; credit: string; balance: string;
}
interface Movements {
  account_id: number; name: string; group_name: string; branch_name: string | null;
  opening: string; rows: Move[]; total_debit: string; total_credit: string; closing: string;
}

const fmt = (v: string | number) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Bal({ v }: { v: string | number }) {
  const n = Number(v || 0);
  return (
    <Space size={4}>
      <b dir="ltr" style={{ color: n < 0 ? '#cf1322' : n > 0 ? '#389e0d' : undefined }}>{fmt(Math.abs(n))}</b>
      {n !== 0 && <Tag color={n > 0 ? 'green' : 'red'}>{n > 0 ? 'له' : 'عليه'}</Tag>}
    </Space>
  );
}

const KIND_TAG: Record<string, [string, string]> = {
  partner_withdraw: ['سحب', 'volcano'],
  partner_deposit: ['إيداع', 'cyan'],
};

export default function PartnersCurrent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState<Dayjs | null>(null);
  const [withZero, setWithZero] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [moves, setMoves] = useState<Movements | null>(null);
  const [movesLoading, setMovesLoading] = useState(false);
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [dialog, setDialog] = useState<'withdraw' | 'deposit' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/partners-current', {
        params: { include_zero: withZero, ...(asOf ? { as_of: asOf.format('YYYY-MM-DD') } : {}) },
      });
      setRows(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  const loadMoves = async (acc = selected) => {
    if (!acc) return;
    setMovesLoading(true);
    try {
      const res = await api.get(`/api/v1/partners-current/${acc.account_id}/movements`, {
        params: {
          ...(range?.[0] ? { date_from: range[0].format('YYYY-MM-DD') } : {}),
          ...(range?.[1] ? { date_to: range[1].format('YYYY-MM-DD') } : {}),
        },
      });
      setMoves(res.data);
    } finally {
      setMovesLoading(false);
    }
  };

  useEffect(() => { load(); }, [asOf, withZero]);
  useEffect(() => { loadMoves(); }, [selected, range]);
  useEffect(() => {
    api.get('/api/v1/treasuries', { params: { active_only: true } })
      .then((r) => setTreasuries(r.data || [])).catch(() => setTreasuries([]));
  }, []);

  const totals = useMemo(() => {
    let dr = 0; let cr = 0;
    for (const r of rows) { dr += Number(r.debit); cr += Number(r.credit); }
    return { dr, cr, bal: cr - dr };
  }, [rows]);

  const groupTotal = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.branch_id}|${r.group_id}`;
      m.set(k, (m.get(k) || 0) + Number(r.balance));
    }
    return m;
  }, [rows]);

  const openDialog = (kind: 'withdraw' | 'deposit') => {
    form.resetFields();
    const mine = treasuries.filter((t) => !selected?.branch_id || t.branch_id === selected.branch_id);
    form.setFieldsValue({
      voucher_date: dayjs(),
      treasury_id: (mine.find((t) => t.is_default) || mine[0])?.id,
    });
    setDialog(kind);
  };

  const save = async () => {
    if (!selected || !dialog) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      const res = await api.post(`/api/v1/partners-current/${selected.account_id}/movements`, {
        kind: dialog, amount: v.amount, treasury_id: v.treasury_id,
        voucher_date: v.voucher_date ? v.voucher_date.format('YYYY-MM-DD') : undefined,
        description: v.description || undefined, statement1: v.description || undefined,
        external_document_number: v.external_document_number || undefined,
      });
      message.success(`اتسجّل ${dialog === 'withdraw' ? 'سحب' : 'إيداع'} ${res.data.document_number}`);
      setDialog(null);
      load();
      loadMoves();
    } catch {} finally {
      setSaving(false);
    }
  };

  const span = (same: (a: Row, b: Row) => boolean) => (r: Row, i?: number) => {
    const prev = i ? rows[i - 1] : undefined;
    if (prev && same(prev, r)) return { rowSpan: 0 };
    let n = 0;
    for (let j = i || 0; j < rows.length && same(rows[j], r); j += 1) n += 1;
    return { rowSpan: n };
  };

  const columns = [
    {
      title: 'الفرع', dataIndex: 'branch_name', key: 'branch_name', width: 100,
      onCell: span((a, b) => a.branch_id === b.branch_id),
      render: (v: string | null) => <b>{v || '—'}</b>,
    },
    {
      title: 'المجموعة', dataIndex: 'group_name', key: 'group_name', width: 210,
      onCell: span((a, b) => a.branch_id === b.branch_id && a.group_id === b.group_id),
      render: (v: string, r: Row) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{v}</span>
          <Bal v={groupTotal.get(`${r.branch_id}|${r.group_id}`) || 0} />
        </Space>
      ),
    },
    {
      title: 'الحساب', dataIndex: 'name', key: 'name', width: 210,
      render: (v: string, r: Row) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => setSelected(r)}>{v}</a>
          <span style={{ fontSize: 12, color: '#8c8c8c' }} dir="ltr">{r.code}</span>
        </Space>
      ),
    },
    { title: 'مدين', dataIndex: 'debit', key: 'debit', width: 130, align: 'right' as const,
      render: (v: string) => <span dir="ltr">{fmt(v)}</span> },
    { title: 'دائن', dataIndex: 'credit', key: 'credit', width: 130, align: 'right' as const,
      render: (v: string) => <span dir="ltr">{fmt(v)}</span> },
    { title: 'الرصيد', dataIndex: 'balance', key: 'balance', width: 160, align: 'right' as const,
      render: (v: string) => <Bal v={v} /> },
    { title: 'حركات', dataIndex: 'lines', key: 'lines', width: 70, align: 'center' as const },
    { title: 'آخر حركة', dataIndex: 'last_date', key: 'last_date', width: 105,
      render: (v: string | null) => <span dir="ltr">{v || '—'}</span> },
  ];

  const moveColumns = [
    { title: 'التاريخ', dataIndex: 'entry_date', key: 'd', width: 105,
      render: (v: string | null) => <span dir="ltr">{v || '—'}</span> },
    {
      title: 'المستند', dataIndex: 'document', key: 'doc', width: 140,
      render: (v: string | null, m: Move) => (
        <Space size={4}>
          <span dir="ltr">{v || `#${m.entry_id}`}</span>
          {m.kind && KIND_TAG[m.kind] && <Tag color={KIND_TAG[m.kind][1]}>{KIND_TAG[m.kind][0]}</Tag>}
        </Space>
      ),
    },
    { title: 'البيان', dataIndex: 'description', key: 'desc' },
    { title: 'مدين (سحب)', dataIndex: 'debit', key: 'dr', width: 130, align: 'right' as const,
      render: (v: string) => (Number(v) ? <span dir="ltr">{fmt(v)}</span> : '') },
    { title: 'دائن (إيداع)', dataIndex: 'credit', key: 'cr', width: 130, align: 'right' as const,
      render: (v: string) => (Number(v) ? <span dir="ltr">{fmt(v)}</span> : '') },
    { title: 'الرصيد', dataIndex: 'balance', key: 'bal', width: 160, align: 'right' as const,
      render: (v: string) => <Bal v={v} /> },
  ];

  const branchTreasuries = treasuries.filter(
    (t) => !selected?.branch_id || t.branch_id === selected.branch_id,
  );

  return (
    <ListPage
      icon={<TeamOutlined />}
      title="جاري الشركاء"
      subtitle="حسابات الشركاء في كل فرع — اختار حساب تشوف حركته وتعمل سحب أو إيداع زي «الجاري» في a5"
      summary={(
        <>
          <ListStat label="إجمالي المدين (سحب)" value={fmt(totals.dr)} />
          <ListStat label="إجمالي الدائن (إيداع)" value={fmt(totals.cr)} />
          <ListStat label="الصافي" value={fmt(Math.abs(totals.bal))}
            tone={totals.bal < 0 ? 'neg' : 'pos'} hint={totals.bal < 0 ? 'على الشركاء' : 'للشركاء'} />
        </>
      )}
      actions={<Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>}
      filters={(
        <>
          <DatePicker placeholder="الرصيد لحد تاريخ" value={asOf} onChange={setAsOf} format="YYYY/MM/DD" />
          <Space><Switch size="small" checked={withZero} onChange={setWithZero} /> يشمل الحسابات من غير حركة</Space>
        </>
      )}
    >
      <Table<Row>
        className="sl-table"
        rowKey="account_id"
        size="small"
        bordered
        loading={loading}
        dataSource={rows}
        columns={columns as any}
        pagination={false}
        onRow={(r) => ({
          onClick: () => setSelected(r),
          style: { cursor: 'pointer', background: selected?.account_id === r.account_id ? '#e6f4ff' : undefined },
        })}
        locale={{ emptyText: <Empty description="مافيش حسابات شركاء" /> }}
      />

      <Card
        style={{ marginTop: 16 }}
        title={selected
          ? <span>حركة «{selected.name}» <span style={{ color: '#8c8c8c', fontWeight: 400 }}>— {selected.group_name} · {selected.branch_name}</span></span>
          : 'اختار حساب من فوق عشان تشوف حركته'}
        extra={selected && (
          <Space wrap>
            <DatePicker.RangePicker value={range as any} onChange={(v) => setRange(v as any)} format="YYYY/MM/DD"
              placeholder={['من', 'إلى']} />
            <Button danger icon={<MinusCircleOutlined />} onClick={() => openDialog('withdraw')}>سحب</Button>
            <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => openDialog('deposit')}>إيداع / مردود</Button>
            <Tooltip title="كشف الحساب الكامل">
              <Button icon={<FileSearchOutlined />}
                onClick={() => navigate(`/account-statement?account=${selected.account_id}`)} />
            </Tooltip>
          </Space>
        )}
      >
        {selected && (
          <Table<Move>
            size="small"
            bordered
            rowKey={(m) => `${m.entry_id}-${m.debit}-${m.credit}`}
            loading={movesLoading}
            dataSource={[...(moves?.rows || [])].reverse()}
            columns={moveColumns as any}
            pagination={false}
            locale={{ emptyText: <Empty description="مافيش حركة في الفترة دي" /> }}
            title={() => (
              <Space>
                رصيد أول المدة: <Bal v={moves?.opening || 0} />
              </Space>
            )}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}><b>الإجمالي</b></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right"><b dir="ltr">{fmt(moves?.total_debit || 0)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right"><b dir="ltr">{fmt(moves?.total_credit || 0)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right"><Bal v={moves?.closing || 0} /></Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
        )}
      </Card>

      <Modal
        open={dialog !== null}
        title={dialog === 'withdraw' ? `سحب — ${selected?.name || ''}` : `إيداع / مردود — ${selected?.name || ''}`}
        okText="تسجيل" cancelText="إلغاء" confirmLoading={saving}
        okButtonProps={{ danger: dialog === 'withdraw' }}
        onCancel={() => setDialog(null)} onOk={save} destroyOnClose
      >
        <p style={{ color: '#595959' }}>
          {dialog === 'withdraw'
            ? 'الفلوس خارجة من الخزنة للشريك — الجاري بيتقيّد مدين (الى حـ الخزينة).'
            : 'الفلوس داخلة الخزنة من الشريك — الجاري بيتقيّد دائن (من حـ الخزينة).'}
        </p>
        <Form form={form} layout="vertical">
          <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'اكتب المبلغ' }]}>
            <InputNumber min={0.01} style={{ width: '100%' }} dir="ltr" />
          </Form.Item>
          <Form.Item name="treasury_id" label="الخزينة" rules={[{ required: true, message: 'اختار الخزينة' }]}>
            <Select options={branchTreasuries.map((t) => ({ value: t.id, label: t.name }))} />
          </Form.Item>
          <Form.Item name="voucher_date" label="التاريخ">
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" />
          </Form.Item>
          <Form.Item name="description" label="البيان" extra="زي a5: اسم اللي استلم أو سبب الحركة">
            <Input />
          </Form.Item>
          <Form.Item name="external_document_number" label="رقم المستند">
            <Input placeholder="رقم السند الورقي" />
          </Form.Item>
        </Form>
      </Modal>
    </ListPage>
  );
}
