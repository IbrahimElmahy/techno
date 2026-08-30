import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Table, Row, Col, Statistic, Select, Button, Space, Tag, Typography, message, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { api } from '../api/client';
import DateRangeFilter from '../components/DateRangeFilter';
import { DocRef, type DocKind } from '../components/DocumentLink';
import { useTableColumns } from '../components/ColumnSettings';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';

const { Text, Title } = Typography;

/**
 * سجل النقاط — كل حركة في دفتر نقاط التجار، مش كارت عميل واحد.
 *
 * الفلترة كلها على السيرفر عن قصد. الدفتر فيه عشرات الآلاف من السطور بعد الكسب الرجعي،
 * وتحميلهم كلهم عشان نفلترهم في المتصفح بيقفل الشاشة. وكمان: الإجماليات فوق بتتحسب في
 * القاعدة على الحركة كلها، مش بتتجمّع من الصفحة المعروضة — إجمالي بيتجمع من ٥٠٠ سطر
 * معروضين بيقول رقم غلط وهو واثق.
 *
 * «رصيد جاري» مش موجود هنا وده مقصود: رصيد جاري على كشف فيه ٢٨١ عميل مخلوطين رقم
 * مالوش معنى. الرصيد الجاري بيبان في تبويب «النقاط» في ملف العميل، حيث بيبقى ليه معنى.
 */

interface PointRow {
  id: number;
  customer_id: number;
  customer_name: string | null;
  date: string | null;
  kind: string;
  kind_label: string;
  delta: string;
  earned: string;
  spent: string;
  doc_kind: string | null;
  doc_id: number | null;
  doc_number: string | null;
}

interface LedgerData {
  rows: PointRow[];
  count: number;
  earned: string;
  spent: string;
  net: string;
  kinds: Record<string, string>;
}

const PAGE_SIZE = 200;

const num = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function PointsLedger() {
  const navigate = useNavigate();
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);

  const [customerId, setCustomerId] = useState<number | undefined>();
  const [kinds, setKinds] = useState<string[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
      if (customerId) params.customer_id = customerId;
      if (kinds.length) params.kind = kinds;
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
      }
      const res = await api.get('/api/v1/points/ledger', { params });
      setData(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.message || 'تعذر تحميل سجل النقاط');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get('/api/v1/customers').then((r) => setCustomers(r.data || [])).catch(() => {});
  }, []);

  // تغيير أي فلتر بيرجّع لأول صفحة: الصفحة ٧ من نتيجة قديمة على فلتر جديد بتطلع فاضية،
  // والمستخدم بيفتكر إن مافيش حركة.
  useEffect(() => { setPage(1); }, [customerId, kinds, range]);
  useEffect(() => { load(); }, [customerId, kinds, range, page]);

  const kindOptions = useMemo(
    () => Object.entries(data?.kinds || {}).map(([value, label]) => ({ value, label })),
    [data?.kinds],
  );

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name })),
    [customers],
  );

  const rawColumns: ColumnsType<PointRow> = [
    { title: 'التاريخ', dataIndex: 'date', key: 'date', width: 110,
      render: (d: string | null) => d || '-' },
    { title: 'العميل', dataIndex: 'customer_name', key: 'customer', width: 220,
      render: (name: string | null, r: PointRow) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/customers/${r.customer_id}`); }}>
          {name || `عميل #${r.customer_id}`}
        </a>
      ) },
    { title: 'النوع', dataIndex: 'kind_label', key: 'kind', width: 160,
      render: (label: string) => <Tag>{label}</Tag> },
    { title: 'المستند', key: 'doc', width: 170,
      render: (_: any, r: PointRow) => {
        if (!r.doc_number) return <Text type="secondary">-</Text>;
        // الفاتورة والمرتجع ليهم شاشة بتفتح بـ`?doc=`. المعاينة والكوبون مالهمش، فبيفضلوا
        // نص — لينك بيوديك لكشف تدوّر فيه بنفسك أسوأ من مافيش لينك.
        if (r.doc_kind === 'invoice' || r.doc_kind === 'return') {
          return <DocRef kind={r.doc_kind as DocKind} id={r.doc_id} label={r.doc_number} />;
        }
        return <Tag>{r.doc_number}</Tag>;
      } },
    { title: 'وارد', dataIndex: 'earned', key: 'earned', width: 110, align: 'left',
      render: (v: string) => (Number(v) > 0
        ? <b style={{ color: '#3f8600' }}>{num(v)}</b> : <Text type="secondary">-</Text>) },
    { title: 'منصرف', dataIndex: 'spent', key: 'spent', width: 110, align: 'left',
      render: (v: string) => (Number(v) > 0
        ? <b style={{ color: '#cf1322' }}>{num(v)}</b> : <Text type="secondary">-</Text>) },
  ];

  const { columns, control: columnSettings } = useTableColumns('points-ledger', rawColumns);

  const exportCsv = () => {
    const cols: CsvColumn<PointRow>[] = [
      { title: 'التاريخ', value: (r) => r.date || '' },
      { title: 'العميل', value: (r) => r.customer_name || `#${r.customer_id}` },
      { title: 'النوع', value: (r) => r.kind_label },
      { title: 'المستند', value: (r) => r.doc_number || '' },
      { title: 'وارد', value: (r) => (Number(r.earned) > 0 ? r.earned : '') },
      { title: 'منصرف', value: (r) => (Number(r.spent) > 0 ? r.spent : '') },
    ];
    writeCsv('points-ledger', cols, data?.rows || []);
  };

  const net = Number(data?.net || 0);
  const shown = data?.rows.length || 0;
  const total = data?.count || 0;

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>سجل النقاط</Title>
        <Space>
          {columnSettings}
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!shown}>
            تصدير الصفحة
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
        </Space>
      </Space>

      {/* الإجماليات محسوبة في القاعدة على الحركة المفلترة كلها — مش على الصفحة المعروضة. */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="وارد (نقط مكتسبة)" value={num(data?.earned)}
              valueStyle={{ color: '#3f8600' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="منصرف (كوبونات ومعاينات)" value={num(data?.spent)}
              valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="الصافي" value={num(data?.net)}
              valueStyle={{ color: net < 0 ? '#cf1322' : '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="عدد الحركات" value={total} />
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col xs={24} md={8}>
            <Select
              allowClear showSearch optionFilterProp="label"
              style={{ width: '100%' }}
              placeholder="كل العملاء"
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
            />
          </Col>
          <Col xs={24} md={8}>
            <Select
              allowClear mode="multiple"
              style={{ width: '100%' }}
              placeholder="كل أنواع الحركة"
              value={kinds}
              onChange={setKinds}
              options={kindOptions}
              maxTagCount="responsive"
            />
          </Col>
          <Col xs={24} md={8}>
            <DateRangeFilter value={range} onChange={setRange} />
          </Col>
        </Row>
      </Card>

      {total > 0 && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message={`المعروض ${num(shown)} من ${num(total)} حركة`}
        />
      )}

      <Card size="small" bodyStyle={{ padding: 0 }}>
        <Table<PointRow>
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={data?.rows || []}
          columns={columns}
          scroll={{ x: true }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            onChange: setPage,
            showTotal: (t) => `${num(t)} حركة`,
          }}
        />
      </Card>
    </div>
  );
}
