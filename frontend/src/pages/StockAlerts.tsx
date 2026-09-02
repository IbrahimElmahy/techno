import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, choiceColumn } from '../components/gridColumns';
import { useTableColumns } from '../components/ColumnSettings';
import { useNavigate } from 'react-router-dom';

/**
 * تنبيهات المخزون — the two questions a stock manager asks that a balance list cannot answer:
 * what do I need to buy (below the reorder level), and what is about to go bad.
 *
 * Both are planning views. The limits behind the first are advisory by design: they warn, they
 * never block a sale — only running out of stock does that.
 */

interface ReorderRow {
  item_id: number;
  code: string | null;
  name: string;
  unit_of_measure: string | null;
  on_hand: string;
  min_stock: string | null;
  max_stock: string | null;
  shortfall: string | null;
  excess: string | null;
  flag: 'below_min' | 'above_max';
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

/**
 * حد إعادة الطلب — كام لازم نشتري.
 *
 * The screen used to carry two more tabs, «كميات انتهاء الصلاحية» and «حركات انتهاء الصلاحية».
 * Both were removed at the client's request: the company does not work with expiry dates on what
 * it sells, so the screens were answering a question nobody here asks.
 *
 * الصلاحية نفسها لسه شغالة تحت — البيع لسه بيصرف بالأقرب انتهاءً، والمرتجع لسه بيرجّع لتشغيلته.
 * The tracking is untouched; only the two screens that displayed it are gone.
 */
export default function StockAlerts() {
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [summary, setSummary] = useState({ below_min: 0, above_max: 0 });
  const [loading, setLoading] = useState(false);

  const loadReorder = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/reorder');
      setReorder(res.data.rows || []);
      setSummary({ below_min: res.data.below_min || 0, above_max: res.data.above_max || 0 });
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { loadReorder(); }, []);

  const reorderFilter = useListFilter(reorder, {
    search: (r) => [r.code, r.name],
    filters: { flag: (r, v) => r.flag === v },
  });
  // «الصنف ده تحت الأدنى» — الخطوة اللي بعدها دايماً هي فتح ملف الصنف عشان تشوف حركته وتقرّر
  // تشتري كام، فالسطر بيوصّلك هناك على طول.
  const navigate = useNavigate();
  const reorderKb = useTableKeyboard<ReorderRow>({
    rows: reorderFilter.filtered, rowKey: (r) => r.item_id,
    onOpen: (r) => navigate(`/catalog/${r.item_id}`),
  });


  const columns = [
    { title: 'الكود', dataIndex: 'code', ...textColumn(reorder, (r: ReorderRow) => r.code),
      render: (c: string) => <Tag>{c}</Tag> },
    { title: 'الصنف', dataIndex: 'name', ...textColumn(reorder, (r: ReorderRow) => r.name),
      render: (n: string) => <b>{n}</b> },
    { title: 'الرصيد الحالي', dataIndex: 'on_hand',
      ...numberColumn<ReorderRow>((r) => r.on_hand),
      render: (v: string, r: ReorderRow) => (
        <span style={{ fontWeight: 600,
          color: r.flag === 'below_min' ? '#cf1322' : '#F5A11D' }}>
          {qty(v)} {r.unit_of_measure || ''}
        </span>
      ) },
    { title: 'الحد الأدنى', dataIndex: 'min_stock',
      ...numberColumn<ReorderRow>((r) => r.min_stock),
      render: (v: string) => (v ? qty(v) : '-') },
    { title: 'الحد الأقصى', dataIndex: 'max_stock',
      ...numberColumn<ReorderRow>((r) => r.max_stock),
      render: (v: string) => (v ? qty(v) : '-') },
    { title: 'المطلوب شراؤه', dataIndex: 'shortfall',
      ...numberColumn<ReorderRow>((r) => r.shortfall),
      render: (v: string | null) => (v
        ? <b style={{ color: '#cf1322' }}>{qty(v)}</b> : '-') },
    { title: 'الزائد', dataIndex: 'excess',
      ...numberColumn<ReorderRow>((r) => r.excess),
      render: (v: string | null) => (v
        ? <b style={{ color: '#F5A11D' }}>{qty(v)}</b> : '-') },
    { title: 'الحالة', dataIndex: 'flag',
      ...choiceColumn<ReorderRow>(
        [{ text: 'تحت الأدنى', value: 'below_min' },
         { text: 'فوق الأقصى', value: 'above_max' }],
        (r, v) => r.flag === v),
      render: (f: string) => (f === 'below_min'
        ? <Tag color="red">تحت الأدنى</Tag>
        : <Tag color="orange">فوق الأقصى</Tag>) },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('stock-alerts', columns, {
    export: { name: 'تنبيهات المخزون', rows: reorderFilter.filtered },
  });

  // تبويب واحد بس فضل، فمافيش شريط تبويبات. «قرب انتهاء الصلاحية» و«حركات انتهاء
  // الصلاحية» اتشالوا بطلب العميل — الشركة مابتستعملهمش.
  return (
            <Card title="الأصناف خارج حدودها المخزنية"
              extra={<Space>{tableCols.control}
                <Button icon={<ReloadOutlined />} onClick={loadReorder}>تحديث</Button></Space>}>
              <Alert type="info" showIcon style={{ marginBottom: 12 }}
                message="الحدود إرشادية للتخطيط فقط — لا تمنع أي عملية بيع."
                description="الصنف يظهر هنا لو رصيده الكلي نزل تحت الحد الأدنى أو تعدّى الحد الأقصى." />

              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col xs={24} md={12}>
                  <Card size="small">
                    <Statistic title="تحت الحد الأدنى (تحتاج شراء)" value={summary.below_min}
                      valueStyle={{ color: summary.below_min ? '#cf1322' : undefined }} />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small">
                    <Statistic title="فوق الحد الأقصى (تكدّس)" value={summary.above_max}
                      valueStyle={{ color: summary.above_max ? '#F5A11D' : undefined }} />
                  </Card>
                </Col>
              </Row>

              <ListToolbar
                searchPlaceholder="بحث بالصنف أو الكود"
                query={reorderFilter.query} onQueryChange={reorderFilter.setQuery}
                values={reorderFilter.values} onValueChange={reorderFilter.setValue}
                onReset={reorderFilter.reset}
                total={reorder.length} shown={reorderFilter.filtered.length}
                filters={[{ key: 'flag', placeholder: 'الحالة', options: [
                  { value: 'below_min', label: 'تحت الحد الأدنى' },
                  { value: 'above_max', label: 'فوق الحد الأقصى' },
                ] }]}
              />

              <Table
                {...reorderKb.tableProps}
                rowKey="item_id" size="small" loading={loading}
                dataSource={reorderFilter.filtered}
                locale={{ emptyText: 'كل الأصناف داخل حدودها' }}
                pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                columns={tableCols.columns}
              />
            </Card>
  );
}
