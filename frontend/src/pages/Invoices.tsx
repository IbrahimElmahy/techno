import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, InputNumber, Select, Tag, message, Divider, Row, Col, Result } from 'antd';
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
}

interface Product {
  id: number;
  code: string;
  name: string;
  sale_price: string | null;
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
}

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
    { key: '1', item_id: null, quantity: 1, unit_price: 0 },
  ]);
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
    const newKey = (lines.length + 1).toString();
    setLines([...lines, { key: newKey, item_id: null, quantity: 1, unit_price: 0 }]);
  };

  const handleRemoveLine = (key: string) => {
    if (lines.length === 1) return;
    setLines(lines.filter((l) => l.key !== key));
  };

  const handleLineChange = (key: string, field: keyof SaleLineItem, value: any) => {
    setLines(
      lines.map((l) => {
        if (l.key === key) {
          const updated = { ...l, [field]: value };
          if (field === 'item_id') {
            const prod = products.find((p) => p.id === value);
            updated.unit_price = prod?.sale_price ? parseFloat(prod.sale_price) : 0;
          }
          return updated;
        }
        return l;
      })
    );
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
        lines: validLines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
        })),
      });

      message.success('تم تسجيل فاتورة البيع بنجاح');
      setCreateVisible(false);
      createForm.resetFields();
      setLines([{ key: '1', item_id: null, quantity: 1, unit_price: 0 }]);
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
                <Select placeholder="اختر العميل">
                  {customers.map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}
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

          {lines.map((line, idx) => (
            <Row gutter={16} key={line.key} align="middle" style={{ marginBottom: 12 }}>
              <Col span={10}>
                <Select
                  placeholder="اختر المنتج"
                  style={{ width: '100%' }}
                  value={line.item_id}
                  onChange={(val) => handleLineChange(line.key, 'item_id', val)}
                >
                  {products.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      {p.name} ({p.sale_price ? parseFloat(p.sale_price).toFixed(2) : '0'} ج.م)
                    </Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={6}>
                <InputNumber
                  min={1}
                  style={{ width: '100%' }}
                  value={line.quantity}
                  onChange={(val) => handleLineChange(line.key, 'quantity', val || 1)}
                  placeholder="الكمية"
                />
              </Col>
              <Col span={6}>
                <span style={{ fontWeight: 'bold' }}>
                  {(line.quantity * line.unit_price).toFixed(2)} ج.م
                </span>
              </Col>
              <Col span={2}>
                <Button type="text" danger onClick={() => handleRemoveLine(line.key)}>
                  حذف
                </Button>
              </Col>
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
