import React, { useEffect, useState } from 'react';
import { Button, Col, Input, InputNumber, Row, Select, Space, Table, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { api } from '../api/client';

/**
 * Units / barcodes / serials for one item, as inline panels for the item file.
 *
 * These used to be three popups launched from three buttons in the catalog grid. Same
 * endpoints, same rules — they just live where the rest of the item's data lives now.
 */

// ------------------------------------------------------------------ units of measure

export function UnitsPanel({ itemId, canEdit }: { itemId: number; canEdit: boolean }) {
  const [base, setBase] = useState('');
  const [rows, setRows] = useState<{ name: string; factor: number | null }[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setBase(res.data.base_unit);
      setRows((res.data.units || []).filter((u: any) => !u.is_base)
        .map((u: any) => ({ name: u.name, factor: parseFloat(u.factor) })));
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, [itemId]);

  const onSave = async () => {
    const units = rows.filter((r) => r.name && r.factor && r.factor > 0)
      .map((r) => ({ name: r.name, factor: Number(r.factor).toFixed(3) }));
    setSaving(true);
    try {
      await api.put(`/api/v1/items/${itemId}/units`, { units });
      message.success('تم حفظ الوحدات');
      load();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  return (
    <>
      <Typography.Paragraph type="secondary">
        الوحدة الأساسية: <strong>{base}</strong> (معامل = 1). أضف وحدات أكبر بمعاملها مقابل
        الأساس (مثلاً: كرتونة = 12).
      </Typography.Paragraph>
      {rows.map((r, i) => (
        <Row key={i} gutter={8} align="middle" style={{ marginBottom: 8, maxWidth: 620 }}>
          <Col span={12}>
            <Input placeholder="اسم الوحدة (كرتونة)" disabled={!canEdit} value={r.name}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          </Col>
          <Col span={9}>
            <InputNumber min={0.001} step={1} style={{ width: '100%' }} addonBefore="= عدد الأساس"
              disabled={!canEdit} value={r.factor ?? undefined}
              onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, factor: v as number } : x)))} />
          </Col>
          <Col span={3}>
            <Button type="text" danger icon={<DeleteOutlined />} disabled={!canEdit}
              onClick={() => setRows(rows.filter((_, j) => j !== i))} />
          </Col>
        </Row>
      ))}
      {canEdit && (
        <Space style={{ marginTop: 8 }}>
          <Button type="dashed" icon={<PlusOutlined />}
            onClick={() => setRows([...rows, { name: '', factor: null }])}>إضافة وحدة</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
            حفظ الوحدات
          </Button>
        </Space>
      )}
    </>
  );
}

// -------------------------------------------------------------------------- serials

export function SerialsPanel({ itemId, canEdit }: { itemId: number; canEdit: boolean }) {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [whId, setWhId] = useState<number | undefined>();
  const [text, setText] = useState('');
  const [inStock, setInStock] = useState<any[]>([]);

  const load = async () => {
    try {
      const [wh, ser] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get(`/api/v1/items/${itemId}/serials?status=in_stock`),
      ]);
      setWarehouses(wh.data);
      setInStock(ser.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, [itemId]);

  const onReceive = async () => {
    const serials = text.split(/[\s,\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!whId || serials.length === 0) {
      message.warning('اختر المخزن وأدخل أرقاماً تسلسلية');
      return;
    }
    try {
      await api.post(`/api/v1/items/${itemId}/serials/receive`, {
        location_kind: 'warehouse', location_id: whId, serials,
      });
      message.success(`تم استلام ${serials.length} رقم تسلسلي`);
      setText('');
      load();
    } catch (err) { console.error(err); }
  };

  return (
    <>
      {canEdit && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8,
                      maxWidth: 620 }}>
          <strong>استلام أرقام تسلسلية للمخزون</strong>
          <Select style={{ width: '100%', margin: '8px 0' }} placeholder="مخزن الاستلام" value={whId}
            onChange={setWhId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <Input.TextArea rows={3} placeholder="أرقام تسلسلية مفصولة بمسافة أو فاصلة أو سطر"
            value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="primary" style={{ marginTop: 8 }} onClick={onReceive}>استلام</Button>
        </div>
      )}
      <strong>المتوفر بالمخزون ({inStock.length})</strong>
      <Table size="small" rowKey="id" dataSource={inStock} style={{ marginTop: 8 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100', '200'] }}
        columns={[
          { title: 'الرقم التسلسلي', dataIndex: 'serial' },
          { title: 'الموقع', dataIndex: 'location_id',
            render: (v: number, r: any) => (r.location_kind ? `${r.location_kind} #${v}` : '-') },
        ]} />
    </>
  );
}
