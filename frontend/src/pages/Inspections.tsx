import React, { useCallback, useEffect, useState } from 'react';
import {
  Table,
  Card,
  Drawer,
  Tag,
  DatePicker,
  Select,
  Space,
  Button,
  Descriptions,
  Statistic,
  Row,
  Col,
  message,
} from 'antd';
import { ReloadOutlined, MobileOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';

interface InspectionLine {
  id: number;
  item_id: number | null;
  item_name: string;
  quantity: string;
  points: string;
  total: string;
}

interface InspectionRecord {
  id: number;
  document_number: string;
  visit_kind: 'technician' | 'regular';
  inspection_date: string;
  owner_name: string;
  owner_phone: string | null;
  national_id: string | null;
  owner_address: string | null;
  floor_number: string | null;
  description: string | null;
  inspection_type: string | null;
  technician_name: string | null;
  technician_phone: string | null;
  purchase_shop: string | null;
  visit_details: string | null;
  total_points: string;
  rep_user_id: number;
  items: InspectionLine[];
}

interface UserRecord {
  id: number;
  full_name: string | null;
  username: string;
}

const KIND_LABEL: Record<string, string> = {
  technician: 'معاينة فنيين',
  regular: 'زيارة عادية',
};

const fmt = (v: string) => {
  const n = Number(v);
  return Number.isNaN(n) ? v : n % 1 === 0 ? String(n) : String(n);
};

const Inspections: React.FC = () => {
  const [rows, setRows] = useState<InspectionRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<InspectionRecord | null>(null);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [repId, setRepId] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (range?.[0]) params.date_from = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.date_to = range[1].format('YYYY-MM-DD');
      if (kind) params.visit_kind = kind;
      if (repId) params.rep_id = String(repId);
      const { data } = await api.get<InspectionRecord[]>('/inspections', { params });
      setRows(data);
    } catch (e: any) {
      message.error(e?.message || 'تعذر تحميل المعاينات');
    } finally {
      setLoading(false);
    }
  }, [range, kind, repId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<UserRecord[]>('/users')
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]));
  }, []);

  const repName = (id: number) => {
    const u = users.find((x) => x.id === id);
    return u ? u.full_name || u.username : `#${id}`;
  };

  const totalPoints = rows.reduce((s, r) => s + Number(r.total_points || 0), 0);

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic title="عدد المعاينات" value={rows.length} prefix={<MobileOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="معاينات الفنيين"
              value={rows.filter((r) => r.visit_kind === 'technician').length}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="إجمالي النقاط" value={totalPoints} precision={3} />
          </Card>
        </Col>
      </Row>

      <Card
        title="المعاينات (من تطبيق الموبايل)"
        extra={
          <Space wrap>
            <DatePicker.RangePicker
              value={range as any}
              onChange={(v) => setRange(v as any)}
              allowClear
            />
            <Select
              placeholder="نوع الزيارة"
              style={{ width: 150 }}
              allowClear
              value={kind}
              onChange={setKind}
              options={[
                { value: 'technician', label: 'معاينة فنيين' },
                { value: 'regular', label: 'زيارة عادية' },
              ]}
            />
            <Select
              placeholder="المندوب"
              style={{ width: 170 }}
              allowClear
              showSearch
              optionFilterProp="label"
              value={repId}
              onChange={setRepId}
              options={users.map((u) => ({ value: u.id, label: u.full_name || u.username }))}
            />
            <Button icon={<ReloadOutlined />} onClick={load}>
              تحديث
            </Button>
          </Space>
        }
      >
        <Table<InspectionRecord>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          onRow={(record) => ({ onClick: () => setDetail(record), style: { cursor: 'pointer' } })}
          pagination={{ pageSize: 20, showTotal: (t) => `إجمالي ${t}` }}
          columns={[
            { title: 'رقم المستند', dataIndex: 'document_number', width: 130 },
            { title: 'التاريخ', dataIndex: 'inspection_date', width: 110 },
            {
              title: 'النوع',
              dataIndex: 'visit_kind',
              width: 120,
              render: (v: string) => (
                <Tag color={v === 'technician' ? 'blue' : 'green'}>{KIND_LABEL[v] || v}</Tag>
              ),
            },
            { title: 'صاحب الشقة', dataIndex: 'owner_name' },
            { title: 'التليفون', dataIndex: 'owner_phone', width: 130 },
            { title: 'التوصيف', dataIndex: 'description', width: 130 },
            { title: 'المندوب', dataIndex: 'rep_user_id', width: 140, render: repName },
            {
              title: 'النقاط',
              dataIndex: 'total_points',
              width: 100,
              align: 'center' as const,
              render: (v: string) => <b>{fmt(v)}</b>,
            },
          ]}
        />
      </Card>

      <Drawer
        title={detail ? `${detail.document_number} — ${detail.owner_name}` : ''}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={560}
      >
        {detail && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="نوع الزيارة">
                {KIND_LABEL[detail.visit_kind]}
              </Descriptions.Item>
              <Descriptions.Item label="التاريخ">{detail.inspection_date}</Descriptions.Item>
              <Descriptions.Item label="المندوب">{repName(detail.rep_user_id)}</Descriptions.Item>
              <Descriptions.Item label="تليفون المالك">
                {detail.owner_phone || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="رقم البطاقة">{detail.national_id || '—'}</Descriptions.Item>
              <Descriptions.Item label="العنوان">{detail.owner_address || '—'}</Descriptions.Item>
              <Descriptions.Item label="الدور">{detail.floor_number || '—'}</Descriptions.Item>
              <Descriptions.Item label="توصيف المعاينة">
                {detail.description || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="نوع المعاينة">
                {detail.inspection_type || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="اسم الفني">
                {detail.technician_name || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="تليفون الفني">
                {detail.technician_phone || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="محل الشراء">{detail.purchase_shop || '—'}</Descriptions.Item>
              <Descriptions.Item label="تفاصيل الزيارة">
                {detail.visit_details || '—'}
              </Descriptions.Item>
            </Descriptions>
            <Table<InspectionLine>
              rowKey="id"
              style={{ marginTop: 16 }}
              dataSource={detail.items}
              pagination={false}
              size="small"
              columns={[
                { title: 'الصنف', dataIndex: 'item_name' },
                { title: 'الكمية', dataIndex: 'quantity', width: 90, render: fmt },
                { title: 'النقاط', dataIndex: 'points', width: 90, render: fmt },
                { title: 'الإجمالي', dataIndex: 'total', width: 90, render: fmt },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <b>إجمالي النقاط</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} colSpan={3}>
                    <b>{fmt(detail.total_points)}</b>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </>
        )}
      </Drawer>
    </div>
  );
};

export default Inspections;
