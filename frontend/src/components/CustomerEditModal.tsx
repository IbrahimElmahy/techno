import React, { useEffect, useState } from 'react';
import {
  Form, Input, Select, Switch, Space, Button, Spin, Row, Col, message
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useLookup } from '../hooks/useLookup';
import { TabModal } from './TabModal';

/**
 * ONE edit form for a customer — data, address, phones, responsible rep/territory and price
 * tier — shared by the customers grid and the customer file, so both screens edit the same
 * fields the same way.
 *
 * Rep/territory still go through the reassign endpoint (it preserves the account balance and
 * keeps past movement attributed to the previous rep); everything else is a plain PATCH.
 */

const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري',
  semi_commercial: 'نصف تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نصف جملة',
  consumer: 'مستهلك',
};

const ExtraPhonesList = () => (
  <Form.List name="phones">
    {(fields, { add, remove }) => (
      <>
        <div style={{ marginBottom: 8 }}>أرقام هاتف إضافية</div>
        {fields.map((field) => (
          <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
            <Form.Item {...field} style={{ marginBottom: 0, flex: 1 }}>
              <Input placeholder="مثال: 01000000000" style={{ width: 300 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(field.name)} />
          </Space>
        ))}
        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
            إضافة رقم
          </Button>
        </Form.Item>
      </>
    )}
  </Form.List>
);

export default function CustomerEditModal({
  customer, customerId, open, onClose, onSaved,
}: {
  /** Pass the loaded record when you already have it; otherwise pass just the id. */
  customer?: any;
  customerId?: number | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<any>(null);
  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [governorates, setGovernorates] = useState<any[]>([]);
  const { options: typeOptions } = useLookup('customer_type');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [c, users, terr, gov] = await Promise.all([
          customer
            ? Promise.resolve({ data: customer })
            : api.get(`/api/v1/customers/${customerId}`),
          api.get('/api/v1/users'),
          api.get('/api/v1/territories'),
          api.get('/api/v1/governorates'),
        ]);
        if (cancelled) return;
        const rec = c.data;
        setRecord(rec);
        setReps(users.data.filter((u: any) => u.role === 'sales_rep'));
        setTerritories(terr.data);
        setGovernorates(gov.data);
        form.setFieldsValue({
          name: rec.name,
          phone: rec.phone,
          customer_type: rec.customer_type,
          default_price_tier: rec.default_price_tier ?? undefined,
          governorate_id: rec.governorate_id ?? undefined,
          markaz: rec.markaz ?? undefined,
          address: rec.address ?? undefined,
          phones: rec.phones ?? [],
          rep_id: rec.rep_id,
          territory_id: rec.territory_id,
          active: rec.active,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, customerId, customer]);

  const cleanPhones = (phones: any): string[] =>
    (phones || []).map((p: any) => (p || '').trim()).filter(Boolean);

  const onFinish = async (v: any) => {
    if (!record) return;
    setSaving(true);
    try {
      if (v.rep_id !== record.rep_id || v.territory_id !== record.territory_id) {
        await api.post(`/api/v1/customers/${record.id}/reassign`, {
          new_rep_id: v.rep_id,
          new_territory_id: v.territory_id,
        });
      }
      await api.patch(`/api/v1/customers/${record.id}`, {
        name: v.name,
        phone: v.phone,
        customer_type: v.customer_type,
        default_price_tier: v.default_price_tier ?? null,
        active: v.active,
        governorate_id: v.governorate_id ?? null,
        markaz: v.markaz ?? null,
        address: v.address ?? null,
        phones: cleanPhones(v.phones),
      });
      message.success('تم حفظ بيانات العميل');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TabModal
      open={open}
      title={record ? `تعديل بيانات العميل: ${record.name}` : 'تعديل بيانات العميل'}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="حفظ"
      cancelText="إلغاء"
      confirmLoading={saving}
      width={680}
      centered
      destroyOnHidden
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="اسم العميل (الكامل)"
                rules={[{ required: true, message: 'يرجى إدخال اسم العميل!' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="customer_type" label="تصنيف العميل"
                rules={[{ required: true, message: 'يرجى تحديد نوع العميل!' }]}>
                <Select options={typeOptions.map((o) => ({ value: o.value, label: o.label }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="رقم الهاتف">
                <Input placeholder="مثال: 01000000000" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="governorate_id" label="المحافظة">
                <Select allowClear showSearch
                  filterOption={(i, o) => String(o?.label ?? '').includes(i)}
                  options={governorates.map((g: any) => ({ value: g.id, label: g.name }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="markaz" label="المركز"><Input /></Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="default_price_tier" label="الفئة السعرية الافتراضية"
                extra="تُستخدم تلقائياً على فواتير هذا العميل">
                <Select allowClear placeholder="مستهلك (افتراضي)"
                  options={Object.entries(TIER_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="address" label="العنوان">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col xs={24}><ExtraPhonesList /></Col>
            <Col xs={24} md={12}>
              <Form.Item name="rep_id" label="المندوب المسؤول"
                rules={[{ required: true, message: 'يرجى تحديد المندوب!' }]}>
                <Select showSearch filterOption={(i, o) => String(o?.label ?? '').includes(i)}
                  options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="territory_id" label="المنطقة الجغرافية"
                rules={[{ required: true, message: 'يرجى تحديد المنطقة!' }]}>
                <Select showSearch filterOption={(i, o) => String(o?.label ?? '').includes(i)}
                  options={territories.map((t) => ({ value: t.id, label: t.name }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="active" label="الحالة" valuePropName="checked">
                <Switch checkedChildren="نشط" unCheckedChildren="معطل" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      )}
    </TabModal>
  );
}
