import React, { useEffect, useState } from 'react';
import {
  Form, Input, Switch, Space, Button, Spin, Row, Col, message
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { TabModal } from './TabModal';

/**
 * ONE edit form for a supplier — shared by the suppliers grid and the supplier file.
 */

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

export default function SupplierEditModal({
  supplier, supplierId, open, onClose, onSaved,
}: {
  supplier?: any;
  supplierId?: number | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = supplier
          ? { data: supplier }
          : await api.get(`/api/v1/suppliers/${supplierId}`);
        if (cancelled) return;
        const rec = res.data;
        setRecord(rec);
        form.setFieldsValue({
          name: rec.name,
          phone: rec.phone,
          address: rec.address ?? undefined,
          phones: rec.phones ?? [],
          active: rec.active,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, supplierId, supplier]);

  const cleanPhones = (phones: any): string[] =>
    (phones || []).map((p: any) => (p || '').trim()).filter(Boolean);

  const onFinish = async (v: any) => {
    if (!record) return;
    setSaving(true);
    try {
      await api.patch(`/api/v1/suppliers/${record.id}`, {
        name: v.name,
        phone: v.phone,
        address: v.address ?? null,
        phones: cleanPhones(v.phones),
        active: v.active,
      });
      message.success('تم حفظ بيانات المورد');
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
      title={record ? `تعديل بيانات المورد: ${record.name}` : 'تعديل بيانات المورد'}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="حفظ"
      cancelText="إلغاء"
      confirmLoading={saving}
      width={620}
      centered
      destroyOnHidden
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={14}>
              <Form.Item name="name" label="اسم جهة التوريد / المورد"
                rules={[{ required: true, message: 'يرجى إدخال اسم المورد!' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="phone" label="رقم الهاتف">
                <Input placeholder="مثال: 02-23456789" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="address" label="العنوان">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col xs={24}><ExtraPhonesList /></Col>
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
