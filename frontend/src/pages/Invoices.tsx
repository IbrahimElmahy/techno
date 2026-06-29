import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, InputNumber, Select, Tag, message, Divider, Row, Col, Result } from 'antd';
import { PlusOutlined, RollbackOutlined, EyeOutlined, FileTextOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';

interface InvoiceRecord {
  id: number;
  document_number: string;
  customer_id: number;
  gross: string;
  combined_pct: string;
  net: string;
  cash_amount: string;
  credit_amount: string;
  ledger_entry_id: number;
}

interface Customer {
  id: number;
  name: string;
  default_price_tier: string | null;
}

const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري',
  semi_commercial: 'نصف تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نصف جملة',
  consumer: 'مستهلك',
};

interface Product {
  id: number;
  code: string;
  name: string;
  sale_price: string | null;
  is_serialized: boolean;
}

interface Warehouse {
  id: number;
  name: string;
}

interface SaleLineItem {
  key: string;
  item_id: number | null;
  quantity: number;
  unit_price: number;
  tier: string | null;
  unit: string | null;
  serials: string;
}

interface ItemUnit { name: string; factor: number; is_base: boolean; }

interface InvoiceDetail {
  id: number;
  lines: Array<{
    item_id: number;
    quantity: string;
    unit_price: string;
    line_total: string;
  }>;
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);

  // Drawers
  const [createVisible, setCreateVisible] = useState(false);
  const [returnVisible, setReturnVisible] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);

  // Forms
  const [createForm] = Form.useForm();
  const [returnForm] = Form.useForm();

  // Create invoice dynamic lines
  const [lines, setLines] = useState<SaleLineItem[]>([
    { key: '1', item_id: null, quantity: 1, unit_price: 0, tier: null, unit: null, serials: '' },
  ]);
  // Cache of each item's tier prices, so the line price follows the chosen tier (matches backend).
  const [pricesCache, setPricesCache] = useState<Record<number, { base: number | null; tiers: Record<string, number> }>>({});
  const [unitsCache, setUnitsCache] = useState<Record<number, ItemUnit[]>>({});
  const [customerTier, setCustomerTier] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);

  // Return quantities tracking
  const [returnQtys, setReturnQtys] = useState<Record<number, number>>({});

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/sales');
      setInvoices(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadLookups = async () => {
    try {
      const [custRes, prodRes, whRes] = await Promise.all([
        api.get('/api/v1/customers'),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
      ]);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
      setWarehouses(whRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchInvoices();
    loadLookups();
  }, []);

  // Invoice computations
  const grossTotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const netTotal = grossTotal * (1 - discountPct / 100);

  useEffect(() => {
    const cash = parseFloat(cashAmount.toString()) || 0;
    const credit = Math.max(0, netTotal - cash);
    setCreditAmount(parseFloat(credit.toFixed(2)));
  }, [cashAmount, netTotal, discountPct]);

  const handleAddLine = () => {
    const newKey = Date.now().toString();
    setLines([...lines, { key: newKey, item_id: null, quantity: 1, unit_price: 0, tier: customerTier, unit: null, serials: '' }]);
  };

  const handleRemoveLine = (key: string) => {
    if (lines.length === 1) return;
    setLines(lines.filter((l) => l.key !== key));
  };

  const unitFactor = (itemId: number, unit: string | null): number => {
    if (!unit) return 1;
    const u = (unitsCache[itemId] || []).find((x) => x.name === unit);
    return u ? u.factor : 1;
  };

  // Resolve a line's price = base-tier price × unit factor (matches the backend, 007+008).
  const resolvePrice = (itemId: number, tier: string | null, unit: string | null): number => {
    const c = pricesCache[itemId];
    let base: number;
    if (!c) {
      const prod = products.find((p) => p.id === itemId);
      base = prod?.sale_price ? parseFloat(prod.sale_price) : 0;
    } else {
      base = (tier && c.tiers[tier] != null) ? c.tiers[tier] : (c.base ?? 0);
    }
    return base * unitFactor(itemId, unit);
  };

  const fetchPrices = async (itemId: number) => {
    if (!pricesCache[itemId]) {
      try {
        const res = await api.get(`/api/v1/items/${itemId}/prices`);
        const tiers: Record<string, number> = {};
        (res.data.tiers || []).forEach((t: any) => { tiers[t.tier] = parseFloat(t.price); });
        setPricesCache((prev) => ({ ...prev, [itemId]: { base: res.data.base_sale_price ? parseFloat(res.data.base_sale_price) : null, tiers } }));
      } catch (err) { console.error(err); }
    }
    if (!unitsCache[itemId]) {
      try {
        const res = await api.get(`/api/v1/items/${itemId}/units`);
        setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({ name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
      } catch (err) { console.error(err); }
    }
  };

  const handleLineChange = async (key: string, field: keyof SaleLineItem, value: any) => {
    if (field === 'item_id' && value) await fetchPrices(value);
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, [field]: value };
        if (field === 'item_id') {
          updated.tier = l.tier || customerTier || 'consumer';
          updated.unit = null;  // default to base
          updated.unit_price = resolvePrice(value, updated.tier, null);
        } else if ((field === 'tier' || field === 'unit') && l.item_id) {
          updated.unit_price = resolvePrice(l.item_id, updated.tier, updated.unit);
        }
        return updated;
      })
    );
  };

  const [barcode, setBarcode] = useState('');
  const scanBarcode = async () => {
    const code = barcode.trim();
    if (!code) return;
    try {
      const res = await api.get(`/api/v1/barcodes/${encodeURIComponent(code)}`);
      const d = res.data; // { item_id, unit, factor, base_sale_price }
      if (!products.find((p) => p.id === d.item_id)) {
        message.error('هذا الباركود لصنف غير قابل للبيع هنا'); return;
      }
      await fetchPrices(d.item_id);
      const tier = customerTier || 'consumer';
      const price = (d.base_sale_price ? parseFloat(d.base_sale_price) : 0) * parseFloat(d.factor);
      const newLine = {
        key: Date.now().toString(), item_id: d.item_id, quantity: 1, tier,
        unit: d.unit || null, unit_price: price, serials: '',
      };
      setLines((prev) => (prev.length === 1 && prev[0].item_id === null) ? [newLine] : [...prev, newLine]);
      setBarcode('');
    } catch (err: any) {
      if (err?.response?.status === 404) message.error('باركود غير معروف');
      else console.error(err);
    }
  };

  const onCustomerChange = (customerId: number) => {
    const c = customers.find((x) => x.id === customerId);
    const tier = c?.default_price_tier ?? null;
    setCustomerTier(tier);
    setLines((prev) => prev.map((l) => l.item_id
      ? { ...l, tier: tier || 'consumer', unit_price: resolvePrice(l.item_id, tier || 'consumer', l.unit) }
      : { ...l, tier }));
  };

  const handleCreateSubmit = async (values: any) => {
    const totalSplit = cashAmount + creditAmount;
    if (Math.abs(totalSplit - netTotal) > 0.01) {
      message.error('مجموع المدفوع والآجل يجب أن يساوي صافي الفاتورة!');
      return;
    }

    const validLines = lines.filter((l) => l.item_id !== null);
    if (validLines.length === 0) {
      message.error('يرجى إضافة منتج واحد صالح على الأقل!');
      return;
    }

    // Serialized lines: serial count must equal the quantity.
    const parseSerials = (s: string) => s.split(/[\s,\n]+/).map((x) => x.trim()).filter(Boolean);
    for (const l of validLines) {
      const prod = products.find((p) => p.id === l.item_id);
      if (prod?.is_serialized) {
        const ser = parseSerials(l.serials);
        if (ser.length !== l.quantity) {
          message.error(`«${prod.name}»: عدد الأرقام التسلسلية يجب أن يساوي الكمية (${l.quantity})`);
          return;
        }
      }
    }

    try {
      await api.post('/api/v1/sales', {
        customer_id: values.customer_id,
        origin: {
          location_kind: 'warehouse',
          location_id: values.warehouse_id,
        },
        variable_discount_pct: discountPct,
        cash_amount: cashAmount,
        credit_amount: creditAmount,
        lines: validLines.map((l) => {
          const prod = products.find((p) => p.id === l.item_id);
          return {
            item_id: l.item_id,
            quantity: l.quantity,
            tier: l.tier,
            unit: l.unit,
            unit_price: l.unit_price.toFixed(2),
            serials: prod?.is_serialized ? parseSerials(l.serials) : null,
          };
        }),
      });

      message.success('تم تسجيل فاتورة البيع بنجاح');
      setCreateVisible(false);
      createForm.resetFields();
      setLines([{ key: '1', item_id: null, quantity: 1, unit_price: 0, tier: null, unit: null, serials: '' }]);
      setCashAmount(0);
      setDiscountPct(0);
      fetchInvoices();
    } catch (err) {
      console.error(err);
    }
  };

  // Process returns wizard
  const openReturnWizard = async (record: InvoiceRecord) => {
    setSelectedInvoice(record);
    setReturnQtys({});
    try {
      const res = await api.get(`/api/v1/sales/${record.id}`);
      setInvoiceDetail(res.data);
      setReturnVisible(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReturnSubmit = () => {
    if (!selectedInvoice || !invoiceDetail) return;
    const linesToReturn = Object.entries(returnQtys)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, qty]) => ({
        item_id: parseInt(itemId, 10),
        quantity: qty,
      }));

    if (linesToReturn.length === 0) {
      message.warning('يرجى تحديد كميات مرتجعة أكبر من الصفر للأصناف المعنية');
      return;
    }

    showReversalConfirm({
      title: 'تأكيد إرجاع أصناف الفاتورة',
      content: `هل أنت متأكد من حفظ مرتجعات الفاتورة "${selectedInvoice.document_number}"؟ سيتم توليد سند مرتجع وعكس الرصيد المالي المقابل للعميل فوراً.`,
      onOk: async () => {
        try {
          const res = await api.post(`/api/v1/sales/${selectedInvoice.id}/returns`, {
            lines: linesToReturn,
          });
          message.success(`تم تسجيل المرتجع بنجاح. رقم السند: ${res.data.document_number}`);
          setReturnVisible(false);
          fetchInvoices();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const columns = [
    {
      title: 'رقم الفاتورة',
      dataIndex: 'document_number',
      key: 'document_number',
      render: (doc: string) => <Tag color="blue">{doc}</Tag>,
    },
    {
      title: 'العميل',
      dataIndex: 'customer_id',
      key: 'customer_id',
      render: (cId: number) => {
        const c = customers.find((cust) => cust.id === cId);
        return c ? c.name : `عميل #${cId}`;
      },
    },
    {
      title: 'القيمة الإجمالية (Gross)',
      dataIndex: 'gross',
      key: 'gross',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'نسبة الخصم المدمج',
      dataIndex: 'combined_pct',
      key: 'combined_pct',
      render: (val: string) => `${parseFloat(val).toFixed(0)}%`,
    },
    {
      title: 'الصافي المطلوب (Net)',
      dataIndex: 'net',
      key: 'net',
      render: (val: string) => <strong style={{ color: '#6AB42D' }}>{parseFloat(val).toFixed(2)} ج.م</strong>,
    },
    {
      title: 'المدفوع نقداً',
      dataIndex: 'cash_amount',
      key: 'cash_amount',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'المتبقي آجل',
      dataIndex: 'credit_amount',
      key: 'credit_amount',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: InvoiceRecord) => (
        <Space size="middle">
          <Button
            type="dashed"
            icon={<RollbackOutlined />}
            onClick={() => openReturnWizard(record)}
          >
            إرجاع الفاتورة
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="الفواتير (سجل فواتير المبيعات)"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>
            تسجيل فاتورة بيع
          </Button>
        }
      >
        <Table
          dataSource={invoices}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Create Sale Invoice Drawer */}
      <Drawer
        title="تسجيل فاتورة بيع جديدة"
        width={650}
        onClose={() => setCreateVisible(false)}
        open={createVisible}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreateSubmit} requiredMark={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="customer_id"
                label="العميل المشتري"
                rules={[{ required: true, message: 'يرجى اختيار العميل!' }]}
              >
                <Select placeholder="اختر العميل" onChange={onCustomerChange} showSearch optionFilterProp="children">
                  {customers.map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}{c.default_price_tier ? ` — ${TIER_LABELS[c.default_price_tier]}` : ''}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="warehouse_id"
                label="مستودع الصرف والتسليم"
                rules={[{ required: true, message: 'يرجى اختيار مستودع الصرف!' }]}
              >
                <Select placeholder="اختر المستودع">
                  {warehouses.map((w) => (
                    <Select.Option key={w.id} value={w.id}>
                      {w.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="right">المنتجات المباعة</Divider>

          <Input.Search
            placeholder="امسح أو أدخل باركود ثم اضغط Enter لإضافة سطر"
            prefix={<span style={{ color: '#888' }}>باركود:</span>}
            enterButton="إضافة"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onSearch={scanBarcode}
            style={{ marginBottom: 12 }}
          />

          {lines.map((line) => (
            <Row gutter={6} key={line.key} align="middle" style={{ marginBottom: 12 }}>
              <Col span={7}>
                <Select
                  placeholder="اختر المنتج"
                  style={{ width: '100%' }}
                  value={line.item_id}
                  showSearch optionFilterProp="children"
                  onChange={(val) => handleLineChange(line.key, 'item_id', val)}
                >
                  {products.map((p) => (
                    <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={4}>
                <Select placeholder="الفئة" style={{ width: '100%' }} value={line.tier ?? undefined}
                  onChange={(val) => handleLineChange(line.key, 'tier', val)}>
                  {Object.entries(TIER_LABELS).map(([k, l]) => (
                    <Select.Option key={k} value={k}>{l}</Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={4}>
                <Select placeholder="الوحدة" style={{ width: '100%' }} value={line.unit ?? '__base__'}
                  disabled={!line.item_id}
                  onChange={(val) => handleLineChange(line.key, 'unit', val === '__base__' ? null : val)}>
                  {(unitsCache[line.item_id || 0] || []).map((u) => (
                    <Select.Option key={u.name} value={u.is_base ? '__base__' : u.name}>
                      {u.name}{u.is_base ? '' : ` (×${u.factor})`}
                    </Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={3}>
                <InputNumber min={1} style={{ width: '100%' }} value={line.quantity}
                  onChange={(val) => handleLineChange(line.key, 'quantity', val || 1)} placeholder="الكمية" />
              </Col>
              <Col span={4}>
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} value={line.unit_price}
                  onChange={(val) => handleLineChange(line.key, 'unit_price', val || 0)} placeholder="السعر" />
              </Col>
              <Col span={2}>
                <Button type="text" danger onClick={() => handleRemoveLine(line.key)}>حذف</Button>
              </Col>
              {line.item_id && products.find((p) => p.id === line.item_id)?.is_serialized && (
                <Col span={24} style={{ marginTop: 6 }}>
                  <Input size="small" prefix="سيريال:" placeholder="أرقام تسلسلية مفصولة بمسافة/فاصلة (يجب أن يساوي عددها الكمية)"
                    value={line.serials}
                    onChange={(e) => handleLineChange(line.key, 'serials', e.target.value)} />
                </Col>
              )}
            </Row>
          ))}

          <Button type="dashed" onClick={handleAddLine} block icon={<PlusOutlined />} style={{ marginBottom: 24 }}>
            إضافة منتج آخر
          </Button>

          <Divider />

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item label="الخصم الإضافي (%)">
                <InputNumber
                  min={0}
                  max={100}
                  style={{ width: '100%' }}
                  value={discountPct}
                  onChange={(val) => setDiscountPct(val || 0)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 8, textAlign: 'center' }}>
                <span style={{ fontSize: '12px', color: '#888' }}>إجمالي الفاتورة الصافي</span>
                <h3 style={{ margin: '4px 0 0', color: '#6AB42D' }}>{netTotal.toFixed(2)} ج.م</h3>
              </div>
            </Col>
            <Col span={6}>
              <Form.Item label="المبلغ المدفوع نقداً">
                <InputNumber
                  min={0}
                  style={{ width: '100%' }}
                  value={cashAmount}
                  onChange={(val) => setCashAmount(val || 0)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="المتبقي آجل">
                <InputNumber
                  disabled
                  style={{ width: '100%' }}
                  value={creditAmount}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                تسجيل وحفظ فاتورة البيع
              </Button>
              <Button onClick={() => setCreateVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>

      {/* Return Invoice Drawer */}
      <Drawer
        title={`مرتجع مبيعات للفاتورة: ${selectedInvoice?.document_number || ''}`}
        width={500}
        onClose={() => setReturnVisible(false)}
        open={returnVisible}
        destroyOnHidden
      >
        <div style={{ marginBottom: 20 }}>
          <p>يرجى إدخال الكميات المراد إرجاعها من كل صنف مباع. سيتم حساب قيمة المرتجعات المالية تلقائياً بالخلفية وعكس قيد اليومية المقابل.</p>
        </div>

        {invoiceDetail?.lines.map((line) => {
          const prod = products.find((p) => p.id === line.item_id);
          return (
            <div key={line.item_id} style={{ marginBottom: 20, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8 }}>
              <h4>{prod ? prod.name : `منتج #${line.item_id}`}</h4>
              <Row gutter={16}>
                <Col span={12}>
                  <span>الكمية المشتراة بالفاتورة: </span>
                  <strong>{line.quantity} وحدات</strong>
                </Col>
                <Col span={12}>
                  <Form.Item label="الكمية المرتجعة" style={{ marginBottom: 0 }}>
                    <InputNumber
                      min={0}
                      max={parseFloat(line.quantity)}
                      value={returnQtys[line.item_id] || 0}
                      onChange={(val) => setReturnQtys({ ...returnQtys, [line.item_id]: val || 0 })}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </div>
          );
        })}

        <div style={{ marginTop: 30 }}>
          <Space>
            <Button type="primary" danger onClick={handleReturnSubmit}>
              تأكيد وحفظ المرتجع
            </Button>
            <Button onClick={() => setReturnVisible(false)}>إلغاء</Button>
          </Space>
        </div>
      </Drawer>
    </div>
  );
}
