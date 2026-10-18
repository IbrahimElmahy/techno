import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table,
  Tag, Tooltip, message,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, FileTextOutlined, MinusCircleOutlined, PlusOutlined,
  PrinterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import ListPage from '../components/ListPage';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { expenseAccountOptions, defaultTreasuryId } from '../components/VoucherFields';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { money } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';

interface BillLine {
  id?: number;
  account_id: number;
  account_name?: string | null;
  amount: string | number;
  description?: string | null;
}

interface Bill {
  id: number;
  document_number: string;
  bill_date: string;
  supplier_id: number | null;
  creditor_account_id: number;
  creditor_name: string | null;
  total: string;
  cash_amount: string;
  credit_amount: string;
  treasury_id: number | null;
  external_document_number: string | null;
  notes: string | null;
  lines: BillLine[];
}

const num = (v: unknown) => Number(v || 0);

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function printBill(b: Bill, treasuryName: string | null) {
  const w = window.open('', '_blank');
  if (!w) return;
  const rows = b.lines.map((ln, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(ln.account_name)}</td>`
    + `<td>${escapeHtml(ln.description)}</td><td class="n">${money(ln.amount)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>فاتورة مصروف ${escapeHtml(b.document_number)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}h2{margin:0 0 12px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #999;padding:6px 8px;text-align:right}
th{background:#f2f2f2}.n{text-align:left;white-space:nowrap}.tot td{font-weight:700}</style></head><body>
<h2>فاتورة مصروف ${escapeHtml(b.document_number)}</h2>
<div class="meta"><div>التاريخ: ${escapeHtml(b.bill_date)}</div>
<div>الطرف المستحق: ${escapeHtml(b.creditor_name)}</div>
<div>رقم الفاتورة الخارجي: ${escapeHtml(b.external_document_number || '-')}</div>
<div>الخزينة: ${escapeHtml(treasuryName || '-')}</div></div>
<table><thead><tr><th>#</th><th>المصروف</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${rows}
<tr class="tot"><td colspan="3">الإجمالي</td><td class="n">${money(b.total)}</td></tr>
<tr><td colspan="3">المدفوع نقدًا</td><td class="n">${money(b.cash_amount)}</td></tr>
<tr><td colspan="3">الآجل</td><td class="n">${money(b.credit_amount)}</td></tr></tbody></table>
${b.notes ? `<p>ملاحظات: ${escapeHtml(b.notes)}</p>` : ''}
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export default function ExpenseBills() {
  const { can } = useAuth();
  const canWrite = can('voucher.write');
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Bill | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Bill[]>('/api/v1/expense-bills');
      setRows(r.data || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    api.get<any[]>('/api/v1/accounts').then((r) => setAccounts(r.data || [])).catch(() => {});
    api.get<any[]>('/api/v1/suppliers').then((r) => setSuppliers(r.data || [])).catch(() => {});
    api.get<any[]>('/api/v1/treasuries').then((r) => setTreasuries(r.data || [])).catch(() => {});
  }, [load]);

  const expenseOptions = useMemo(() => expenseAccountOptions(accounts), [accounts]);
  const liabilityOptions = useMemo(() => accounts
    .filter((a) => a.nature === 'liability' && a.is_postable && a.active !== false
      && !['supplier_payable', 'customer_receivable'].includes(a.account_type))
    .map((a) => ({ value: a.id, label: a.name || a.code })), [accounts]);
  const supplierOptions = useMemo(() => suppliers
    .filter((s) => s.active !== false)
    .map((s) => ({ value: s.id, label: s.name })), [suppliers]);
  const treasuryOptions = useMemo(() => treasuries
    .filter((t) => t.active !== false)
    .map((t) => ({ value: t.id, label: `${t.name} — ${money(t.balance)}` })), [treasuries]);
  const treasuryName = (id: number | null) => treasuries.find((t) => t.id === id)?.name ?? null;

  const startNew = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      bill_date: dayjs(), creditor_kind: 'supplier', cash_amount: 0,
      treasury_id: defaultTreasuryId(treasuries), lines: [{}],
    });
    setOpen(true);
  };

  const startEdit = useCallback((b: Bill) => {
    setEditing(b);
    form.resetFields();
    form.setFieldsValue({
      bill_date: dayjs(b.bill_date),
      creditor_kind: b.supplier_id ? 'supplier' : 'account',
      supplier_id: b.supplier_id ?? undefined,
      creditor_account_id: b.supplier_id ? undefined : b.creditor_account_id,
      cash_amount: num(b.cash_amount),
      treasury_id: b.treasury_id ?? defaultTreasuryId(treasuries),
      external_document_number: b.external_document_number,
      notes: b.notes,
      lines: b.lines.map((ln) => ({
        account_id: ln.account_id, amount: num(ln.amount), description: ln.description,
      })),
    });
    setOpen(true);
  }, [form, treasuries]);

  useEffect(() => {
    const docId = Number(searchParams.get('doc')) || null;
    if (!docId || !rows.length) return;
    const b = rows.find((x) => x.id === docId);
    if (b) startEdit(b);
    searchParams.delete('doc');
    setSearchParams(searchParams, { replace: true });
  }, [rows, searchParams, setSearchParams, startEdit]);

  const lines = Form.useWatch('lines', form) as any[] | undefined;
  const cash = Form.useWatch('cash_amount', form) as number | undefined;
  const kind = Form.useWatch('creditor_kind', form) as string | undefined;
  const total = (lines || []).reduce((s, l) => s + num(l?.amount), 0);
  const credit = Math.max(0, total - num(cash));

  const submit = async (v: any) => {
    const payload = {
      bill_date: (v.bill_date as Dayjs)?.format('YYYY-MM-DD'),
      supplier_id: v.creditor_kind === 'supplier' ? v.supplier_id : null,
      creditor_account_id: v.creditor_kind === 'account' ? v.creditor_account_id : null,
      lines: (v.lines || []).map((l: any) => ({
        account_id: l.account_id, amount: l.amount, description: l.description || null,
      })),
      cash_amount: v.cash_amount || 0,
      treasury_id: num(v.cash_amount) > 0 ? v.treasury_id : null,
      external_document_number: v.external_document_number || null,
      notes: v.notes || null,
    };
    setSaving(true);
    try {
      const r = editing
        ? await api.put(`/api/v1/expense-bills/${editing.id}`, payload)
        : await api.post('/api/v1/expense-bills', payload);
      message.success(editing ? `تم تعديل ${r.data.document_number}` : `تم تسجيل ${r.data.document_number}`);
      setOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذّر حفظ فاتورة المصروف');
    } finally { setSaving(false); }
  };

  const remove = async (b: Bill) => {
    try {
      await api.delete(`/api/v1/expense-bills/${b.id}`);
      message.success(`تم حذف ${b.document_number}`);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذّر الحذف');
    }
  };

  const filtered = rows.filter((b) => {
    const q = search.trim();
    if (!q) return true;
    return [b.document_number, b.creditor_name || '', b.external_document_number || '',
      b.notes || '', ...b.lines.map((l) => `${l.account_name || ''} ${l.description || ''}`)]
      .some((x) => x.includes(q));
  });

  const columns = [
    { title: 'رقم الفاتورة', dataIndex: 'document_number', width: 130 },
    { title: 'التاريخ', dataIndex: 'bill_date', width: 110 },
    { title: 'الطرف المستحق', dataIndex: 'creditor_name',
      render: (v: string, b: Bill) => (
        <Space size={4}>{v}{b.supplier_id ? <Tag>مورد</Tag> : <Tag color="purple">حساب</Tag>}</Space>
      ) },
    { title: 'المصروفات', render: (_: unknown, b: Bill) => b.lines.map((l) => l.account_name).join('، ') },
    { title: 'الإجمالي', dataIndex: 'total', width: 120, render: (v: string) => money(v) },
    { title: 'نقدًا', dataIndex: 'cash_amount', width: 110, render: (v: string) => money(v) },
    { title: 'آجل', dataIndex: 'credit_amount', width: 110, render: (v: string) => money(v) },
    { title: 'رقم خارجي', dataIndex: 'external_document_number', width: 110 },
    { title: '', key: 'actions', width: 120, render: (_: unknown, b: Bill) => (
      <Space size={2}>
        <Tooltip title="طباعة">
          <Button type="text" icon={<PrinterOutlined />} onClick={() => printBill(b, treasuryName(b.treasury_id))} />
        </Tooltip>
        {canWrite && (
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} onClick={() => startEdit(b)} />
          </Tooltip>
        )}
        {canWrite && (
          <Popconfirm title={`حذف ${b.document_number}؟ سيُلغى قيدها.`} okText="حذف" cancelText="إلغاء"
            onConfirm={() => remove(b)}>
            <Tooltip title="حذف"><Button type="text" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        )}
      </Space>
    ) },
  ];

  return (
    <>
      <ListPage
        icon={<FileTextOutlined />}
        title="فواتير المصروفات"
        actions={(<>
          {canWrite && (
            <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
              onClick={startNew}>
              فاتورة مصروف جديدة
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>)}
        filters={(
          <Input className="sl-f-search" allowClear value={search}
            placeholder="بحث بالرقم أو الطرف أو المصروف"
            onChange={(e) => setSearch(e.target.value)} />
        )}
      >
        <Table
          className="sl-table" rowKey="id" size="middle" loading={loading}
          dataSource={filtered} columns={columns as any}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true }}
          onRow={(b) => ({ onDoubleClick: () => canWrite && startEdit(b) })}
        />
      </ListPage>

      <Modal
        open={open} width={820} destroyOnClose
        title={editing ? `تعديل فاتورة مصروف ${editing.document_number}` : 'فاتورة مصروف جديدة'}
        onCancel={() => setOpen(false)}
        okText={editing ? 'حفظ التعديل' : 'تسجيل الفاتورة'} cancelText="إلغاء"
        confirmLoading={saving} onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Space wrap size={16} align="start">
            <Form.Item name="bill_date" label="التاريخ" rules={[{ required: true, message: 'اختر التاريخ' }]}>
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="creditor_kind" label="الطرف المستحق">
              <Radio.Group optionType="button" options={[
                { value: 'supplier', label: 'مورد' },
                { value: 'account', label: 'حساب' },
              ]} />
            </Form.Item>
            {kind === 'account' ? (
              <Form.Item name="creditor_account_id" label="الحساب الدائن"
                rules={[{ required: true, message: 'اختر الحساب الدائن' }]}>
                <Select showSearch style={{ width: 300 }} placeholder="مثل: أجور مستحقة"
                  options={liabilityOptions} filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            ) : (
              <Form.Item name="supplier_id" label="المورد"
                rules={[{ required: true, message: 'اختر المورد' }]}>
                <Select showSearch style={{ width: 300 }} placeholder="مثل: شركة الكهرباء"
                  options={supplierOptions} filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            )}
          </Space>

          <Form.List name="lines">
            {(fields, { add, remove: drop }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="start" wrap size={8} style={{ display: 'flex' }}>
                    <Form.Item name={[f.name, 'account_id']} label={f.name === 0 ? 'المصروف' : undefined}
                      rules={[{ required: true, message: 'اختر المصروف' }]}>
                      <Select showSearch style={{ width: 260 }} placeholder="مثل: كهرباء"
                        options={expenseOptions as any} filterOption={searchFilter} filterSort={searchRank} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'amount']} label={f.name === 0 ? 'المبلغ' : undefined}
                      rules={[{ required: true, message: 'اكتب المبلغ' }]}>
                      <InputNumber min={0.01} style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'description']} label={f.name === 0 ? 'البيان' : undefined}>
                      <Input style={{ width: 260 }} maxLength={240} />
                    </Form.Item>
                    {fields.length > 1 && (
                      <Button type="text" danger icon={<MinusCircleOutlined />}
                        style={{ marginTop: f.name === 0 ? 30 : 0 }} onClick={() => drop(f.name)} />
                    )}
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})}
                  style={{ marginBottom: 16 }}>
                  إضافة بند مصروف
                </Button>
              </>
            )}
          </Form.List>

          <Space wrap size={16} align="start">
            <Form.Item name="cash_amount" label="المدفوع نقدًا">
              <InputNumber min={0} style={{ width: 160 }} />
            </Form.Item>
            {num(cash) > 0 && (
              <Form.Item name="treasury_id" label="الخزينة"
                rules={[{ required: true, message: 'اختر الخزينة' }]}>
                <Select style={{ width: 260 }} options={treasuryOptions} />
              </Form.Item>
            )}
            <Form.Item name="external_document_number" label="رقم الفاتورة الخارجي">
              <Input style={{ width: 180 }} maxLength={40} />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="ملاحظات">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Space size={24} style={{ fontWeight: 700 }}>
            <span>الإجمالي: {money(total)}</span>
            <span>نقدًا: {money(num(cash))}</span>
            <span style={{ color: num(cash) > total ? '#cf1322' : undefined }}>آجل: {money(credit)}</span>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
