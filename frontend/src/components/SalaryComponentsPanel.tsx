import React, { useEffect, useState } from 'react';
import { Button, Col, Input, Row, Select, Space, Table, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { api } from '../api/client';
import { Popconfirm } from './noConfirm';
import { InputNumber } from './NumberInput';

interface Component {
  id: number; code: string; name: string; kind: 'earning' | 'deduction'; active: boolean;
}

export default function SalaryComponentsPanel({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Component[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'earning' | 'deduction'>('earning');
  const [hours, setHours] = useState<number | undefined>(undefined);
  const [showInactive, setShowInactive] = useState(false);

  const fail = (err: any, fallback: string) => {
    message.error(err?.response?.data?.detail?.message || fallback);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get('/api/v1/hr/payroll/components'),
        api.get('/api/v1/hr/payroll/settings'),
      ]);
      setRows(c.data || []);
      setHours(Number(s.data?.hours_per_day) || undefined);
    } catch (err: any) { fail(err, 'تعذر التحميل'); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) { message.warning('أدخل اسم البند'); return; }
    try {
      await api.post('/api/v1/hr/payroll/components', { name: name.trim(), kind });
      message.success('تمت الإضافة');
      setName('');
      await load();
      onChanged?.();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const deactivate = async (c: Component) => {
    try {
      await api.delete(`/api/v1/hr/payroll/components/${c.id}`);
      message.success('تم الإيقاف');
      await load();
      onChanged?.();
    } catch (err: any) { fail(err, 'تعذر الإيقاف'); }
  };

  const saveHours = async (v: number | null) => {
    if (!v) return;
    try {
      await api.patch('/api/v1/hr/payroll/settings', { hours_per_day: String(v) });
      setHours(v);
      message.success('تم الحفظ');
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const shown = rows.filter((r) => showInactive || r.active);

  return (
    <div>
      <Row gutter={[8, 8]} align="bottom" style={{ margin: '4px 0 10px' }}>
        <Col xs={24} sm={9}>
          <div style={{ marginBottom: 4 }}>اسم البند</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} onPressEnter={add}
            placeholder="مثال: بدل انتقال" />
        </Col>
        <Col xs={12} sm={5}>
          <div style={{ marginBottom: 4 }}>النوع</div>
          <Select style={{ width: '100%' }} value={kind} onChange={setKind}
            options={[
              { value: 'earning', label: 'استحقاق' },
              { value: 'deduction', label: 'استقطاع' },
            ]} />
        </Col>
        <Col xs={12} sm={4}>
          <Button type="primary" block icon={<PlusOutlined />} onClick={add}>إضافة</Button>
        </Col>
        <Col xs={24} sm={6}>
          <div style={{ marginBottom: 4 }}>ساعات يوم العمل</div>
          <InputNumber style={{ width: '100%' }} min={1} max={24} value={hours}
            onChange={(v) => saveHours(v as number | null)} />
        </Col>
      </Row>
      <Space style={{ marginBottom: 6 }}>
        <a onClick={() => setShowInactive(!showInactive)}>
          {showInactive ? 'إخفاء الموقوفة' : 'إظهار الموقوفة'}
        </a>
      </Space>
      <Table<Component>
        className="sl-table" size="small" rowKey="id" loading={loading} pagination={false}
        dataSource={shown} locale={{ emptyText: 'لا توجد بنود راتب' }}
        columns={[
          { title: 'الكود', dataIndex: 'code', width: 100 },
          { title: 'البند', dataIndex: 'name' },
          { title: 'النوع', dataIndex: 'kind', width: 120,
            render: (v: string) => (v === 'earning'
              ? <Tag color="green">استحقاق</Tag> : <Tag color="red">استقطاع</Tag>) },
          { title: 'الحالة', dataIndex: 'active', width: 100,
            render: (v: boolean) => (v ? <Tag color="green">نشط</Tag> : <Tag>موقوف</Tag>) },
          { title: '', key: 'x', width: 100,
            render: (_: any, c: Component) => (c.active ? (
              <Popconfirm onConfirm={() => deactivate(c)}>
                <Button size="small" danger>إيقاف</Button>
              </Popconfirm>
            ) : null) },
        ]}
      />
    </div>
  );
}
