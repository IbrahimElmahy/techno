import React, { useEffect, useState } from 'react';
import { Alert, Button, InputNumber, Modal, Select, Space, Table, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client';

/**
 * مصروفات الفاتورة — freight, loading, commission carried on the document itself.
 *
 * Two kinds, and keeping them apart is the whole point:
 *   • **على العميل** — he pays for it, so it adds to the invoice total and to what he owes;
 *   • **على الشركة** — we bear it, so his side of the document does not change at all and only
 *     the profit on this sale drops.
 *
 * One combined number would make either his balance or the margin wrong, and which one was wrong
 * would depend on who typed the invoice. The account comes from the chart, so freight posts where
 * the accountant already posts freight rather than to a bucket we invented.
 */

export interface InvoiceExpense {
  key: number;
  account_id?: number;
  kind: 'billed' | 'operating';
  amount?: number;
  description?: string;
}

interface Props {
  open: boolean;
  expenses: InvoiceExpense[];
  onChange: (next: InvoiceExpense[]) => void;
  onClose: () => void;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function InvoiceExpensesModal({ open, expenses, onChange, onClose }: Props) {
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    if (!open || accounts.length) return;
    api.get('/api/v1/accounts')
      // Only postable leaves: an expense aimed at a group heading balances the entry and is
      // unreadable in every report built on the chart, so it is not offered at all.
      .then((r) => setAccounts((r.data || []).filter((a: any) => a.is_postable && a.active)))
      .catch(console.error);
  }, [open]);

  const set = (key: number, patch: Partial<InvoiceExpense>) =>
    onChange(expenses.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const billed = expenses
    .filter((e) => e.kind === 'billed')
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const operating = expenses
    .filter((e) => e.kind === 'operating')
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <Modal
      open={open} onCancel={onClose} width={780} destroyOnHidden
      title="مصروفات الفاتورة"
      footer={<Button type="primary" onClick={onClose}>تم</Button>}
    >
      <Table<InvoiceExpense>
        rowKey="key" size="small" dataSource={expenses} pagination={false}
        locale={{ emptyText: 'مافيش مصروفات على الفاتورة' }}
        columns={[
          { title: 'الحساب', dataIndex: 'account_id', width: '38%',
            render: (v: number, r) => (
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }}
                placeholder="اختر الحساب" value={v}
                onChange={(id) => set(r.key, { account_id: id })}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.code ? `${a.code} — ${a.name}` : (a.name || `حساب #${a.id}`),
                }))}
              />
            ) },
          { title: 'على مين', dataIndex: 'kind', width: 170,
            render: (v: string, r) => (
              <Select
                style={{ width: '100%' }} value={v}
                onChange={(k) => set(r.key, { kind: k as InvoiceExpense['kind'] })}
                options={[
                  { value: 'billed', label: 'على العميل' },
                  { value: 'operating', label: 'على الشركة' },
                ]}
              />
            ) },
          { title: 'المبلغ', dataIndex: 'amount', width: 130,
            render: (v: number, r) => (
              <InputNumber min={0} style={{ width: '100%' }} value={v}
                onChange={(a) => set(r.key, { amount: a as number })} />
            ) },
          { title: 'البيان', dataIndex: 'description',
            render: (v: string, r) => (
              <input
                value={v || ''} placeholder="نولون، تحميل…"
                onChange={(e) => set(r.key, { description: e.target.value })}
                style={{ width: '100%', border: '1px solid #d9d9d9', borderRadius: 6,
                  padding: '4px 8px' }}
              />
            ) },
          { title: '', width: 50,
            render: (_: any, r) => (
              <Button type="text" danger icon={<DeleteOutlined />}
                onClick={() => onChange(expenses.filter((e) => e.key !== r.key))} />
            ) },
        ]}
        footer={() => (
          <Space wrap>
            <Button icon={<PlusOutlined />} size="small"
              onClick={() => onChange([...expenses, {
                key: expenses.length ? Math.max(...expenses.map((e) => e.key)) + 1 : 1,
                kind: 'billed',
              }])}>
              سطر مصروف
            </Button>
            <span>على العميل: <Tag color="red">{money(billed)}</Tag></span>
            <span>على الشركة: <Tag color="orange">{money(operating)}</Tag></span>
          </Space>
        )}
      />

      <Alert
        type="info" showIcon style={{ marginTop: 12 }}
        message="«على العميل» بتزيد إجمالي الفاتورة واللي عليه؛ «على الشركة» ما بتغيّرش حسابه وبتقلّل ربح البيعة."
        description="مصروف الشركة بيتصرف من نفس الخزينة اللي الفاتورة اتحصّلت فيها."
      />
    </Modal>
  );
}
