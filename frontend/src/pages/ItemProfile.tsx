import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Table, Descriptions, Statistic, Row, Col, Card, Tag, Spin,
  Space, Button, Empty, Typography,
} from 'antd';
import {
  ReloadOutlined, ArrowRightOutlined, RiseOutlined, FallOutlined, EditOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import ItemEditModal from '../components/ItemEditModal';
import { SerialsPanel, UnitsPanel } from '../components/ItemUnitsPanel';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import DocumentLink, { useOpenDocument } from '../components/DocumentLink';
import { useTableKeyboard } from '../components/keyboard';
import MovementHistoryModal, { MovementHistoryTarget } from '../components/MovementHistoryModal';
import { textColumn, numberColumn, choiceColumn, dateColumn } from '../components/gridColumns';

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

/** Offer only the values the loaded rows actually contain, labelled in Arabic. */
const optionsOf = (rows: any[], field: string, labels: Record<string, string> = {}) =>
  Array.from(new Set((rows || []).map((r) => r[field]).filter(Boolean)))
    .map((v: any) => ({ value: v, label: labels[v] || String(v) }));

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

  // Each record tab keeps its own search.
  const movementsFilter = useListFilter<any>(data?.movements || [], {
    search: (m) => [m.source, m.location, m.quantity, MOVEMENT_LABELS[m.movement_type] || m.movement_type],
    filters: {
      movement_type: (m, v) => m.movement_type === v,
      direction: (m, v) => m.direction === v,
    },
    dateOf: (m) => m.date,
  });
  const salesFilter = useListFilter<any>(data?.sales || [], {
    search: (r) => [r.document_number, r.party, r.unit_price, r.line_total],
    filters: { tier: (r, v) => r.tier === v },
    dateOf: (r) => r.date,
  });
  const purchasesFilter = useListFilter<any>(data?.purchases || [], {
    search: (r) => [r.document_number, r.party, r.unit_price, r.line_total],
    dateOf: (r) => r.date,
  });
  const pricesFilter = useListFilter<any>(data?.price_history || [], {
    search: (r) => [PRICE_FIELD_LABELS[r.field] || r.field, r.old_value, r.new_value],
    filters: { field: (r, v) => r.field === v },
    dateOf: (r) => r.changed_at,
  });

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

  const openDoc = useOpenDocument();
  const [history, setHistory] = useState<MovementHistoryTarget | null>(null);
  // رصيد في مخزن بيفتح حركات الصنف في المخزن ده — نفس النافذة اللي أرصدة المخازن بتفتحها.
  const stockKb = useTableKeyboard<any>({
    rows: data?.stock_by_location ?? [], rowKey: (r) => `${r.location_kind}-${r.location_id}`,
    onOpen: (r) => data && setHistory({
      itemId: data.item.id, itemName: data.item.name,
      locationKind: r.location_kind, locationId: r.location_id,
    }),
  });
  // وسطور البيع والشرا بتفتح فواتيرها — الزرار في آخر السطر، والسطر كله بقى يوصّل لنفس المكان.
  const salesKb = useTableKeyboard<any>({
    rows: salesFilter.filtered,
    rowKey: (r) => `${r.document_number}-${r.date}-${r.party}-${r.line_total}`,
    onOpen: (r) => openDoc('invoice', r.invoice_id),
  });
  const purchKb = useTableKeyboard<any>({
    rows: purchasesFilter.filtered,
    rowKey: (r) => `${r.document_number}-${r.date}-${r.party}-${r.line_total}`,
    onOpen: (r) => openDoc('purchase', r.invoice_id),
  });
  // الحركة نفسها مالهاش رقم مستند مربوط في الرد، فبتفتح كارت الصنف على تاريخها — أقرب حاجة أخص
  // من غير ما نخترع لينك بيودّي على قايمة.
  const movesKb = useTableKeyboard<any>({
    rows: movementsFilter.filtered, rowKey: (r) => r.id,
    onOpen: () => navigate(`/item-card?item=${itemId}`),
  });

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
            <Button icon={<FileTextOutlined />} disabled={!itemId}
              onClick={() => navigate(`/item-card?item=${itemId}`)}>
              كارت الصنف
            </Button>
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
                        {...stockKb.tableProps}
                        size="small" rowKey={(r: any) => `${r.location_kind}-${r.location_id}`}
                        dataSource={data.stock_by_location} pagination={false}
                        locale={{ emptyText: 'لا يوجد رصيد لهذا الصنف' }}
                        columns={[
                          { title: 'الموقع', dataIndex: 'location', key: 'l', ...textColumn(data?.stock_by_location ?? [], (r: any) => r.location) },
                          { title: 'النوع', dataIndex: 'location_kind', key: 'k', ...textColumn(data?.stock_by_location ?? [], (r: any) => r.location_kind),
                            render: (v: string) => (v === 'warehouse' ? 'مخزن' : 'عهدة') },
                          { title: 'الكمية', dataIndex: 'quantity', key: 'q', ...numberColumn<any>((r) => r.quantity),
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
                              { title: 'الفئة', dataIndex: 'tier', key: 't', ...textColumn(data?.tier_prices ?? [], (r: any) => r.tier),
                                render: (v: string) => TIER_LABELS[v] || v },
                              { title: 'السعر', dataIndex: 'price', key: 'p', ...numberColumn<any>((r) => r.price),
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
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث بالمستند أو الموقع"
                        searchSpan={7} showDateRange
                        query={movementsFilter.query} onQueryChange={movementsFilter.setQuery}
                        values={movementsFilter.values} onValueChange={movementsFilter.setValue}
                        range={movementsFilter.range} onRangeChange={movementsFilter.setRange}
                        onReset={movementsFilter.reset}
                        total={data.movements.length} shown={movementsFilter.filtered.length}
                        filters={[
                          { key: 'movement_type', placeholder: 'نوع الحركة',
                            options: optionsOf(data.movements, 'movement_type', MOVEMENT_LABELS) },
                          { key: 'direction', placeholder: 'الاتجاه', span: 3,
                            options: [
                              { value: 'in', label: 'وارد' }, { value: 'out', label: 'صادر' },
                            ] },
                        ]}
                      />
                      <Table
                        {...movesKb.tableProps}
                        size="small" rowKey="id" dataSource={movementsFilter.filtered} scroll={{ x: true }}
                        pagination={{ defaultPageSize: 20, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                        columns={[
                        { title: 'التاريخ', dataIndex: 'date', key: 'd', ...dateColumn<any>((r) => r.date) },
                        { title: 'النوع', dataIndex: 'movement_type', key: 't', ...textColumn(data?.movements ?? [], (r: any) => MOVEMENT_LABELS[r.movement_type] || r.movement_type),
                          render: (v: string) => MOVEMENT_LABELS[v] || v },
                        { title: 'الاتجاه', dataIndex: 'direction', key: 'dir', ...choiceColumn<any>([{ text: 'وارد', value: 'in' }, { text: 'صادر', value: 'out' }], (r, v) => r.direction === v),
                          render: (v: string) => (v === 'in'
                            ? <Tag color="green" icon={<RiseOutlined />}>وارد</Tag>
                            : <Tag color="red" icon={<FallOutlined />}>صادر</Tag>) },
                        { title: 'الكمية', dataIndex: 'quantity', key: 'q',
                            ...numberColumn<any>((r) => r.quantity),
                          render: (v: string) => <b>{qty(v)}</b> },
                        { title: 'الموقع', dataIndex: 'location', key: 'l', ...textColumn(data?.movements ?? [], (r: any) => r.location) },
                        { title: 'المستند', dataIndex: 'source', key: 's', ...textColumn(data?.movements ?? [], (r: any) => r.source) },
                        { title: '', dataIndex: 'is_reversal', key: 'r',
                          render: (v: boolean) => (v ? <Tag>عكسي</Tag> : null) },
                        ]}
                      />
                    </>
                  ),
                },
                {
                  key: 'sales',
                  label: `سجل البيع (${data.sales.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم الفاتورة أو العميل"
                        searchSpan={8} showDateRange
                        query={salesFilter.query} onQueryChange={salesFilter.setQuery}
                        values={salesFilter.values} onValueChange={salesFilter.setValue}
                        range={salesFilter.range} onRangeChange={salesFilter.setRange}
                        onReset={salesFilter.reset}
                        total={data.sales.length} shown={salesFilter.filtered.length}
                        filters={[
                          { key: 'tier', placeholder: 'الفئة',
                            options: optionsOf(data.sales, 'tier', TIER_LABELS) },
                        ]}
                      />
                      <Table
                        // Keyed by the row's own identity, not its position: these rows are
                        // filtered, so an index key would re-map content across rows.
                        {...salesKb.tableProps}
                        size="small" dataSource={salesFilter.filtered}
                        rowKey={(r: any) => `${r.document_number}-${r.date}-${r.party}-${r.line_total}`}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 20, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                        columns={[
                          { title: 'الفاتورة', dataIndex: 'document_number', key: 'n', ...textColumn(data?.sales ?? [], (r: any) => r.document_number) },
                          { title: 'التاريخ', dataIndex: 'date', key: 'd', ...dateColumn<any>((r) => r.date) },
                          { title: 'العميل', dataIndex: 'party', key: 'p', ...textColumn(data?.sales ?? [], (r: any) => r.party) },
                          { title: 'الكمية', dataIndex: 'quantity', key: 'q',
                            ...numberColumn<any>((r) => r.quantity),
                            render: (v: string) => qty(v) },
                          { title: 'سعر البيع', dataIndex: 'unit_price', key: 'u', ...numberColumn<any>((r) => r.unit_price),
                            render: (v: string) => <b>{money(v)} ج.م</b> },
                          { title: 'الفئة', dataIndex: 'tier', key: 't',
                            ...textColumn(data?.sales ?? [], (r: any) => r.tier),
                            render: (v: string) => (v ? TIER_LABELS[v] || v : '-') },
                          { title: 'الإجمالي', dataIndex: 'line_total', key: 'tot', ...numberColumn<any>((r) => r.line_total),
                            render: (v: string) => `${money(v)} ج.م` },
                          // The item's history used to be read-only rows; now each one leads
                          // back to the invoice it came from.
                          { title: '', key: 'link', width: 180,
                            render: (_: any, r: any) => (r.invoice_id
                              ? <DocumentLink kind="invoice" id={r.invoice_id} size="small" allowEdit />
                              : null) },
                        ]}
                      />
                    </>
                  ),
                },
                {
                  key: 'purchases',
                  label: `سجل الشراء (${data.purchases.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم الفاتورة أو المورد"
                        searchSpan={8} showDateRange
                        query={purchasesFilter.query} onQueryChange={purchasesFilter.setQuery}
                        range={purchasesFilter.range} onRangeChange={purchasesFilter.setRange}
                        onReset={purchasesFilter.reset}
                        total={data.purchases.length} shown={purchasesFilter.filtered.length}
                      />
                      <Table
                        {...purchKb.tableProps}
                        size="small" dataSource={purchasesFilter.filtered}
                        rowKey={(r: any) => `${r.document_number}-${r.date}-${r.party}-${r.line_total}`}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 20, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                        columns={[
                          { title: 'الفاتورة', dataIndex: 'document_number', key: 'n', ...textColumn(data?.purchases ?? [], (r: any) => r.document_number) },
                          { title: 'التاريخ', dataIndex: 'date', key: 'd', ...dateColumn<any>((r) => r.date) },
                          { title: 'المورد', dataIndex: 'party', key: 'p', ...textColumn(data?.purchases ?? [], (r: any) => r.party) },
                          { title: 'الكمية', dataIndex: 'quantity', key: 'q',
                            ...numberColumn<any>((r) => r.quantity),
                            render: (v: string) => qty(v) },
                          { title: 'سعر الشراء', dataIndex: 'unit_price', key: 'u', ...numberColumn<any>((r) => r.unit_price),
                            render: (v: string) => <b>{money(v)} ج.م</b> },
                          { title: 'الإجمالي', dataIndex: 'line_total', key: 'tot',
                            ...numberColumn<any>((r) => r.line_total),
                            render: (v: string) => `${money(v)} ج.م` },
                          { title: '', key: 'link', width: 140,
                            render: (_: any, r: any) => (r.invoice_id
                              ? <DocumentLink kind="purchase" id={r.invoice_id} size="small" />
                              : null) },
                        ]}
                      />
                    </>
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
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث بنوع السعر أو القيمة"
                        searchSpan={8} showDateRange
                        query={pricesFilter.query} onQueryChange={pricesFilter.setQuery}
                        values={pricesFilter.values} onValueChange={pricesFilter.setValue}
                        range={pricesFilter.range} onRangeChange={pricesFilter.setRange}
                        onReset={pricesFilter.reset}
                        total={data.price_history.length} shown={pricesFilter.filtered.length}
                        filters={[
                          { key: 'field', placeholder: 'نوع السعر',
                            options: optionsOf(data.price_history, 'field', PRICE_FIELD_LABELS) },
                        ]}
                      />
                      <Table
                        size="small" rowKey="id" dataSource={pricesFilter.filtered} scroll={{ x: true }}
                        locale={{ emptyText: 'لم يتم تغيير أي سعر لهذا الصنف بعد' }}
                        pagination={{ defaultPageSize: 20, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                        columns={[
                        { title: 'التاريخ', dataIndex: 'changed_at', key: 'd', ...dateColumn<any>((r) => r.changed_at) },
                        { title: 'السعر', dataIndex: 'field', key: 'f', ...textColumn(data?.price_history ?? [], (r: any) => r.field),
                          render: (v: string) => PRICE_FIELD_LABELS[v] || v },
                        { title: 'من', dataIndex: 'old_value', key: 'o', ...numberColumn<any>((r) => r.old_value),
                          render: (v: string | null) => (v === null ? '—' : `${money(v)} ج.م`) },
                        { title: 'إلى', dataIndex: 'new_value', key: 'n', ...numberColumn<any>((r) => r.new_value),
                          render: (v: string | null) => (v === null ? '—' : <b>{money(v)} ج.م</b>) },
                        {
                          title: 'التغيير', key: 'delta',
                          // فلتر على نسبة التغيير نفسها: «إيه اللي غلي أكتر من ١٠٪» مالهاش
                          // إجابة من عمودي «من» و«إلى» كل واحد لوحده.
                          ...numberColumn<any>((r) => (r.old_value && r.new_value !== null
                            ? ((Number(r.new_value) - Number(r.old_value)) / Number(r.old_value)) * 100
                            : 0)),
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
                    </>
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
      <MovementHistoryModal target={history} onClose={() => setHistory(null)} />
    </div>
  );
}
