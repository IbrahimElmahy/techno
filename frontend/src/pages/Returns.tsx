import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, InputNumber, Modal, Row,
  Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SearchOutlined, ClearOutlined, HistoryOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import ItemStockPanel from '../components/ItemStockPanel';
import ProductPickerModal from '../components/ProductPickerModal';
import TotalsLadder from '../components/TotalsLadder';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import InvoiceDocument, { InvoiceDoc, invoiceFooter } from '../components/InvoiceDocument';
import CustomerAccountPanel from '../components/CustomerAccountPanel';
import { useLookup, labelMap } from '../hooks/useLookup';

/**
 * مرتجعات المبيعات — a full "return like a sale, reversed" screen: pick a customer, then the goods
 * they're bringing back; the items go back INTO stock and the money is credited to the customer.
 * On picking a customer + product it shows what the customer last paid for that item (and their
 * purchase history) and auto-fills that price as the refund price.
 */

interface ReturnRecord {
  id: number;
  document_number: string;
  customer_id: number;
  gross: string;
  combined_pct: string;
  net: string;
  tax_amount: string;
  cash_refund: string;
  credit_reduction: string;
  ledger_entry_id: number | null;
  created_at?: string | null;
}

interface Customer { id: number; name: string; phone?: string | null; }
interface Product {
  id: number; name: string; sale_price: string | null; is_serialized: boolean; category: string | null;
}
interface Warehouse { id: number; name: string; }

interface HistRow {
  document_number: string; date: string | null; quantity: string; unit: string | null;
  unit_price: string; effective_price: string;
}
interface LastInfo { last_price: string | null; history: HistRow[]; }

interface ReturnLineItem {
  key: string;
  category: string | null;
  item_id: number | null;
  quantity: number;
  unit_price: number;
  discount: number;   // per-line discount %
  warehouse_id: number | null;   // (030) this line comes back into its own warehouse
}

interface Filters {
  q?: string; customer_id?: number; date_from?: string; date_to?: string;
}

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Returns() {
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pointValues, setPointValues] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [lines, setLines] = useState<ReturnLineItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // The item the side stock panel is showing — on a return it answers "where should this go
  // back to", which is the same question the invoice asks in reverse.
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  // Same as the invoice: the picker is a window, and the caret lands in the quantity of the line
  // it just added. A return is typed at the same counter under the same pressure, so it should
  // not be the one screen that still needs a mouse between every line.
  const [pickerOpen, setPickerOpen] = useState(false);
  const qtyRefs = useRef<Record<string, any>>({});
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [cashRefund, setCashRefund] = useState<number>(0);
  const [creditReduction, setCreditReduction] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [customerBalance, setCustomerBalance] = useState<number | null>(null);
  // The document's warehouse — the default each line falls back to when it has none of its own.
  const [docWarehouseId, setDocWarehouseId] = useState<number | null>(null);
  // The customer's purchase history per item — drives the last-price autofill + the info popover.
  const [lastInfo, setLastInfo] = useState<Record<number, LastInfo>>({});

  const [detailVisible, setDetailVisible] = useState(false);
  const [viewReturn, setViewReturn] = useState<any>(null);
  // Purchase-history popup for a line's "آخر سعر شراء" tag.
  const [histModal, setHistModal] = useState<{ name: string; rows: HistRow[] } | null>(null);

  const fetchReturns = async (override?: Filters) => {
    setLoading(true);
    try {
      const f = override ?? filters;
      const params: any = {};
      if (f.q) params.q = f.q;
      if (f.customer_id) params.customer_id = f.customer_id;
      if (f.date_from) params.date_from = f.date_from;
      if (f.date_to) params.date_to = f.date_to;
      const res = await api.get('/api/v1/sales/returns', { params });
      setReturns(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const loadLookups = async () => {
    try {
      const [custRes, prodRes, whRes, ptRes] = await Promise.all([
        api.get('/api/v1/customers'),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/products/point-values'),
      ]);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
      setWarehouses(whRes.data);
      const pts: Record<number, number> = {};
      (ptRes.data || []).forEach((r: any) => { pts[r.item_id] = parseFloat(r.point_value) || 0; });
      setPointValues(pts);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchReturns(); loadLookups(); }, []);

  const setFilter = (key: keyof Filters, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next); fetchReturns(next);
  };
  const applySearch = () => setFilter('q', search.trim() || undefined);
  const resetFilters = () => { setSearch(''); setFilters({}); fetchReturns({}); };

  const summary = useMemo(() => {
    const net = returns.reduce((s, r) => s + Number(r.net || 0), 0);
    const credit = returns.reduce((s, r) => s + Number(r.credit_reduction || 0), 0);
    return { count: returns.length, net, credit };
  }, [returns]);

  const productCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [products]);

  const linesByCategory = useMemo(() => {
    const groups: { category: string | null; items: ReturnLineItem[] }[] = [];
    lines.forEach((l) => {
      let g = groups.find((x) => x.category === (l.category ?? null));
      if (!g) { g = { category: l.category ?? null, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    return groups;
  }, [lines]);

  const lineTotal = (l: ReturnLineItem) =>
    l.quantity * l.unit_price * (1 - Math.min(99.99, l.discount || 0) / 100);
  const linePoints = (l: ReturnLineItem) =>
    (l.item_id ? (pointValues[l.item_id] || 0) : 0) * (l.quantity || 0);

  const grossTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const netTotal = grossTotal * (1 - discountPct / 100);
  const totalPoints = lines.reduce((s, l) => s + linePoints(l), 0);

  // Default the refund to a credit against the customer's account (cash stays 0 → full credit).
  useEffect(() => {
    const credit = Math.max(0, netTotal - (parseFloat(cashRefund.toString()) || 0));
    setCreditReduction(parseFloat(credit.toFixed(2)));
  }, [cashRefund, netTotal]);

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `صنف #${id}`;

  const closeCreate = () => {
    setCreateVisible(false);
    setLines([]); setActiveCategory(null); setCashRefund(0); setDiscountPct(0);
    setCustomerId(null); setLastInfo({}); setCustomerBalance(null); setDocWarehouseId(null);
    createForm.resetFields();
  };

  const onCustomerChange = (cId: number) => {
    setCustomerId(cId);
    // A different customer means different purchase prices — start the lines fresh.
    setLines([]); setLastInfo({}); setActiveCategory(null);
    setCustomerBalance(null);
    api.get(`/api/v1/customers/${cId}/account`)
      .then((res) => setCustomerBalance(Number(res.data.balance || 0)))
      .catch((err) => console.error(err));
  };

  // Fetch what THIS customer last paid for the item, and its short purchase history.
  const fetchLastInfo = async (itemId: number): Promise<LastInfo> => {
    if (lastInfo[itemId]) return lastInfo[itemId];
    try {
      const res = await api.get('/api/v1/sales/customer-item-history', {
        params: { customer_id: customerId, item_id: itemId },
      });
      const info: LastInfo = { last_price: res.data.last_price, history: res.data.history || [] };
      setLastInfo((prev) => ({ ...prev, [itemId]: info }));
      return info;
    } catch (err) {
      console.error(err);
      return { last_price: null, history: [] };
    }
  };

  const addProductById = async (itemId: number) => {
    if (!itemId || !customerId) return;
    const prod = products.find((p) => p.id === itemId);
    if (prod?.is_serialized) {
      message.warning('الأصناف ذات الأرقام التسلسلية تُرتجع من فاتورتها الأصلية.');
      return;
    }
    const info = await fetchLastInfo(itemId);
    // Auto-select the last price the customer paid; fall back to the product's list price.
    const price = info.last_price != null
      ? parseFloat(info.last_price)
      : (prod?.sale_price ? parseFloat(prod.sale_price) : 0);
    const existing = lines.find((x) => x.item_id === itemId);
    if (existing) {
      setLines((prev) => prev.map((x) => (x.key === existing.key
        ? { ...x, quantity: x.quantity + 1 } : x)));
      // Focus the line that just changed, not a new one — the eye follows the number that moved.
      setFocusLineKey(existing.key);
    } else {
      const key = Date.now().toString();
      setLines((prev) => [...prev, {
        key, category: prod?.category ?? null, item_id: itemId,
        quantity: 1, unit_price: price, discount: 0, warehouse_id: null,
      }]);
      setFocusLineKey(key);
    }
  };

  // The row does not exist until React has painted it, so the caret moves on the next tick
  // rather than inside the handler that created it.
  useEffect(() => {
    if (!focusLineKey) return;
    const input = qtyRefs.current[focusLineKey];
    if (input?.focus) {
      input.focus();
      input.select?.();
    }
    setFocusLineKey(null);
  }, [focusLineKey, lines.length]);

  const handleLineChange = (key: string, field: keyof ReturnLineItem, value: any) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  };
  const handleRemoveLine = (key: string) => setLines(lines.filter((l) => l.key !== key));

  const handleSubmit = (values: any) => {
    if (!customerId) { message.warning('يرجى اختيار العميل'); return; }
    const valid = lines.filter((l) => l.item_id !== null && l.quantity > 0);
    if (valid.length === 0) { message.warning('أضف صنفاً واحداً على الأقل للمرتجع'); return; }
    const cash = parseFloat(cashRefund.toString()) || 0;
    if (cash + creditReduction - netTotal > 0.01 || netTotal - (cash + creditReduction) > 0.01) {
      message.error('مجموع المسترد نقداً + الخصم من الحساب يجب أن يساوي صافي المرتجع');
      return;
    }
    showReversalConfirm({
      title: 'تأكيد تسجيل مرتجع المبيعات',
      content: `سيتم إرجاع ${valid.length} صنف إلى المخزن وتسوية مبلغ ${money(netTotal)} ج.م لحساب العميل. متابعة؟`,
      onOk: async () => {
        try {
          const res = await api.post('/api/v1/sales/returns', {
            customer_id: customerId,
            origin: { location_kind: 'warehouse', location_id: values.warehouse_id },
            variable_discount_pct: discountPct,
            cash_refund: cash,
            credit_reduction: creditReduction,
            lines: valid.map((l) => ({
              item_id: l.item_id, quantity: l.quantity, unit_price: l.unit_price,
              discount_pct: l.discount || 0,
              // (030) only when the line differs from the document's warehouse
              warehouse_id: l.warehouse_id ?? undefined,
            })),
          });
          message.success(`تم تسجيل المرتجع بنجاح. رقم السند: ${res.data.document_number}`);
          closeCreate();
          fetchReturns();
        } catch (err) { console.error(err); }
      },
    });
  };

  const returnDoc = (r: any): InvoiceDoc | null => {
    if (!r) return null;
    const customer = customers.find((c) => c.id === r.customer_id);
    return {
      kind: 'sale_return',
      document_number: r.document_number,
      date: r.created_at ?? null,
      partyLabel: 'العميل',
      partyName: customer?.name ?? `#${r.customer_id}`,
      partyPhone: customer?.phone ?? null,
      partyId: r.customer_id ?? null,
      gross: r.gross,
      discountPct: r.combined_pct,
      net: r.net,
      tax: r.tax_amount ?? 0,
      cash: r.cash_refund,
      credit: r.credit_reduction,
      entryId: r.ledger_entry_id ?? null,
      totalPoints: (r.lines || []).reduce(
        (s: number, l: any) => s + (pointValues[l.item_id] || 0) * Number(l.quantity || 0), 0),
      lines: (r.lines || []).map((l: any) => ({
        name: productName(l.item_id),
        itemId: l.item_id,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct,
        points: (pointValues[l.item_id] || 0) * Number(l.quantity || 0),
        line_total: l.line_total,
        warehouse: warehouses.find((w) => w.id === l.warehouse_id)?.name ?? null,
      })),
    };
  };

  const openDetail = async (record: ReturnRecord) => {
    try {
      const res = await api.get(`/api/v1/sales/returns/${record.id}`);
      setViewReturn(res.data);
      setDetailVisible(true);
    } catch (err) { console.error(err); }
  };

  // --- The full create page --------------------------------------------------------------------
  if (createVisible) {
    return (
      <div>
        <Card title="تسجيل مرتجع مبيعات جديد">
          <Form form={createForm} layout="vertical" onFinish={handleSubmit}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="العميل" required style={{ marginBottom: 8 }}>
                  <Select placeholder="اختر العميل" showSearch optionFilterProp="children"
                    value={customerId ?? undefined} onChange={onCustomerChange}>
                    {customers.map((c) => (
                      <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="warehouse_id" label="مستودع استلام المرتجع (الافتراضي للسطور)"
                  rules={[{ required: true, message: 'يرجى اختيار المستودع!' }]}>
                  <Select placeholder="اختر المستودع الذي ترجع إليه البضاعة"
                    onChange={(v) => setDocWarehouseId(v as number)}>
                    {warehouses.map((w) => (
                      <Select.Option key={w.id} value={w.id}>{w.name}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Divider orientation="right" style={{ fontWeight: 700 }}>الأصناف المرتجعة</Divider>

            {!customerId ? (
              <Empty description="اختر العميل أولاً لعرض آخر أسعار الشراء تلقائياً" style={{ margin: '12px 0' }} />
            ) : (
              <>
                <Row gutter={16}>
                <Col xs={24} lg={18}>
                <Button
                  type="primary" danger size="large" icon={<PlusOutlined />} block
                  style={{ marginBottom: 14, height: 46 }}
                  onClick={() => setPickerOpen(true)}
                >
                  إضافة صنف للمرتجع
                </Button>

                <ProductPickerModal
                  open={pickerOpen}
                  title="اختر الصنف المرتجع"
                  categories={productCategories}
                  categoryLabels={categoryLabels}
                  products={products}
                  activeCategory={activeCategory}
                  onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
                  onCancel={() => setPickerOpen(false)}
                  onPick={(id) => {
                    setPickerOpen(false);
                    setPanelItemId(id);
                    addProductById(id);
                  }}
                  onPickMany={async (ids) => {
                    setPickerOpen(false);
                    for (const id of ids) await addProductById(id);
                    if (ids.length) setPanelItemId(ids[ids.length - 1]);
                  }}
                />

                {lines.length === 0 ? (
                  <Empty description="اختر الفئة ثم الأصناف لإضافتها للمرتجع" style={{ margin: '12px 0' }} />
                ) : (
                  linesByCategory.map((group) => (
                    <div key={group.category ?? '__none__'}
                      style={{ border: '1px solid #e6efe3', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                      <div style={{ background: '#fdf3ee', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color="volcano" style={{ fontWeight: 700, margin: 0 }}>
                          {group.category ? (categoryLabels[group.category] || group.category) : 'بدون فئة'}
                        </Tag>
                        <span style={{ color: '#8a8a8a', fontSize: 12 }}>{group.items.length} صنف</span>
                      </div>

                      <Row gutter={8} style={{ padding: '6px 12px 0', color: '#8a8a8a', fontSize: 12 }}>
                        <Col md={5}>الصنف</Col>
                        <Col md={3}>المخزن</Col>
                        <Col md={3}>آخر سعر شراء</Col>
                        <Col md={2}>الكمية</Col>
                        <Col md={3}>سعر الإرجاع</Col>
                        <Col md={2}>خصم %</Col>
                        <Col md={2} style={{ textAlign: 'center' }}>النقاط</Col>
                        <Col md={3} style={{ textAlign: 'center' }}>الإجمالي</Col>
                        <Col md={1} />
                      </Row>

                      {group.items.map((line) => {
                        const info = line.item_id ? lastInfo[line.item_id] : undefined;
                        const last = info?.last_price;
                        return (
                          <div key={line.key} style={{ padding: '4px 12px 6px', borderTop: '1px solid #f5efec' }}>
                            <Row gutter={8} align="middle">
                              <Col md={5} xs={24}><b>{productName(line.item_id as number)}</b></Col>
                              <Col md={3} xs={12}>
                                {/* (030) Goods may come back into a different warehouse per line. */}
                                <Select size="small" style={{ width: '100%' }}
                                  placeholder="المخزن"
                                  value={line.warehouse_id ?? docWarehouseId ?? undefined}
                                  onChange={(val) => handleLineChange(line.key, 'warehouse_id', val)}
                                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                              </Col>
                              <Col md={3} xs={12}>
                                {last != null ? (
                                  <Tag color="green" style={{ cursor: 'pointer' }}
                                    onClick={() => setHistModal({
                                      name: productName(line.item_id as number),
                                      rows: info?.history || [],
                                    })}>
                                    <HistoryOutlined /> {money(last)} ج.م
                                  </Tag>
                                ) : (
                                  <Tag>لم يشترِه من قبل</Tag>
                                )}
                              </Col>
                              <Col md={2} xs={8}>
                                <InputNumber size="small" min={0.001} style={{ width: '100%' }}
                                  ref={(el) => { qtyRefs.current[line.key] = el; }}
                                  value={line.quantity}
                                  onChange={(val) => handleLineChange(line.key, 'quantity', val || 1)}
                                  // Enter means "this line is done" — straight back to the picker.
                                  onPressEnter={() => setPickerOpen(true)} />
                              </Col>
                              <Col md={3} xs={8}>
                                <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
                                  value={line.unit_price}
                                  onChange={(val) => handleLineChange(line.key, 'unit_price', val || 0)} />
                              </Col>
                              <Col md={2} xs={8}>
                                <InputNumber size="small" min={0} max={100} step={0.5} style={{ width: '100%' }}
                                  value={line.discount}
                                  onChange={(val) => handleLineChange(line.key, 'discount', val || 0)} />
                              </Col>
                              <Col md={2} xs={12} style={{ textAlign: 'center' }}>
                                <span style={{ color: '#F5A11D', fontWeight: 600 }}>
                                  {linePoints(line).toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
                                </span>
                              </Col>
                              <Col md={3} xs={12} style={{ textAlign: 'center' }}>
                                <b style={{ color: '#cf4b1a' }}>{lineTotal(line).toFixed(2)}</b>
                              </Col>
                              <Col md={1} xs={4} style={{ textAlign: 'center' }}>
                                <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                  onClick={() => handleRemoveLine(line.key)} />
                              </Col>
                            </Row>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                </Col>
                <Col xs={24} lg={6}>
                  <ItemStockPanel itemId={panelItemId} category={activeCategory}
                    products={products} onPickItem={(id) => setPanelItemId(id)} />
                </Col>
                </Row>
              </>
            )}

            {/* Same ladder as the invoice, mirrored: a return gives money back instead of
                taking it, so the bottom line is what the customer still owes AFTER it. */}
            {(() => {
              const returnDiscount = grossTotal - netTotal;
              const hasParty = !!customerId && customerBalance !== null;
              const balance = customerBalance ?? 0;
              const after = balance - creditReduction;
              return (
                <TotalsLadder
                  tone="return"
                  inputs={(
                    <>
                      <Form.Item label="خصم على إجمالي المرتجع" style={{ marginBottom: 12 }}>
                        <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%"
                          value={discountPct} onChange={(val) => setDiscountPct(val || 0)} />
                      </Form.Item>
                      <Form.Item label="المبلغ المسترد نقداً" style={{ marginBottom: 0 }}
                        help="الباقي بيتخصم من حساب العميل">
                        <InputNumber min={0} style={{ width: '100%' }} addonAfter="ج.م"
                          value={cashRefund} onChange={(val) => setCashRefund(val || 0)} />
                      </Form.Item>
                    </>
                  )}
                  rows={[
                    { label: 'إجمالي الأصناف المرتجعة', value: grossTotal.toFixed(2) },
                    { label: `خصم المرتجع (${discountPct}%)`,
                      value: `− ${returnDiscount.toFixed(2)}`, color: '#cf1322',
                      show: returnDiscount > 0.001 },
                    { label: 'صافي المرتجع', value: netTotal.toFixed(2),
                      strong: true, color: '#cf4b1a', rule: true },
                    { label: 'حساب سابق على العميل', value: money(balance),
                      color: balance > 0 ? '#cf1322' : '#6AB42D',
                      show: hasParty && Math.abs(balance) > 0.001 },
                    { label: 'يُخصم من حسابه (آجل)', value: `− ${money(creditReduction)}`,
                      color: '#6AB42D', show: hasParty && creditReduction > 0.001 },
                    { label: 'الباقي على العميل', value: money(after), big: true, rule: true,
                      color: after > 0.001 ? '#cf1322' : '#6AB42D', show: hasParty },
                  ]}
                  notes={[
                    <>نقاط تُخصم من العميل: <b style={{ color: '#F5A11D' }}>
                      {totalPoints.toLocaleString('ar-EG', { maximumFractionDigits: 3 })}</b></>,
                    cashRefund > 0.001 ? (
                      <>مسترد نقداً: <b style={{ color: '#cf4b1a' }}>{money(cashRefund)} ج.م</b></>
                    ) : null,
                  ]}
                />
              );
            })()}

            <Form.Item style={{ marginTop: 20, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Space>
                  <Button type="primary" danger size="large" htmlType="submit">
                    تسجيل وحفظ مرتجع المبيعات
                  </Button>
                  <Button size="large" onClick={closeCreate}>إلغاء</Button>
                </Space>
              </div>
            </Form.Item>
          </Form>
        </Card>

        <Modal centered width={560} open={!!histModal} onCancel={() => setHistModal(null)}
          title={`سجل شراء العميل — ${histModal?.name ?? ''}`}
          footer={<Button onClick={() => setHistModal(null)}>إغلاق</Button>}>
          <Table size="small" pagination={false} rowKey="document_number"
            dataSource={histModal?.rows || []}
            locale={{ emptyText: 'لا يوجد سجل شراء لهذا الصنف' }}
            columns={[
              { title: 'الفاتورة', dataIndex: 'document_number', render: (d: string) => <Tag color="blue">{d}</Tag> },
              { title: 'التاريخ', dataIndex: 'date', render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
              { title: 'الكمية', dataIndex: 'quantity', render: (q: string) => Number(q) },
              { title: 'سعر الوحدة', dataIndex: 'unit_price', render: (v: string) => `${money(v)} ج.م` },
              { title: 'السعر الفعلي', dataIndex: 'effective_price',
                render: (v: string) => <strong style={{ color: '#6AB42D' }}>{money(v)} ج.م</strong> },
            ]} />
        </Modal>
      </div>
    );
  }

  // --- The list --------------------------------------------------------------------------------
  const columns = [
    {
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number',
      render: (doc: string) => <Tag color="volcano">{doc}</Tag>,
    },
    {
      title: 'العميل', dataIndex: 'customer_id', key: 'customer_id',
      render: (cId: number) => customers.find((c) => c.id === cId)?.name ?? `عميل #${cId}`,
    },
    {
      title: 'صافي المرتجع', dataIndex: 'net', key: 'net',
      render: (v: string) => <strong style={{ color: '#cf4b1a' }}>{money(v)} ج.م</strong>,
    },
    { title: 'المسترد نقداً', dataIndex: 'cash_refund', key: 'cash_refund', render: (v: string) => `${money(v)} ج.م` },
    { title: 'خصم من الحساب', dataIndex: 'credit_reduction', key: 'credit_reduction', render: (v: string) => `${money(v)} ج.م` },
    {
      title: 'التاريخ', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => (v ? String(v).slice(0, 10) : '-'),
    },
  ];

  return (
    <div>
      <Card
        title="مرتجعات المبيعات"
        extra={
          <Button type="primary" danger icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>
            تسجيل مرتجع بيع
          </Button>
        }
      >
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={6}>
            <Input allowClear value={search} placeholder="بحث برقم السند" prefix={<SearchOutlined />}
              onChange={(e) => setSearch(e.target.value)} onPressEnter={applySearch} onBlur={applySearch} />
          </Col>
          <Col xs={24} md={6}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="العميل"
              value={filters.customer_id} onChange={(v) => setFilter('customer_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          </Col>
          <Col xs={16} md={8}>
            <DatePicker.RangePicker style={{ width: '100%' }}
              value={filters.date_from && filters.date_to
                ? [dayjs(filters.date_from), dayjs(filters.date_to)] : null}
              onChange={(v) => {
                const next = {
                  ...filters,
                  date_from: v?.[0] ? v[0].format('YYYY-MM-DD') : undefined,
                  date_to: v?.[1] ? v[1].format('YYYY-MM-DD') : undefined,
                };
                setFilters(next); fetchReturns(next);
              }} />
          </Col>
          <Col xs={8} md={4}>
            <Button icon={<ClearOutlined />} onClick={resetFilters} block>مسح</Button>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}><Card size="small"><Statistic title="عدد المرتجعات الظاهرة" value={summary.count} /></Card></Col>
          <Col xs={24} md={8}><Card size="small"><Statistic title="إجمالي صافي المرتجعات" value={money(summary.net)} suffix="ج.م" /></Card></Col>
          <Col xs={24} md={8}><Card size="small"><Statistic title="إجمالي الخصم من الحسابات" value={money(summary.credit)} suffix="ج.م" /></Card></Col>
        </Row>

        <Table
          dataSource={returns} columns={columns} rowKey="id" loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
          onRow={(record) => ({ onClick: () => openDetail(record), style: { cursor: 'pointer' } })}
        />
      </Card>

      <Modal centered title={`تفاصيل المرتجع ${viewReturn?.document_number ?? ''}`} width={680}
        open={detailVisible} onCancel={() => setDetailVisible(false)} destroyOnHidden
        footer={invoiceFooter(returnDoc(viewReturn), () => setDetailVisible(false))}>
        {viewReturn && (
          <>
            <InvoiceDocument doc={returnDoc(viewReturn)!}
              onItemClick={(id) => { setDetailVisible(false); navigate(`/catalog/${id}`); }}
              onPartyClick={(id) => { setDetailVisible(false); navigate(`/customers/${id}`); }} />
            {viewReturn.customer_id && (
              <CustomerAccountPanel customerId={viewReturn.customer_id} />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
