import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, DatePicker, Descriptions, Divider, Form, Input, InputNumber, Select,
  Space, Table, Tag, message
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { DocRef } from '../components/DocumentLink';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import { guardQuantity } from '../components/quantityGuard';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import dayjs, { Dayjs } from 'dayjs';
import { TabModal } from '../components/TabModal';

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
  return_date?: string | null;
  notes?: string | null;
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
  // A purchase return is now a document with a screen, so a link to one has somewhere to land.
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlight, setHighlight] = useState<number | null>(null);
  const pendingDoc = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);

  const [creating, setCreating] = useState(false);
  // The date is asked first, the way the sale and the sales return ask it — the day the goods
  // went back is a fact about the goods, not about when somebody got to the screen.
  const [newStep, setNewStep] = useState<null | 'date'>(null);
  const [returnDate, setReturnDate] = useState<Dayjs>(dayjs());
  const [notes, setNotes] = useState('');
  const [purchaseId, setPurchaseId] = useState<number | undefined>();
  const [detail, setDetail] = useState<any>(null);
  // المردود اللي مفتوح للعرض — غير `detail` اللي هو فاتورة الشراء بتاعة الإنشاء.
  const [viewing, setViewing] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);
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

  useEffect(() => {
    const doc = searchParams.get('doc');
    if (doc) { pendingDoc.current = Number(doc); setSearchParams({}, { replace: true }); }
    const wanted = pendingDoc.current;
    if (!wanted || !rows.length) return;
    pendingDoc.current = null;
    const target = rows.find((r) => r.id === wanted);
    if (target) {
      // Marked AND opened. The mark says where on the page it is; the document says what is in it.
      setHighlight(wanted);
      setTimeout(() => setHighlight(null), 4000);
      openReturn(target);
    } else {
      message.warning(`مردود الشراء رقم ${wanted} مش في القائمة`);
    }
  }, [searchParams, rows]);

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

  /**
   * السطر يفتح المردود بسطوره.
   *
   * The row carries the value; only the lines carry «رجعنا إيه». `purchase_return_line` has held
   * them since returns were built and no screen ever asked for them, so the register could say a
   * return was worth 4,300 and never which items made it up.
   */
  const openReturn = async (row: ReturnRow) => {
    setViewing({ ...row, lines: null });
    setViewLoading(true);
    try {
      const res = await api.get(`/api/v1/purchases/returns/${row.id}`);
      setViewing(res.data);
    } catch {
      message.error('تعذر فتح المردود');
      setViewing(null);
    } finally { setViewLoading(false); }
  };

  const openCreate = () => {
    setPurchaseId(undefined); setDetail(null); setQty({});
    setReturnDate(dayjs()); setNotes(''); setCreating(false); setNewStep('date');
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
      await api.post(`/api/v1/purchases/${purchaseId}/returns`, {
        lines,
        return_date: returnDate.format('YYYY-MM-DD'),
        notes: notes || null,
      });
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
      // The day the goods went back, falling back to when the row was typed for returns recorded
      // before the document had a date of its own. Not silently: those rows say so.
      title: 'التاريخ', dataIndex: 'return_date', key: 'return_date', width: 115,
      render: (v: string | null, r: ReturnRow) => (v ? String(v).slice(0, 10) : (
        <span style={{ color: '#8a8a8a' }} title="مردود قديم — التاريخ ده يوم التسجيل">
          {r.created_at ? `${String(r.created_at).slice(0, 10)}*` : '-'}
        </span>
      )),
    },
    {
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', width: 125,
      render: (d: string) => <Tag color="volcano">{d}</Tag>,
    },
    {
      title: 'الفاتورة رقم', dataIndex: 'purchase_document_number', key: 'purchase_document_number',
      width: 130,
      // The purchase this came off, opened in the purchases screen — the register exists to answer
      // «which invoice?», and stopping at the number would leave the trip half made.
      render: (v: string | null, r: ReturnRow) => (
        <DocRef kind="purchase" id={r.purchase_invoice_id} label={v} />
      ),
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

  const kb = useTableKeyboard<ReturnRow>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: openReturn,
  });

  /**
   * صفحة المستند — واحدة، سواء بتكتب مردود أو بتقرا واحد اتّرحّل.
   *
   * It used to be two Modals over the list: one to write a return, another to look at one. Two
   * shapes for the same paper, so opening yesterday's return landed nowhere near where it was
   * typed. The list simply steps aside while a document is open.
   */
  const docOpen = creating || !!viewing;

  return (
    <div>
      {!docOpen && (
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
              order={cols.order} onMove={(k, d) => cols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
            />
            <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
            <Button data-shortcut="F2" type="primary" danger icon={<PlusOutlined />} onClick={openCreate}>
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
          {...kb.tableProps}
          dataSource={filter.filtered} columns={cols.apply(columns)} rowKey="id" loading={loading}
          size="middle" tableLayout="fixed"
          // Two marks that mean different things: «وصلت من لينك» يبهت، و«الكيبورد واقف هنا» يفضل.
          rowClassName={(r) => [
            r.id === highlight ? 'row-arrived' : '', kb.rowClassName(r),
          ].filter(Boolean).join(' ')}
          pagination={{
            defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>
      )}

      {/* The date door. Declared beside the form, not inside it, so opening the form cannot
          unmount the door that opened it. */}
      <TabModal
        open={newStep === 'date'}
        title="تاريخ مردود الشراء"
        okText="التالي" cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => { setNewStep(null); setCreating(true); }}
        destroyOnHidden
      >
        <DatePicker style={{ width: '100%' }} size="large" autoFocus
          value={returnDate} onChange={(v: Dayjs | null) => v && setReturnDate(v)} />
        <div style={{ marginTop: 10, color: '#8a8a8a', fontSize: 13 }}>
          اليوم اللي البضاعة رجعت فيه للمورد — مش يوم ما اتكتب في النظام.
        </div>
      </TabModal>

      {creating && (
      <Card title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setCreating(false)}>رجوع</Button>
          <span>تسجيل مردود شراء</span>
        </Space>
      )}>
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="المردود بيتعمل على فاتورة شراء"
          description="اختار الفاتورة الأول، وبعدها اكتب الكمية الراجعة قدام كل صنف. السعر بيتاخد من الفاتورة نفسها."
        />

        <Form layout="vertical">
          <Form.Item label="تاريخ المردود">
            <DatePicker style={{ width: '100%' }} value={returnDate}
              onChange={(v: Dayjs | null) => v && setReturnDate(v)} />
          </Form.Item>
          <Form.Item label="ملاحظات">
            <Input placeholder="سبب الرجوع (مكسورة، ناقصة، غلط في الصنف…)"
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Form.Item>
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
                  // Capped by what was actually purchased — but refused, not clamped. `max`
                  // rewrote the number in silence, so somebody returning 50 of a line that only
                  // bought 8 saw «8» appear and never learned why.
                  render: (_: any, ln: PurchaseLine) => (
                    <InputNumber
                      data-grid-col="qty" keyboard={false}
                      style={{ width: '100%' }}
                      value={qty[ln.item_id] ?? null}
                      placeholder="—"
                      onChange={(v) => setQty((p) => ({ ...p, [ln.item_id]: v as number | null }))}
                      onBlur={() => setQty((p) => ({
                        ...p,
                        [ln.item_id]: guardQuantity({
                          value: p[ln.item_id],
                          available: Number(ln.quantity),
                          itemName: itemName(ln.item_id),
                        }, null),
                      }))}
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

        <div style={{
          marginTop: 16, padding: 16, borderRadius: 10,
          background: '#fdf6f3', border: '1px solid #f3e0d8',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <Button type="primary" danger size="large" loading={saving} onClick={submit}>
            ترحيل المردود
          </Button>
          <Button size="large" onClick={() => setCreating(false)}>إلغاء</Button>
        </div>
      </Card>
      )}

      {/* المردود بعد ما اترحّل — نفس الصفحة، بس مقفولة.
          It moved goods back to the supplier and wrote a ledger entry, and there is no edit
          endpoint for one: the way to undo it is to buy the goods again, which is a real event
          with its own paper rather than a quiet rewrite of this one. */}
      {viewing && (
      <Card title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setViewing(null)}>رجوع</Button>
          <span>{`مردود شراء ${viewing.document_number}`}</span>
        </Space>
      )}>
        {viewing && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="التاريخ">
                {viewing.return_date || String(viewing.created_at || '').slice(0, 10) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="جهة التعامل">{viewing.supplier_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="فاتورة الشراء">
                <DocRef kind="purchase" id={viewing.purchase_invoice_id}
                  label={viewing.purchase_document_number} />
              </Descriptions.Item>
              <Descriptions.Item label="القيمة">
                <strong style={{ color: '#cf4b1a' }}>{money(viewing.value)} ج.م</strong>
              </Descriptions.Item>
              {viewing.notes && (
                <Descriptions.Item label="ملاحظات" span={2}>{viewing.notes}</Descriptions.Item>
              )}
            </Descriptions>
            <Table
              size="small" pagination={false} rowKey="item_id" loading={viewLoading}
              dataSource={viewing.lines || []}
              locale={{ emptyText: 'مفيش سطور متسجّلة على المردود ده' }}
              columns={[
                { title: 'الصنف', dataIndex: 'item_name', ellipsis: true,
                  render: (v: string | null, r: any) => v || itemName(r.item_id) },
                { title: 'الكمية', dataIndex: 'quantity', width: 120,
                  render: (v: string) => <b>{Number(v)}</b> },
              ]}
            />
          </>
        )}

        <div style={{ marginTop: 16, textAlign: 'left' }}>
          <Button size="large" onClick={() => setViewing(null)}>إغلاق</Button>
        </div>
      </Card>
      )}
    </div>
  );
}
