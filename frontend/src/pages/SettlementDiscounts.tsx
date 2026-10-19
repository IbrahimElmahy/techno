import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tooltip,
  message,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, PercentageOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import ListPage from '../components/ListPage';
import PartyField from '../components/PartyField';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { money } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';

type Kind = 'allowed' | 'earned';

interface Discount {
  id: number;
  document_number: string;
  kind: Kind;
  discount_date: string;
  customer_id: number | null;
  supplier_id: number | null;
  party_name: string | null;
  discount_account_id: number;
  discount_account_name: string | null;
  amount: string;
  external_document_number: string | null;
  notes: string | null;
}

const TITLE: Record<Kind, string> = { allowed: 'خصم مسموح به', earned: 'خصم مكتسب' };
const PARTY: Record<Kind, string> = { allowed: 'العميل', earned: 'المورد' };

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function printDiscount(d: Discount) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${TITLE[d.kind]} ${escapeHtml(d.document_number)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}h2{margin:0 0 16px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:8px;text-align:right}
th{background:#f2f2f2;width:30%}</style></head><body>
<h2>${TITLE[d.kind]} ${escapeHtml(d.document_number)}</h2>
<table><tbody>
<tr><th>التاريخ</th><td>${escapeHtml(d.discount_date)}</td></tr>
<tr><th>${PARTY[d.kind]}</th><td>${escapeHtml(d.party_name)}</td></tr>
<tr><th>حساب الخصم</th><td>${escapeHtml(d.discount_account_name)}</td></tr>
<tr><th>المبلغ</th><td>${money(d.amount)}</td></tr>
<tr><th>رقم خارجي</th><td>${escapeHtml(d.external_document_number || '-')}</td></tr>
<tr><th>البيان</th><td>${escapeHtml(d.notes || '-')}</td></tr>
</tbody></table>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export default function SettlementDiscounts() {
  const { can } = useAuth();
  const canWrite = can('voucher.write');
  const [searchParams, setSearchParams] = useSearchParams();
  const kind: Kind = searchParams.get('kind') === 'earned' ? 'earned' : 'allowed';
  const [rows, setRows] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Discount | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [party, setParty] = useState<{ id: number; name: string } | null>(null);
  const [accounts, setAccounts] = useState<{ value: number; label: string }[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Discount[]>('/api/v1/settlement-discounts', { params: { kind } });
      setRows(r.data || []);
    } finally { setLoading(false); }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const loadAccounts = useCallback(async (partyId: number, keep?: number) => {
    const params = kind === 'allowed' ? { kind, customer_id: partyId } : { kind, supplier_id: partyId };
    try {
      const r = await api.get('/api/v1/settlement-discounts/accounts', { params });
      const opts = (r.data.accounts || []).map((a: any) => ({ value: a.id, label: a.name || a.code }));
      setAccounts(opts);
      form.setFieldValue('discount_account_id', keep ?? r.data.default_id ?? undefined);
    } catch (err: any) {
      setAccounts([]);
      message.error(err?.response?.data?.detail?.message || 'تعذّر تحميل حسابات الخصم');
    }
  }, [form, kind]);

  const startNew = () => {
    setEditing(null);
    setParty(null);
    setAccounts([]);
    form.resetFields();
    form.setFieldsValue({ discount_date: dayjs() });
    setOpen(true);
  };

  const startEdit = useCallback((d: Discount) => {
    const partyId = (d.customer_id ?? d.supplier_id) as number;
    setEditing(d);
    setParty({ id: partyId, name: d.party_name || '' });
    form.resetFields();
    form.setFieldsValue({
      discount_date: dayjs(d.discount_date), party_id: partyId, amount: Number(d.amount),
      external_document_number: d.external_document_number, notes: d.notes,
    });
    loadAccounts(partyId, d.discount_account_id);
    setOpen(true);
  }, [form, loadAccounts]);

  useEffect(() => {
    const docId = Number(searchParams.get('doc')) || null;
    if (!docId || loading) return;
    const d = rows.find((x) => x.id === docId);
    if (d) {
      startEdit(d);
      searchParams.delete('doc');
      setSearchParams(searchParams, { replace: true });
      return;
    }
    api.get<Discount>(`/api/v1/settlement-discounts/${docId}`).then((r) => {
      if (r.data.kind !== kind) {
        const next = new URLSearchParams(searchParams);
        next.set('kind', r.data.kind);
        setSearchParams(next, { replace: true });
      } else {
        startEdit(r.data);
        searchParams.delete('doc');
        setSearchParams(searchParams, { replace: true });
      }
    }).catch(() => {
      searchParams.delete('doc');
      setSearchParams(searchParams, { replace: true });
    });
  }, [rows, loading, kind, searchParams, setSearchParams, startEdit]);

  const submit = async (v: any) => {
    const payload = {
      kind,
      discount_date: (v.discount_date as Dayjs)?.format('YYYY-MM-DD'),
      customer_id: kind === 'allowed' ? v.party_id : null,
      supplier_id: kind === 'earned' ? v.party_id : null,
      amount: v.amount,
      discount_account_id: v.discount_account_id || null,
      external_document_number: v.external_document_number || null,
      notes: v.notes || null,
    };
    setSaving(true);
    try {
      const r = editing
        ? await api.put(`/api/v1/settlement-discounts/${editing.id}`, payload)
        : await api.post('/api/v1/settlement-discounts', payload);
      message.success(editing ? `تم تعديل ${r.data.document_number}` : `تم تسجيل ${r.data.document_number}`);
      setOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذّر حفظ الخصم');
    } finally { setSaving(false); }
  };

  const remove = async (d: Discount) => {
    try {
      await api.delete(`/api/v1/settlement-discounts/${d.id}`);
      message.success(`تم حذف ${d.document_number}`);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذّر الحذف');
    }
  };

  const filtered = rows.filter((d) => {
    const q = search.trim();
    if (!q) return true;
    return [d.document_number, d.party_name || '', d.external_document_number || '', d.notes || '']
      .some((x) => x.includes(q));
  });

  const total = filtered.reduce((s, d) => s + Number(d.amount || 0), 0);

  const columns = [
    { title: 'الرقم', dataIndex: 'document_number', width: 130 },
    { title: 'التاريخ', dataIndex: 'discount_date', width: 110 },
    { title: PARTY[kind], dataIndex: 'party_name' },
    { title: 'حساب الخصم', dataIndex: 'discount_account_name' },
    { title: 'المبلغ', dataIndex: 'amount', width: 130, render: (v: string) => money(v) },
    { title: 'البيان', dataIndex: 'notes' },
    { title: 'رقم خارجي', dataIndex: 'external_document_number', width: 110 },
    { title: '', key: 'actions', width: 120, render: (_: unknown, d: Discount) => (
      <Space size={2}>
        <Tooltip title="طباعة">
          <Button type="text" icon={<PrinterOutlined />} onClick={() => printDiscount(d)} />
        </Tooltip>
        {canWrite && (
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} onClick={() => startEdit(d)} />
          </Tooltip>
        )}
        {canWrite && (
          <Popconfirm title={`حذف ${d.document_number}؟ سيُلغى قيده.`} okText="حذف" cancelText="إلغاء"
            onConfirm={() => remove(d)}>
            <Tooltip title="حذف"><Button type="text" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        )}
      </Space>
    ) },
  ];

  return (
    <>
      <ListPage
        icon={<PercentageOutlined />}
        title={TITLE[kind]}
        actions={(<>
          {canWrite && (
            <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
              onClick={startNew}>
              {TITLE[kind]} جديد
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>)}
        filters={(
          <Input className="sl-f-search" allowClear value={search}
            placeholder={`بحث بالرقم أو ${PARTY[kind]} أو البيان`}
            onChange={(e) => setSearch(e.target.value)} />
        )}
      >
        <Table
          className="sl-table" rowKey="id" size="middle" loading={loading}
          dataSource={filtered} columns={columns as any}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true }}
          onRow={(d) => ({ onDoubleClick: () => canWrite && startEdit(d) })}
          summary={() => (filtered.length ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}><b>الإجمالي</b></Table.Summary.Cell>
              <Table.Summary.Cell index={4}><b>{money(total)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={5} colSpan={3} />
            </Table.Summary.Row>
          ) : null)}
        />
      </ListPage>

      <Modal
        open={open} width={640} destroyOnClose
        title={editing ? `تعديل ${TITLE[kind]} ${editing.document_number}` : `${TITLE[kind]} جديد`}
        onCancel={() => setOpen(false)}
        okText={editing ? 'حفظ التعديل' : 'تسجيل'} cancelText="إلغاء"
        confirmLoading={saving} onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Space wrap size={16} align="start">
            <Form.Item name="discount_date" label="التاريخ" rules={[{ required: true, message: 'اختر التاريخ' }]}>
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="party_id" label={PARTY[kind]}
              rules={[{ required: true, message: `اختر ${PARTY[kind]}` }]}>
              <PartyField
                kind={kind === 'allowed' ? 'customer' : 'supplier'}
                style={{ width: 320 }}
                options={party ? [{ value: party.id, label: party.name }] : []}
                onPicked={(p) => { setParty({ id: p.id, name: p.name }); loadAccounts(p.id); }}
              />
            </Form.Item>
          </Space>
          <Space wrap size={16} align="start">
            <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'اكتب المبلغ' }]}>
              <InputNumber min={0.01} style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="discount_account_id" label="حساب الخصم"
              rules={[{ required: true, message: 'اختر حساب الخصم' }]}>
              <Select showSearch style={{ width: 320 }} disabled={!party}
                placeholder={party ? 'اختر الحساب' : `اختر ${PARTY[kind]} أولًا`}
                options={accounts} filterOption={searchFilter} filterSort={searchRank} />
            </Form.Item>
          </Space>
          <Form.Item name="external_document_number" label="رقم خارجي">
            <Input style={{ width: 200 }} maxLength={40} />
          </Form.Item>
          <Form.Item name="notes" label="البيان">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
