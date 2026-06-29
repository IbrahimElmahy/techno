import React, { useEffect, useState } from 'react';
import { Form, Input, Button, Card, Select, Table, Space, Row, Col, InputNumber, Divider, message, Modal, Result } from 'antd';
import { PlusOutlined, DeleteOutlined, FileDoneOutlined } from '@ant-design/icons';
import { api } from '../api/client';

interface Supplier {
  id: number;
  name: string;
  code: string;
}

interface Warehouse {
  id: number;
  name: string;
  warehouse_type: string;
}

interface RawMaterial {
  id: number;
  code: string;
  name: string;
  unit_of_measure: string;
  purchase_price: string | null;
}

interface PurchaseItem {
  key: string;
  item_id: number | null;
  quantity: number;
  unit_price: number;
}

export default function Purchases() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);

  // Form state
  const [form] = Form.useForm();
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([
    { key: '1', item_id: null, quantity: 1, unit_price: 0 },
  ]);

  // Payment splits
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState<number>(0);

  // Document creation result
  const [docResult, setDocResult] = useState<any>(null);

  const loadLookups = async () => {
    setLoading(true);
    try {
      const [supRes, whRes, itemsRes] = await Promise.all([
        api.get('/api/v1/suppliers'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/items?kind=raw_material'),
      ]);
      setSuppliers(supRes.data);
      // Filter out central/branch warehouses
      setWarehouses(whRes.data);
      setItems(itemsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLookups();
  }, []);

  const handleAddItem = () => {
    const newKey = (purchaseItems.length + 1).toString();
    setPurchaseItems([
      ...purchaseItems,
      { key: newKey, item_id: null, quantity: 1, unit_price: 0 },
    ]);
  };

  const handleRemoveItem = (key: string) => {
    if (purchaseItems.length === 1) {
      message.warning('يجب إضافة صنف واحد على الأقل للفاتورة');
      return;
    }
    setPurchaseItems(purchaseItems.filter((i) => i.key !== key));
  };

  const handleItemChange = (key: string, field: keyof PurchaseItem, value: any) => {
    const updated = purchaseItems.map((item) => {
      if (item.key === key) {
        let updatedItem = { ...item, [field]: value };
        // Auto-fill price if item changes
        if (field === 'item_id') {
          const selected = items.find((i) => i.id === value);
          updatedItem.unit_price = selected?.purchase_price ? parseFloat(selected.purchase_price) : 0;
        }
        return updatedItem;
      }
      return item;
    });
    setPurchaseItems(updated);
  };

  // Calculations
  const calculateTotal = () => {
    return purchaseItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  };

  const invoiceTotal = calculateTotal();

  const handleSplitBalance = () => {
    // Automatically fill credit with remaining total
    const cash = parseFloat(cashAmount.toString()) || 0;
    const credit = Math.max(0, invoiceTotal - cash);
    setCreditAmount(parseFloat(credit.toFixed(2)));
  };

  useEffect(() => {
    handleSplitBalance();
  }, [cashAmount, invoiceTotal]);

  const handleSubmit = async (values: any) => {
    const totalSplit = cashAmount + creditAmount;
    if (Math.abs(totalSplit - invoiceTotal) > 0.01) {
      message.error('عذراً، يجب أن يتطابق مجموع المدفوع النقدي والآجل مع إجمالي الفاتورة!');
      return;
    }

    const validLines = purchaseItems.filter((i) => i.item_id !== null);
    if (validLines.length === 0) {
      message.error('يرجى إضافة صنف واحد صالح على الأقل!');
      return;
    }

    setSubmitLoading(true);
    try {
      const payload = {
        supplier_id: values.supplier_id,
        location: {
          location_kind: 'warehouse',
          location_id: values.warehouse_id,
        },
        cash_amount: cashAmount,
        credit_amount: creditAmount,
        lines: validLines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
      };

      const res = await api.post('/api/v1/purchases', payload);
      setDocResult(res.data);
      message.success('تم تسجيل فاتورة الشراء بنجاح');
      form.resetFields();
      setPurchaseItems([{ key: '1', item_id: null, quantity: 1, unit_price: 0 }]);
      setCashAmount(0);
      setCreditAmount(0);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitLoading(false);
    }
  };

  if (docResult) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
        <Card style={{ width: 600 }}>
          <Result
            status="success"
            title="تم تسجيل فاتورة الشراء بنجاح"
            subTitle={`رقم مستند الفاتورة: ${docResult.document_number} | رقم قيد اليومية: ${docResult.ledger_entry_id || 'لا يوجد'}`}
            extra={[
              <Button type="primary" key="new" onClick={() => setDocResult(null)}>
                تسجيل فاتورة جديدة
              </Button>,
            ]}
          />
        </Card>
      </div>
    );
  }

  const columns = [
    {
      title: 'الصنف (مادة خام)',
      dataIndex: 'item_id',
      key: 'item_id',
      width: '40%',
      render: (itemId: number | null, record: PurchaseItem) => (
        <Select
          placeholder="اختر المادة الخام"
          style={{ width: '100%' }}
          value={itemId}
          onChange={(val) => handleItemChange(record.key, 'item_id', val)}
        >
          {items.map((i) => (
            <Select.Option key={i.id} value={i.id}>
              {i.name} ({i.code})
            </Select.Option>
          ))}
        </Select>
      ),
    },
    {
      title: 'الكمية',
      dataIndex: 'quantity',
      key: 'quantity',
      width: '20%',
      render: (qty: number, record: PurchaseItem) => (
        <InputNumber
          min={0.01}
          style={{ width: '100%' }}
          value={qty}
          onChange={(val) => handleItemChange(record.key, 'quantity', val || 1)}
        />
      ),
    },
    {
      title: 'سعر الوحدة (ج.م)',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: '20%',
      render: (price: number, record: PurchaseItem) => (
        <InputNumber
          min={0}
          step={0.01}
          style={{ width: '100%' }}
          value={price}
          onChange={(val) => handleItemChange(record.key, 'unit_price', val || 0)}
        />
      ),
    },
    {
      title: 'الإجمالي (ج.م)',
      key: 'total',
      width: '15%',
      render: (_: any, record: PurchaseItem) => (
        <span style={{ fontWeight: 'bold' }}>
          {(record.quantity * record.unit_price).toFixed(2)}
        </span>
      ),
    },
    {
      title: 'حذف',
      key: 'delete',
      width: '5%',
      render: (_: any, record: PurchaseItem) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemoveItem(record.key)}
        />
      ),
    },
  ];

  return (
    <div>
      <Card
        title="فاتورة شراء جديدة"
        extra={<Button type="primary">تسجيل فاتورة شراء</Button>}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="supplier_id"
                label="المورد"
                rules={[{ required: true, message: 'يرجى اختيار المورد!' }]}
              >
                <Select placeholder="اختر المورد لربط المديونية">
                  {suppliers.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="warehouse_id"
                label="مستودع الاستلام"
                rules={[{ required: true, message: 'يرجى اختيار مستودع الاستلام!' }]}
              >
                <Select placeholder="اختر المستودع لاستلام المواد الخام">
                  {warehouses.map((w) => (
                    <Select.Option key={w.id} value={w.id}>
                      {w.name} ({w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="right">أصناف الفاتورة</Divider>

          <Table
            dataSource={purchaseItems}
            columns={columns}
            pagination={false}
            rowKey="key"
            style={{ marginBottom: 16 }}
          />

          <Button
            type="dashed"
            onClick={handleAddItem}
            block
            icon={<PlusOutlined />}
            style={{ marginBottom: 24 }}
          >
            إضافة صنف جديد
          </Button>

          <Divider />

          <Row gutter={16}>
            <Col span={8}>
              <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 8, textAlign: 'center' }}>
                <span style={{ fontSize: '14px', color: '#888' }}>إجمالي أصناف الفاتورة</span>
                <h2 style={{ margin: '4px 0 0', color: '#6AB42D' }}>
                  {invoiceTotal.toLocaleString('ar-EG', { minimumFractionDigits: 2 })} ج.م
                </h2>
              </div>
            </Col>
            <Col span={8}>
              <Form.Item label="المبلغ المدفوع نقداً (ج.م)">
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  value={cashAmount}
                  onChange={(val) => setCashAmount(val || 0)}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="المبلغ المتبقي آجل (على الحساب)">
                <InputNumber
                  style={{ width: '100%' }}
                  disabled
                  value={creditAmount}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginTop: 24, textAlign: 'left' }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<FileDoneOutlined />}
              size="large"
              loading={submitLoading}
            >
              تسجيل وترحيل فاتورة الشراء
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
