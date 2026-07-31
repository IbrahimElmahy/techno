import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Divider, Form, InputNumber, Modal, Select, Space, Table, Tag, message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ListToolbar, { useListFilter } from '../components/ListToolbar';

/**
 * مردودات شراء — goods going back to the supplier, as a register of its own.
 *
 * The returns themselves have worked for a long time, but only from inside a purchase: open the
 * invoice, return off it. That answers «what came back off THIS invoice» and never «what went back
 * to suppliers this month», which is the question a register exists for — and their menu has it as
 * its own screen (`/purchasesreturns/create`), so ours was one entry short of the map.
 *
 * A purchase return is a leaner document than a sales return: no discount, no tax, no cash
 * settlement. Goods go back and what we owe the supplier drops by their value. The columns say
 * exactly that and nothing more, rather than borrowing the sales return's shape.
 *
 * **A return is always against a purchase.** There is no standalone purchase return, and this
 * screen does not invent one — creating starts by choosing the invoice, so what goes back can only
 * be what came in, at the price it came in at. A return with no purchase behind it would be stock
 * appearing from nowhere at a price nobody agreed.
 */

interface ReturnRow {
  id: number;
  document_number: string;
  purchase_invoice_id: number;
  purchase_document_number: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  value: string;
  created_at: string;
}

interface PurchaseLine {
  item_id: number; quantity: string; unit_price: string; line_total: string; unit: string | null;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function PurchaseReturns() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);

  const [creating, setCreating] = useState(false);
  const [purchaseId, setPurchaseId] = useState<number | undefined>();
  const [detail, setDetail] = useState<any>(null);
  // Keyed by item, and empty until typed — a box that opens at 1 turns «5» into «15» for anybody
  // who types over it without clearing first. Same rule as every other document.
  const [qty, setQty] = useState<Record<number, number | null>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, p, i] = await Promise.all([
        api.get('/api/v1/purchases/returns'),
        api.get('/api/v1/purchases'),
        api.get('/api/v1/items'),
      ]);
      setRows(r.data || []); setPurchases(p.data || []); setItems(i.data || []);
    } catch {
      message.error('تعذر تحميل مردودات الشراء');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // What each purchase has ALREADY had returned, so the screen can say what is still returnable
  // rather than letting somebody find out from a server error.
  const returnedByPurchase = useMemo(() => {
    const m: Record<number, number> = {};
    rows.forEach((r) => {
      m[r.purchase_invoice_id] = (m[r.purchase_invoice_id] || 0) + Number(r.value || 0);
    });
    return m;
  }, [rows]);

  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `صنف #${id}`;

  const openCreate = () => {
    setPurchaseId(undefined); setDetail(null); setQty({}); setCreating(true);
  };

  const choosePurchase = async (id: number) => {
    setPurchaseId(id); setQty({});
    try {
      const res = await api.get(`/api/v1/purchases/${id}`);
      setDetail(res.data);
    } catch {
      message.error('تعذر فتح فاتورة الشراء');
      setDetail(null);
    }
  };

  const draftValue = useMemo(() => {
    if (!detail) return 0;
    return (detail.lines as PurchaseLine[]).reduce((sum, ln) => {
      const q = qty[ln.item_id];
      return sum + (q ? q * Number(ln.unit_price || 0) : 0);
    }, 0);
  }, [detail, qty]);

  const submit = async () => {
    if (!purchaseId) { message.warning('اختر فاتورة الشراء الأول'); return; }
    const lines = Object.entries(qty)
      .filter(([, q]) => q && Number(q) > 0)
      .map(([itemId, q]) => ({ item_id: Number(itemId), quantity: String(q) }));
    if (!lines.length) { message.warning('اكتب الكمية المرتجعة على صنف واحد على الأقل'); return; }
    setSaving(true);
    try {
      await api.post(`/api/v1/purchases/${purchaseId}/returns`, { lines });
      message.success('اتسجّل مردود الشراء');
      setCreating(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل المردود');
    } finally { setSaving(false); }
  };

  const columns = [
    {
      title: 'رقم', dataIndex: 'id', key: 'id', width: 80,
      render: (id: number) => <span style={{ color: '#8a8a8a' }}>{id}</span>,
    },
    {
      title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', width: 105,
      render: (v: string) => (v ? String(v).slice(0, 10) : '-'),
    },
    {
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', width: 125,
      render: (d: string) => <Tag color="volcano">{d}</Tag>,
    },
    {
      title: 'الفاتورة رقم', dataIndex: 'purchase_document_number', key: 'purchase_document_number',
      width: 130, render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : '-'),
    },
    {
      title: 'جهه التعامل', dataIndex: 'supplier_name', key: 'supplier_name', ellipsis: true,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: 'القيمة', dataIndex: 'value', key: 'value', width: 130, align: 'left' as const,
      render: (v: string) => <strong style={{ color: '#cf4b1a' }}>{money(v)} ج.م</strong>,
    },
  ];

  const cols = useHiddenColumns('purchase-returns-list', ['id']);

  const filter = useListFilter<ReturnRow>(rows, {
    search: (r) => [r.document_number, r.purchase_document_number, r.supplier_name, r.value],
    filters: { supplier_id: (r, v) => r.supplier_id === v },
    dateOf: (r) => r.created_at,
  });

  const suppliers = useMemo(() => {
    const seen = new Map<number, string>();
    rows.forEach((r) => { if (r.supplier_id) seen.set(r.supplier_id, r.supplier_name || ''); });
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);

  return (
    <div>
      <Card
        title="مردودات الشراء"
        extra={
          <Space>
            <ColumnSettings
              choices={columns.map((c: any) => ({
                key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
                locked: c.key === 'document_number',
              }))}
              hidden={cols.hidden} onChange={cols.setHidden}
            />
            <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
            <Button type="primary" danger icon={<PlusOutlined />} onClick={openCreate}>
              تسجيل مردود شراء
            </Button>
          </Space>
        }
      >
        <ListToolbar
          searchPlaceholder="بحث برقم السند أو الفاتورة أو المورد"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset} total={rows.length} shown={filter.filtered.length}
          filters={[{ key: 'supplier_id', placeholder: 'المورد', span: 6, options: suppliers }]}
        />

        <Table
          dataSource={filter.filtered} columns={cols.apply(columns)} rowKey="id" loading={loading}
          size="middle" tableLayout="fixed"
          pagination={{
            defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>

      <Modal
        centered title="تسجيل مردود شراء" open={creating} width={760} destroyOnHidden
        onCancel={() => setCreating(false)} onOk={submit} confirmLoading={saving}
        okText="ترحيل المردود" cancelText="إلغاء" okButtonProps={{ danger: true }}
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="المردود بيتعمل على فاتورة شراء"
          description="اختار الفاتورة الأول، وبعدها اكتب الكمية الراجعة قدام كل صنف. السعر بيتاخد من الفاتورة نفسها."
        />

        <Form layout="vertical">
          <Form.Item label="فاتورة الشراء" required>
            <Select
              showSearch optionFilterProp="label" value={purchaseId} onChange={choosePurchase}
              placeholder="اختر فاتورة الشراء"
              options={purchases.map((p) => {
                const back = returnedByPurchase[p.id] || 0;
                return {
                  value: p.id,
                  label: `${p.document_number} — ${p.supplier_name ?? ''} — ${money(p.total)} ج.م`
                    + (back ? ` (رجع منها ${money(back)})` : ''),
                };
              })}
            />
          </Form.Item>
        </Form>

        {detail && (
          <>
            <Divider orientation="right" style={{ marginTop: 4 }}>أصناف الفاتورة</Divider>
            <Table
              size="small" pagination={false} rowKey="item_id"
              dataSource={detail.lines as PurchaseLine[]}
              columns={[
                { title: 'الصنف', dataIndex: 'item_id', render: (id: number) => itemName(id) },
                {
                  title: 'المشترى', dataIndex: 'quantity', width: 100,
                  render: (q: string) => Number(q),
                },
                {
                  title: 'سعر الوحدة', dataIndex: 'unit_price', width: 120, align: 'left' as const,
                  render: (v: string) => `${money(v)} ج.م`,
                },
                {
                  title: 'الكمية الراجعة', width: 150,
                  render: (_: any, ln: PurchaseLine) => (
                    <InputNumber
                      style={{ width: '100%' }} min={0} max={Number(ln.quantity)}
                      value={qty[ln.item_id] ?? null}
                      placeholder="—"
                      onChange={(v) => setQty((p) => ({ ...p, [ln.item_id]: v as number | null }))}
                    />
                  ),
                },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}>
                    <strong>قيمة المردود</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>
                    <strong style={{ color: '#cf4b1a' }}>{money(draftValue)} ج.م</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
            {Object.values(qty).some((q) => q) && (
              <Button
                type="link" danger icon={<DeleteOutlined />} style={{ marginTop: 8 }}
                onClick={() => setQty({})}
              >
                تفريغ الكميات
              </Button>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
