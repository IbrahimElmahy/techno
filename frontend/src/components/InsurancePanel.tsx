import React, { useEffect, useState } from 'react';
import { Button, Col, DatePicker, Divider, Input, Row, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

import { api } from '../api/client';
import { Popconfirm } from './noConfirm';
import { InputNumber } from './NumberInput';
import { money } from '../utils/money';

interface Version {
  id: number; effective_from: string; amount: string; notes: string | null; locked: boolean;
}

interface Month {
  year: number; month: number; run_id: number; document_number: string; status: string;
  status_label: string; amount: string; manual: boolean; salary_paid: boolean;
}

interface History {
  employee_id: number; name: string; code: string;
  current: { amount: string; effective_from: string } | null;
  versions: Version[]; months: Month[]; posted_total: string;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'default', closed: 'blue', posted: 'green', reversed: 'red',
};

export default function InsurancePanel({ employeeId, onChanged }: {
  employeeId: number; onChanged?: () => void;
}) {
  const [data, setData] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState<Dayjs>(dayjs().startOf('month'));
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fail = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    message.error(detail?.message || fallback, detail?.code === 'locked' ? 8 : 4);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/hr/insurance/employees/${employeeId}`);
      setData(res.data);
      setAmount(res.data.current ? Number(res.data.current.amount) : undefined);
    } catch (err: any) { fail(err, 'تعذر تحميل التأمينات'); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [employeeId]);

  const save = async () => {
    if (amount === undefined || amount === null) { message.warning('أدخل مبلغ التأمينات'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/insurance', {
        employee_id: employeeId, effective_from: from.format('YYYY-MM-DD'),
        amount: String(amount), notes: notes || null,
      });
      message.success('تم حفظ التأمينات');
      setNotes('');
      await load();
      onChanged?.();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/v1/hr/insurance/versions/${id}`);
      message.success('تم الحذف');
      await load();
      onChanged?.();
    } catch (err: any) { fail(err, 'تعذر الحذف'); }
  };

  return (
    <div>
      <Row gutter={[10, 10]} align="bottom">
        <Col xs={24} sm={7}>
          <div style={{ marginBottom: 4 }}>ساري من</div>
          <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
            value={from} onChange={(v) => v && setFrom(v)} />
        </Col>
        <Col xs={24} sm={6}>
          <div style={{ marginBottom: 4 }}>المبلغ الشهري</div>
          <InputNumber style={{ width: '100%' }} min={0} value={amount}
            onChange={(v) => setAmount(v ?? undefined)} />
        </Col>
        <Col xs={24} sm={7}>
          <div style={{ marginBottom: 4 }}>ملاحظات</div>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Col>
        <Col xs={24} sm={4}>
          <Button type="primary" block icon={<SaveOutlined />} loading={saving} onClick={save}>
            حفظ
          </Button>
        </Col>
      </Row>

      <Space size={24} wrap style={{ margin: '10px 0 0' }}>
        <span>المبلغ الحالي: <b>{data?.current ? money(data.current.amount) : '—'}</b></span>
        {data?.current ? <span>ساري من: <b>{data.current.effective_from}</b></span> : null}
        <span>إجمالي المخصوم في الشهور المرحّلة: <b>{money(data?.posted_total ?? 0)}</b></span>
      </Space>

      <Divider style={{ margin: '10px 0 6px' }}>تغييرات المبلغ</Divider>
      <Table<Version>
        size="small" rowKey="id" pagination={false} loading={loading}
        dataSource={data?.versions || []}
        locale={{ emptyText: 'لا يوجد مبلغ تأمينات مسجّل' }}
        columns={[
          { title: 'ساري من', dataIndex: 'effective_from', width: 120 },
          { title: 'المبلغ', dataIndex: 'amount', align: 'left', render: (v: string) => money(v) },
          { title: 'ملاحظات', dataIndex: 'notes', render: (v: string | null) => v || '' },
          { title: '', key: 'x', width: 110,
            render: (_: any, v: Version) => (v.locked
              ? <Tag title="خُصم في شهر مرحّل">🔒 مغلق</Tag>
              : (
                <Popconfirm onConfirm={() => remove(v.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />}>حذف</Button>
                </Popconfirm>
              )) },
        ]}
      />

      <Divider style={{ margin: '10px 0 6px' }}>سجل الشهور</Divider>
      <Table<Month>
        size="small" rowKey={(m) => `${m.run_id}`} pagination={false} loading={loading}
        dataSource={data?.months || []}
        locale={{ emptyText: 'لم يدخل الموظف شيت مرتبات به عمود تأمينات بعد' }}
        columns={[
          { title: 'الشهر', key: 'm', width: 100,
            render: (_: any, m: Month) => `${m.year}/${String(m.month).padStart(2, '0')}` },
          { title: 'المبلغ', dataIndex: 'amount', align: 'left',
            render: (v: string, m: Month) => (
              <Space size={4}>
                {money(v)}
                {m.manual ? <Tag color="gold">يدوي</Tag> : null}
              </Space>
            ) },
          { title: 'الشيت', dataIndex: 'document_number', width: 130 },
          { title: 'الحالة', dataIndex: 'status', width: 100,
            render: (v: string, m: Month) => <Tag color={STATUS_COLOR[v]}>{m.status_label}</Tag> },
          { title: 'صرف المرتب', dataIndex: 'salary_paid', width: 110,
            render: (v: boolean) => (v ? <Tag color="green">مصروف</Tag> : '—') },
        ]}
      />
    </div>
  );
}
