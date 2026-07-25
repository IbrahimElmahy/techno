import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Table, Descriptions, Statistic, Row, Col, Card, Tag, Spin,
  Space, Button, Empty, Typography,
} from 'antd';
import {
  ReloadOutlined, ArrowRightOutlined, RiseOutlined, FallOutlined, EditOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import ItemEditModal from '../components/ItemEditModal';
import { SerialsPanel, UnitsPanel } from '../components/ItemUnitsPanel';

/**
 * ملف الصنف (Item 360) — where this item is, who bought it, who we bought it from, every
 * movement it ever made, and every time its price changed.
 */

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

const KIND_LABEL: Record<string, string> = {
  product: 'منتج تام', raw_material: 'مادة خام',
};
const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري', semi_commercial: 'نصف تجاري', wholesale: 'جملة',
  semi_wholesale: 'نصف جملة', consumer: 'مستهلك',
};
const PRICE_FIELD_LABELS: Record<string, string> = {
  sale_price: 'سعر البيع', purchase_price: 'سعر الشراء',
  default_discount_pct: 'نسبة الخصم الافتراضية', ...TIER_LABELS,
};
// Every movement_type the services actually post — keep in sync with stock/manufacturing.
const MOVEMENT_LABELS: Record<string, string> = {
  purchase_in: 'شراء',
  purchase_return_out: 'مرتجع مشتريات',
  sale_out: 'بيع',
  sale_return_in: 'مرتجع مبيعات',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  production_in: 'إنتاج',
  reverse_production_in: 'عكس إنتاج',
  consumption_out: 'استهلاك تصنيع',
  reverse_consumption_out: 'عكس استهلاك',
  waste_out: 'هالك',
  reverse_waste_out: 'عكس هالك',
  inspection_out: 'صرف معاينة',
  reverse_inspection_out: 'عكس صرف معاينة',
  loyalty_gift_out: 'هدية ولاء',
  serial_receive_in: 'استلام بسريال',
};

export default function ItemProfile() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { user } = useAuth();
  // Same gate as the catalog list: only the roles allowed to create items may edit one.
  const canEdit = ['system_admin', 'purchasing_manager'].includes(user?.role || '');
  const canEditPoints = ['system_admin', 'after_sales_staff'].includes(user?.role || '');
  const canEditPrices = ['system_admin', 'branch_manager', 'purchasing_manager']
    .includes(user?.role || '');

  const load = async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/items/${itemId}/profile`);
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [itemId]);

  const it = data?.item;
  const onHand = Number(data?.on_hand || 0);

  return (
    <div>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowRightOutlined />} onClick={() => navigate('/catalog')}>
              رجوع
            </Button>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {it ? `ملف الصنف: ${it.name} (${it.code})` : 'ملف الصنف'}
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            {canEdit && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
                تعديل البيانات والأسعار والنقاط
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
          </Space>
        }
      >
        {loading && !data ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : !data ? (
          <Empty description="لا توجد بيانات" />
        ) : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="الرصيد الحالي" value={qty(data.on_hand)}
                    suffix={it.unit_of_measure}
                    valueStyle={{ color: onHand > 0 ? '#3f8600' : onHand < 0 ? '#cf1322' : undefined }} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المبيع" value={qty(data.sold_quantity)}
                    suffix={it.unit_of_measure} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="قيمة المبيعات" value={money(data.sold_value)} suffix="ج.م" />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="قيمة المشتريات" value={money(data.purchased_value)} suffix="ج.م" />
                </Card>
              </Col>
            </Row>

            <Tabs
              items={[
                {
                  key: 'overview',
                  label: 'نظرة عامة',
                  children: (
                    <>
                      <Descriptions bordered column={2} size="small">
                        <Descriptions.Item label="الكود">{it.code}</Descriptions.Item>
                        <Descriptions.Item label="الاسم">{it.name}</Descriptions.Item>
                        <Descriptions.Item label="النوع">
                          {KIND_LABEL[it.kind] || it.kind}
                        </Descriptions.Item>
                        <Descriptions.Item label="وحدة القياس">{it.unit_of_measure}</Descriptions.Item>
                        <Descriptions.Item label="التصنيف">{it.category || '-'}</Descriptions.Item>
                        <Descriptions.Item label="الحالة">
                          {it.active ? <Tag color="green">نشط</Tag> : <Tag color="red">معطل</Tag>}
                        </Descriptions.Item>
                        <Descriptions.Item label="سعر البيع">
                          {it.sale_price ? `${money(it.sale_price)} ج.م` : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="سعر الشراء">
                          {it.purchase_price ? `${money(it.purchase_price)} ج.م` : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="متوسط سعر البيع الفعلي">
                          {money(data.avg_sale_price)} ج.م
                        </Descriptions.Item>
                        <Descriptions.Item label="متوسط سعر الشراء الفعلي">
                          {money(data.avg_purchase_price)} ج.م
                        </Descriptions.Item>
                        <Descriptions.Item label="بسريال">
                          {it.is_serialized ? 'نعم' : 'لا'}
                        </Descriptions.Item>
                        <Descriptions.Item label="إجمالي المشترى">
                          {qty(data.purchased_quantity)} {it.unit_of_measure}
                        </Descriptions.Item>
                      </Descriptions>

                      <Typography.Title level={5} style={{ marginTop: 20 }}>
                        الرصيد حسب المخزن
                      </Typography.Title>
                      <Table
                        size="small" rowKey={(r: any) => `${r.location_kind}-${r.location_id}`}
                        dataSource={data.stock_by_location} pagination={false}
                        locale={{ emptyText: 'لا يوجد رصيد لهذا الصنف' }}
                        columns={[
                          { title: 'الموقع', dataIndex: 'location', key: 'l' },
                          { title: 'النوع', dataIndex: 'location_kind', key: 'k',
                            render: (v: string) => (v === 'warehouse' ? 'مخزن' : 'عهدة') },
                          { title: 'الكمية', dataIndex: 'quantity', key: 'q',
                            render: (v: string) => (
                              <b style={{ color: Number(v) < 0 ? '#cf1322' : undefined }}>
                                {qty(v)} {it.unit_of_measure}
                              </b>
                            ) },
                        ]}
                      />

                      {data.tier_prices.length > 0 && (
                        <>
                          <Typography.Title level={5} style={{ marginTop: 20 }}>
                            أسعار الفئات الحالية
                          </Typography.Title>
                          <Table
                            size="small" rowKey="tier" dataSource={data.tier_prices}
                            pagination={false}
                            columns={[
                              { title: 'الفئة', dataIndex: 'tier', key: 't',
                                render: (v: string) => TIER_LABELS[v] || v },
                              { title: 'السعر', dataIndex: 'price', key: 'p',
                                render: (v: string) => <b>{money(v)} ج.م</b> },
                            ]}
                          />
                        </>
                      )}
                    </>
                  ),
                },
                {
                  key: 'movements',
                  label: `حركة المخزون (${data.movements.length})`,
                  children: (
                    <Table
                      size="small" rowKey="id" dataSource={data.movements} scroll={{ x: true }}
                      pagination={{ defaultPageSize: 20, showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                      columns={[
                        { title: 'التاريخ', dataIndex: 'date', key: 'd' },
                        { title: 'النوع', dataIndex: 'movement_type', key: 't',
                          render: (v: string) => MOVEMENT_LABELS[v] || v },
                        { title: 'الاتجاه', dataIndex: 'direction', key: 'dir',
                          render: (v: string) => (v === 'in'
                            ? <Tag color="green" icon={<RiseOutlined />}>وارد</Tag>
                            : <Tag color="red" icon={<FallOutlined />}>صادر</Tag>) },
                        { title: 'الكمية', dataIndex: 'quantity', key: 'q',
                          render: (v: string) => <b>{qty(v)}</b> },
                        { title: 'الموقع', dataIndex: 'location', key: 'l' },
                        { title: 'المستند', dataIndex: 'source', key: 's' },
                        { title: '', dataIndex: 'is_reversal', key: 'r',
                          render: (v: boolean) => (v ? <Tag>عكسي</Tag> : null) },
                      ]}
                    />
                  ),
                },
                {
                  key: 'sales',
                  label: `سجل البيع (${data.sales.length})`,
                  children: (
                    <Table
                      size="small" rowKey={(_r, i) => String(i)} dataSource={data.sales}
                      scroll={{ x: true }}
                      pagination={{ defaultPageSize: 20, showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                      columns={[
                        { title: 'الفاتورة', dataIndex: 'document_number', key: 'n' },
                        { title: 'التاريخ', dataIndex: 'date', key: 'd' },
                        { title: 'العميل', dataIndex: 'party', key: 'p' },
                        { title: 'الكمية', dataIndex: 'quantity', key: 'q',
                          render: (v: string) => qty(v) },
                        { title: 'سعر البيع', dataIndex: 'unit_price', key: 'u',
                          render: (v: string) => <b>{money(v)} ج.م</b> },
                        { title: 'الفئة', dataIndex: 'tier', key: 't',
                          render: (v: string) => (v ? TIER_LABELS[v] || v : '-') },
                        { title: 'الإجمالي', dataIndex: 'line_total', key: 'tot',
                          render: (v: string) => `${money(v)} ج.م` },
                      ]}
                    />
                  ),
                },
                {
                  key: 'purchases',
                  label: `سجل الشراء (${data.purchases.length})`,
                  children: (
                    <Table
                      size="small" rowKey={(_r, i) => String(i)} dataSource={data.purchases}
                      scroll={{ x: true }}
                      pagination={{ defaultPageSize: 20, showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                      columns={[
                        { title: 'الفاتورة', dataIndex: 'document_number', key: 'n' },
                        { title: 'التاريخ', dataIndex: 'date', key: 'd' },
                        { title: 'المورد', dataIndex: 'party', key: 'p' },
                        { title: 'الكمية', dataIndex: 'quantity', key: 'q',
                          render: (v: string) => qty(v) },
                        { title: 'سعر الشراء', dataIndex: 'unit_price', key: 'u',
                          render: (v: string) => <b>{money(v)} ج.م</b> },
                        { title: 'الإجمالي', dataIndex: 'line_total', key: 'tot',
                          render: (v: string) => `${money(v)} ج.م` },
                      ]}
                    />
                  ),
                },
                {
                  key: 'units',
                  label: 'الوحدات',
                  children: <UnitsPanel itemId={Number(itemId)} canEdit={canEditPrices} />,
                },
                ...(it.is_serialized ? [{
                  key: 'serials',
                  label: 'الأرقام التسلسلية',
                  children: <SerialsPanel itemId={Number(itemId)} canEdit={canEditPrices} />,
                }] : []),
                {
                  key: 'prices',
                  label: `سجل الأسعار (${data.price_history.length})`,
                  children: (
                    <Table
                      size="small" rowKey="id" dataSource={data.price_history} scroll={{ x: true }}
                      locale={{ emptyText: 'لم يتم تغيير أي سعر لهذا الصنف بعد' }}
                      pagination={{ defaultPageSize: 20, showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                      columns={[
                        { title: 'التاريخ', dataIndex: 'changed_at', key: 'd' },
                        { title: 'السعر', dataIndex: 'field', key: 'f',
                          render: (v: string) => PRICE_FIELD_LABELS[v] || v },
                        { title: 'من', dataIndex: 'old_value', key: 'o',
                          render: (v: string | null) => (v === null ? '—' : `${money(v)} ج.م`) },
                        { title: 'إلى', dataIndex: 'new_value', key: 'n',
                          render: (v: string | null) => (v === null ? '—' : <b>{money(v)} ج.م</b>) },
                        {
                          title: 'التغيير', key: 'delta',
                          render: (_: any, r: any) => {
                            if (r.old_value === null || r.new_value === null) return '—';
                            const diff = Number(r.new_value) - Number(r.old_value);
                            const pct = Number(r.old_value)
                              ? (diff / Number(r.old_value)) * 100 : 0;
                            const up = diff > 0;
                            return (
                              <Tag color={up ? 'red' : 'green'} icon={up ? <RiseOutlined /> : <FallOutlined />}>
                                {up ? '+' : ''}{money(diff)} ({pct.toFixed(1)}%)
                              </Tag>
                            );
                          },
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>

      <ItemEditModal
        itemId={itemId ? Number(itemId) : null}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
        canEditPrices={canEditPrices}
        canEditPoints={canEditPoints}
      />
    </div>
  );
}
