import React, { useEffect, useState, useMemo } from 'react';
import {
  Table,
  Card,
  Input,
  Select,
  Tag,
  Button,
  Modal,
  Descriptions,
  Space,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ReloadOutlined,
  EyeOutlined,
  HomeOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';

const { Text, Title } = Typography;

interface OwnerListItem {
  id: number;
  code: string | null;
  name: string;
  phone: string | null;
  national_id: string | null;
  address: string | null;
  floor_number: string | null;
  notes: string | null;
  territory_id: number | null;
  branch_id: number | null;
  service_rep_id: number | null;
  active: boolean;
  created_at: string;
  inspection_count: number;
  last_inspection_date: string | null;
}

interface OwnerInspectionBrief {
  id: number;
  document_number: string;
  certificate_number: number | null;
  inspection_date: string;
  visit_type: string;
  status: string;
  printed: boolean;
  technician_name: string | null;
  technician_phone: string | null;
  purchase_shop: string | null;
  total_points: string;
}

interface OwnerDetail extends OwnerListItem {
  inspections: OwnerInspectionBrief[];
}

interface UserOption {
  id: number;
  full_name: string | null;
}

interface TerritoryOption {
  id: number;
  name: string;
}

export default function Owners() {
  const [owners, setOwners] = useState<OwnerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [territoryId, setTerritoryId] = useState<number | undefined>();
  const [serviceRepId, setServiceRepId] = useState<number | undefined>();
  const [hasInspections, setHasInspections] = useState<boolean | undefined>();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [territories, setTerritories] = useState<TerritoryOption[]>([]);

  const [selectedOwner, setSelectedOwner] = useState<OwnerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchUsersAndTerritories = async () => {
    try {
      const [uRes, tRes] = await Promise.all([
        api.get<UserOption[]>('/api/v1/users'),
        // `/org/territories` مش مسار موجود — كان بيرجّع صفحة الـSPA نفسها (HTML)،
        // والـcatch اللي تحت بيبلع الفشل لأنه مافيش فشل: الرد 200 بنص.
        api.get<TerritoryOption[]>('/api/v1/territories'),
      ]);
      // الرد اللي مش مصفوفة مابيدخلش الحالة.
      //
      // نص HTML اتحط في `territories` وبعدين حد عمل عليه `forEach` — والانهيار
      // مانزلش على الصفحة لوحدها، نزل على التطبيق كله: الشاشة بتفضل بيضا من غير
      // ولا رسالة. مسار غلط أو خطأ من السيرفر مايبقاش حالة.
      setUsers(Array.isArray(uRes.data) ? uRes.data : []);
      setTerritories(Array.isArray(tRes.data) ? tRes.data : []);
    } catch {
      // best-effort lookup load
    }
  };

  const fetchOwners = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { limit: 1000 };
      if (search.trim()) params.search = search.trim();
      if (territoryId) params.territory_id = territoryId;
      if (serviceRepId) params.service_rep_id = serviceRepId;
      if (hasInspections !== undefined) params.has_inspections = hasInspections;

      const res = await api.get<OwnerListItem[]>('/api/v1/owners', { params });
      // نفس القاعدة: اللي مش مصفوفة مايدخلش الحالة.
      const rows: any = res.data;
      setOwners(Array.isArray(rows) ? rows : (rows?.rows ?? []));
    } catch (err: any) {
      message.error(err.response?.data?.message || 'تعذر تحميل بيانات الملّاك');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndTerritories();
  }, []);

  useEffect(() => {
    fetchOwners();
  }, [territoryId, serviceRepId, hasInspections]);

  const openOwnerDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await api.get<OwnerDetail>(`/api/v1/owners/${id}`);
      setSelectedOwner(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.message || 'تعذر تحميل كارت المالك');
    } finally {
      setDetailLoading(false);
    }
  };

  const usersMap = useMemo(() => {
    const map = new Map<number, string>();
    users.forEach((u) => map.set(u.id, u.full_name || `مستخدم #${u.id}`));
    return map;
  }, [users]);

  const territoriesMap = useMemo(() => {
    const map = new Map<number, string>();
    territories.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [territories]);

  const rawColumns: ColumnsType<OwnerListItem> = [
    {
      title: 'كود المالك',
      dataIndex: 'code',
      width: 110,
      render: (v: string | null) => <Text code>{v || '—'}</Text>,
    },
    {
      title: 'اسم المالك (صاحب البيت)',
      dataIndex: 'name',
      width: 200,
      render: (name: string, record: OwnerListItem) => (
        <a
          style={{ fontWeight: 600 }}
          onClick={(e) => {
            e.preventDefault();
            openOwnerDetail(record.id);
          }}
        >
          {name}
        </a>
      ),
    },
    {
      title: 'التليفون',
      dataIndex: 'phone',
      width: 120,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'العنوان',
      dataIndex: 'address',
      width: 220,
      render: (v: string | null, record: OwnerListItem) => {
        const floor = record.floor_number ? ` (دور ${record.floor_number})` : '';
        return v ? `${v}${floor}` : '—';
      },
    },
    {
      title: 'المنطقة',
      dataIndex: 'territory_id',
      width: 130,
      render: (id: number | null) => (id ? territoriesMap.get(id) || `منطقة #${id}` : '—'),
    },
    {
      title: 'مندوب الخدمة',
      dataIndex: 'service_rep_id',
      width: 140,
      render: (id: number | null) => (id ? usersMap.get(id) || `مندوب #${id}` : '—'),
    },
    {
      title: 'عدد المعاينات',
      dataIndex: 'inspection_count',
      width: 110,
      align: 'center' as const,
      sorter: (a: OwnerListItem, b: OwnerListItem) => a.inspection_count - b.inspection_count,
      render: (cnt: number) =>
        cnt > 0 ? (
          <Tag color="blue" style={{ fontSize: 13, padding: '2px 8px' }}>
            {cnt}
          </Tag>
        ) : (
          <Tag>0</Tag>
        ),
    },
    {
      title: 'آخر معاينة',
      dataIndex: 'last_inspection_date',
      width: 110,
      align: 'center' as const,
      render: (d: string | null) => d || '—',
    },
    {
      title: 'إجراءات',
      key: 'actions',
      width: 90,
      align: 'center' as const,
      render: (_: any, record: OwnerListItem) => (
        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={() => openOwnerDetail(record.id)}
        >
          عرض
        </Button>
      ),
    },
  ];

  const tableCols = useTableColumns('owners_list', rawColumns, {
    export: { name: 'الملّاك', rows: owners },
  });

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={
          <Space>
            <HomeOutlined style={{ color: '#1677ff' }} />
            <span>الملّاك (أصحاب البيوت — خدمات ما بعد البيع)</span>
            <Tag color="geekblue">{owners.length} مالك</Tag>
          </Space>
        }
        extra={
          <Space>
            {tableCols.control}
            <Button icon={<ReloadOutlined />} onClick={fetchOwners} loading={loading}>
              تحديث
            </Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Input.Search
            placeholder="بحث بالاسم أو التليفون أو الكود أو العنوان..."
            style={{ width: 300 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={fetchOwners}
            allowClear
          />
          <Select
            placeholder="المنطقة"
            style={{ width: 160 }}
            allowClear
            value={territoryId}
            onChange={setTerritoryId}
            options={territories.map((t) => ({ label: t.name, value: t.id }))}
          />
          <Select
            placeholder="مندوب الخدمة"
            style={{ width: 160 }}
            allowClear
            value={serviceRepId}
            onChange={setServiceRepId}
            options={users.map((u) => ({ label: u.full_name || `#${u.id}`, value: u.id }))}
          />
          <Select
            placeholder="المعاينات"
            style={{ width: 150 }}
            allowClear
            value={hasInspections}
            onChange={setHasInspections}
            options={[
              { label: 'لديه معاينات', value: true },
              { label: 'بدون معاينات', value: false },
            ]}
          />
        </div>

        <Table<OwnerListItem>
          rowKey="id"
          columns={tableCols.columns}
          dataSource={owners}
          loading={loading}
          size="small"
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t} مالك` }}
        />
      </Card>

      <Modal
        title={
          <Space>
            <UserOutlined />
            <span>كارت المالك: {selectedOwner?.name}</span>
            {selectedOwner?.code && <Tag color="blue">{selectedOwner.code}</Tag>}
          </Space>
        }
        open={Boolean(selectedOwner)}
        onCancel={() => setSelectedOwner(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setSelectedOwner(null)}>
            إغلاق
          </Button>,
        ]}
        width={850}
        loading={detailLoading}
      >
        {selectedOwner && (
          <div>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 20 }}>
              <Descriptions.Item label="الاسم">{selectedOwner.name}</Descriptions.Item>
              <Descriptions.Item label="التليفون">{selectedOwner.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label="رقم البطاقة">{selectedOwner.national_id || '—'}</Descriptions.Item>
              <Descriptions.Item label="العنوان">{selectedOwner.address || '—'}</Descriptions.Item>
              <Descriptions.Item label="الدور">{selectedOwner.floor_number || '—'}</Descriptions.Item>
              <Descriptions.Item label="المنطقة">
                {selectedOwner.territory_id ? territoriesMap.get(selectedOwner.territory_id) || '—' : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="مندوب الخدمة">
                {selectedOwner.service_rep_id ? usersMap.get(selectedOwner.service_rep_id) || '—' : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="عدد المعاينات">
                <Tag color="blue">{selectedOwner.inspection_count}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="آخر معاينة">{selectedOwner.last_inspection_date || '—'}</Descriptions.Item>
              {selectedOwner.notes && (
                <Descriptions.Item label="ملاحظات" span={3}>
                  {selectedOwner.notes}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Title level={5} style={{ marginBottom: 12 }}>
              سجل المعاينات المنفذة للطرف ({selectedOwner.inspections.length}):
            </Title>

            <Table<OwnerInspectionBrief>
              rowKey="id"
              dataSource={selectedOwner.inspections}
              size="small"
              pagination={false}
              columns={[
                {
                  title: 'رقم المستند',
                  dataIndex: 'document_number',
                  width: 120,
                  render: (v: string) => (
                    <a href={`#/inspections?doc=${v}`} onClick={() => setSelectedOwner(null)}>
                      {v}
                    </a>
                  ),
                },
                { title: 'التاريخ', dataIndex: 'inspection_date', width: 100 },
                {
                  title: 'نوع الزيارة',
                  dataIndex: 'visit_type',
                  width: 90,
                  render: (v: string) => <Tag color={v === 'مرمة' ? 'orange' : 'cyan'}>{v}</Tag>,
                },
                {
                  title: 'الطباعة',
                  dataIndex: 'printed',
                  width: 80,
                  render: (v: boolean) => (v ? <Tag color="blue">تم</Tag> : <Tag>لا</Tag>),
                },
                { title: 'الفني', dataIndex: 'technician_name', render: (v: string | null) => v || '—' },
                { title: 'التاجر / محل الشراء', dataIndex: 'purchase_shop', render: (v: string | null) => v || '—' },
                { title: 'النقاط', dataIndex: 'total_points', width: 80, align: 'center' },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
