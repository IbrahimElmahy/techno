import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Table, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { InputNumber } from './NumberInput';
import { useLookup } from '../hooks/useLookup';

export interface EditableInspection {
  id: number;
  visit_kind: 'technician' | 'regular';
  inspection_date: string;
  owner_name: string;
  owner_phone: string | null;
  national_id: string | null;
  owner_address: string | null;
  floor_number: string | null;
  description: string | null;
  inspection_type: string | null;
  visit_type: string;
  technician_name: string | null;
  technician_phone: string | null;
  merchant_customer_id: number | null;
  merchant_name: string | null;
  purchase_shop: string | null;
  purchase_shop_phone: string | null;
  visit_details: string | null;
  items: { id: number; item_name: string; quantity: string; points: string; item_id?: number | null }[];
}

interface Option { value: number; label: string; phone?: string | null }
interface Line { key: number; item_name: string; quantity: number | null; points: number | null }

const MERCHANT_TYPES = ['trader', 'showroom', 'company', 'establishment'];

function usePartySearch(types: string[]) {
  const [options, setOptions] = useState<Option[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (q.trim().length < 2) return;
      try {
        const results = await Promise.all(types.map((t) => api.get('/api/v1/customers/options', {
          params: { q: q.trim(), customer_type: t, limit: 20 },
        })));
        const seen = new Set<number>();
        const next: Option[] = [];
        for (const r of results) {
          for (const c of (r.data || []) as any[]) {
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            next.push({ value: c.id, label: c.name, phone: c.phone });
          }
        }
        setOptions(next);
      } catch {
        setOptions([]);
      }
    }, 300);
  };
  return { options, setOptions, search };
}

const InspectionEditModal: React.FC<{
  record: EditableInspection | null;
  onClose: () => void;
  onSaved: (updated: any) => void;
}> = ({ record, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const { options: visitTypeOptions } = useLookup('visit_type');
  const tech = usePartySearch(['plumber']);
  const merchant = usePartySearch(MERCHANT_TYPES);
  const techRecord = record as (EditableInspection & { technician_customer_id?: number | null }) | null;
  const isTechnician = record?.visit_kind === 'technician';

  useEffect(() => {
    if (!record) return;
    form.setFieldsValue({
      inspection_date: dayjs(record.inspection_date),
      owner_name: record.owner_name,
      owner_phone: record.owner_phone,
      national_id: record.national_id,
      owner_address: record.owner_address,
      floor_number: record.floor_number,
      description: record.description,
      inspection_type: record.inspection_type,
      visit_type: record.visit_type || 'معاينة',
      technician_customer_id: techRecord?.technician_customer_id ?? undefined,
      technician_name: record.technician_name,
      technician_phone: record.technician_phone,
      merchant_customer_id: record.merchant_customer_id ?? undefined,
      purchase_shop: record.purchase_shop,
      purchase_shop_phone: record.purchase_shop_phone,
      visit_details: record.visit_details,
    });
    tech.setOptions(techRecord?.technician_customer_id
      ? [{ value: techRecord.technician_customer_id, label: record.technician_name || `#${techRecord.technician_customer_id}` }]
      : []);
    merchant.setOptions(record.merchant_customer_id
      ? [{ value: record.merchant_customer_id, label: record.merchant_name || record.purchase_shop || `#${record.merchant_customer_id}` }]
      : []);
    setLines(record.items.map((it, i) => ({
      key: i + 1, item_name: it.item_name, quantity: Number(it.quantity), points: Number(it.points),
    })));
  }, [record]);

  const lockedLines = !!record?.items.some((it) => it.item_id);
  const totalPoints = lines.reduce((t, l) => t + (l.quantity || 0) * (l.points || 0), 0);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!record) return;
    const v = await form.validateFields();
    const bad = lines.find((l) => !l.item_name.trim() || !(l.quantity && l.quantity > 0));
    if (!lockedLines && bad) {
      message.warning('أكمل اسم البند وكميته في كل سطر');
      return;
    }
    const body: Record<string, unknown> = {
      ...v,
      inspection_date: v.inspection_date ? v.inspection_date.format('YYYY-MM-DD') : undefined,
      technician_customer_id: v.technician_customer_id ?? null,
      merchant_customer_id: v.merchant_customer_id ?? null,
    };
    if (!lockedLines) {
      body.items = lines.map((l) => ({
        item_name: l.item_name.trim(), quantity: l.quantity, points: l.points || 0,
      }));
    }
    setSaving(true);
    try {
      const res = await api.patch(`/api/v1/inspections/${record.id}`, body);
      message.success('تم حفظ التعديل');
      onSaved(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ التعديل');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!record}
      title="تعديل المعاينة"
      width={900}
      onCancel={onClose}
      onOk={save}
      okText="حفظ"
      cancelText="إلغاء"
      confirmLoading={saving}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="inspection_date" label="التاريخ" rules={[{ required: true, message: 'التاريخ مطلوب' }]}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="visit_type" label="نوع الزيارة">
              <Select options={(visitTypeOptions.length ? visitTypeOptions
                : [{ value: 'معاينة', label: 'معاينة' }, { value: 'مرمة', label: 'مرمة' }])
                .map((o: any) => ({ value: o.value, label: o.label }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="inspection_type" label="نوع المعاينة">
              <Input maxLength={80} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="owner_name" label={isTechnician ? 'اسم المالك' : 'الاسم'}
              rules={[{ required: true, whitespace: true, message: 'الاسم مطلوب' }]}>
              <Input maxLength={160} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="owner_phone" label="الهاتف"><Input maxLength={32} /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="national_id" label="الرقم القومي"><Input maxLength={20} /></Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="owner_address" label="العنوان"><Input maxLength={240} /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="floor_number" label="الدور"><Input maxLength={120} /></Form.Item>
          </Col>
        </Row>
        {isTechnician && (
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="technician_customer_id" label="الفني">
                <Select
                  showSearch allowClear filterOption={false} placeholder="ابحث باسم الفني"
                  options={tech.options} onSearch={tech.search}
                  onChange={(id, opt: any) => {
                    form.setFieldsValue({
                      technician_name: id ? opt?.label ?? null : null,
                      ...(id && opt?.phone ? { technician_phone: opt.phone } : {}),
                    });
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="technician_name" label="اسم الفني (كما كُتب)"><Input maxLength={160} /></Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="technician_phone" label="هاتف الفني"><Input maxLength={32} /></Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="merchant_customer_id" label="التاجر">
                <Select
                  showSearch allowClear filterOption={false} placeholder="ابحث باسم التاجر"
                  options={merchant.options} onSearch={merchant.search}
                  onChange={(id, opt: any) => {
                    if (id) form.setFieldsValue({ purchase_shop: opt?.label ?? null });
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="purchase_shop" label="محل الشراء"><Input maxLength={160} /></Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="purchase_shop_phone" label="هاتف المحل"><Input maxLength={40} /></Form.Item>
            </Col>
          </Row>
        )}
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="description" label="الوصف"><Input maxLength={80} /></Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="visit_details" label="التقرير"><Input.TextArea maxLength={1000} autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
          </Col>
        </Row>
      </Form>
      {isTechnician && (
        <>
          <Table
            size="small"
            rowKey="key"
            pagination={false}
            dataSource={lines}
            columns={[
              { title: 'البند', dataIndex: 'item_name',
                render: (v: string, l: Line) => (
                  <Input value={v} disabled={lockedLines} maxLength={160}
                    onChange={(e) => setLine(l.key, { item_name: e.target.value })} />) },
              { title: 'الكمية', dataIndex: 'quantity', width: 110,
                render: (v: number | null, l: Line) => (
                  <InputNumber value={v as any} min={0} disabled={lockedLines} style={{ width: '100%' }}
                    onChange={(n) => setLine(l.key, { quantity: n as number | null })} />) },
              { title: 'النقاط', dataIndex: 'points', width: 110,
                render: (v: number | null, l: Line) => (
                  <InputNumber value={v as any} min={0} disabled={lockedLines} style={{ width: '100%' }}
                    onChange={(n) => setLine(l.key, { points: n as number | null })} />) },
              { title: 'الإجمالي', key: 'total', width: 100,
                render: (_: unknown, l: Line) => ((l.quantity || 0) * (l.points || 0)).toLocaleString() },
              { title: '', key: 'x', width: 44,
                render: (_: unknown, l: Line) => (
                  <Button type="text" danger icon={<DeleteOutlined />} disabled={lockedLines}
                    onClick={() => setLines((prev) => prev.filter((p) => p.key !== l.key))} />) },
            ]}
          />
          <Space style={{ marginTop: 8, width: '100%', justifyContent: 'space-between' }}>
            <Button icon={<PlusOutlined />} disabled={lockedLines}
              onClick={() => setLines((prev) => [...prev, {
                key: Math.max(0, ...prev.map((p) => p.key)) + 1, item_name: '', quantity: 1, points: 0,
              }])}>إضافة بند</Button>
            <b>إجمالي النقاط: {totalPoints.toLocaleString()}</b>
          </Space>
        </>
      )}
    </Modal>
  );
};

export default InspectionEditModal;
