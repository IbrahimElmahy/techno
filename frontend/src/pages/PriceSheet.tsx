import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Input, Select, Space, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { normalizeAr } from '../components/ListToolbar';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

interface Tier { key: string; label: string }

interface PriceRow {
  item_id: number;
  code: string;
  name: string;
  category: string | null;
  unit: string;
  prices: Record<string, string>;
  discount_pct: string;
  net_prices: Record<string, string>;
  on_hand: string | null;
}

const money = (v: any) => (v === null || v === undefined || v === ''
  ? '' : Number(v).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * كشف التسعير — نسخة من فاتورة البيع بكل الأصناف وبدون كميات.
 *
 * الفاتورة بتجاوب «التاجر ده هياخد الكمية دي بكام». الورقة دي بتجاوب سؤال تاني:
 * «الصنف ده بكام، بكل الشرائح؟» — بتتطبع وتتبعت للتاجر قبل ما يطلب.
 *
 * **بتعرض الشبكة كاملة مش شريحة واحدة.** ده الفرق الحقيقي عن الفاتورة: الفاتورة
 * بتختار شريحة التاجر وتخفي الباقي، والكشف بيحط الستة جنب بعض عشان اللي بيسعّر
 * يقارن ويقرر.
 *
 * ومافيش ترقيم صفحات: ورقة تسعير ناقصة بتوصل للتاجر وهو مش عارف إنها ناقصة،
 * فبيسأل على صنف مش فيها ويتقاله «مش عندنا».
 */
export default function PriceSheet() {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [withStock, setWithStock] = useState(false);
  const [netMode, setNetMode] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/v1/price-sheet', {
        params: { with_stock: withStock || undefined },
      });
      setRows(r.data?.rows ?? []);
      setTiers(r.data?.tiers ?? []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الكشف');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [withStock]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'ar'))
      .map((c) => ({ value: c as string, label: c as string })),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = normalizeAr(query.trim());
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (!needle) return true;
      return normalizeAr(r.name).includes(needle) || r.code.toLowerCase().includes(needle);
    });
  }, [rows, query, category]);

  /** السعر المعروض: قبل الخصم أو بعده، حسب المفتاح. */
  const priceOf = (r: PriceRow, tier: string) =>
    (netMode ? r.net_prices : r.prices)[tier];

  const columns: ColumnsType<PriceRow> = [
    { title: 'الكود', dataIndex: 'code', width: 150, fixed: 'left' as const },
    {
      title: 'الصنف', dataIndex: 'name', width: 260, fixed: 'left' as const,
      sorter: (a, b) => a.name.localeCompare(b.name, 'ar'),
    },
    { title: 'الفئة', dataIndex: 'category', width: 150, ellipsis: true,
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>—</span> },
    { title: 'الوحدة', dataIndex: 'unit', width: 80, align: 'center' as const },
    ...tiers.map((t) => ({
      title: t.label,
      key: t.key,
      align: 'left' as const,
      width: 120,
      sorter: (a: PriceRow, b: PriceRow) =>
        Number(priceOf(a, t.key) || 0) - Number(priceOf(b, t.key) || 0),
      // الخانة الفاضية معناها «مش بيتباع بالشريحة دي» — والصفر معناه «ببلاش».
      // الفرق ده بيتقرا على الورقة، فالفاضي بيفضل فاضي مش صفر.
      render: (_: unknown, r: PriceRow) => {
        const v = priceOf(r, t.key);
        return v === undefined ? <span style={{ color: '#d9d9d9' }}>—</span> : <b>{money(v)}</b>;
      },
    })),
    {
      title: 'الخصم', dataIndex: 'discount_pct', width: 90, align: 'center' as const,
      render: (v: string) => (Number(v) ? <Tag color="orange">{Number(v)}%</Tag>
        : <span style={{ color: '#8c8c8c' }}>—</span>),
    },
    ...(withStock ? [{
      title: 'الرصيد', dataIndex: 'on_hand', width: 100, align: 'left' as const,
      render: (v: string | null) => (v === null ? '—'
        : <span style={{ color: Number(v) > 0 ? undefined : '#cf1322' }}>
            {Number(v).toLocaleString('ar-EG')}
          </span>),
    }] : []),
  ];

  const kb = useTableKeyboard({ rows: shown });

  const printCols = (): PrintColumn<PriceRow>[] => [
    { title: 'الكود', value: 'code' },
    { title: 'الصنف', value: 'name' },
    { title: 'الوحدة', value: 'unit' },
    ...tiers.map((t) => ({
      title: t.label,
      value: (r: PriceRow) => money(priceOf(r, t.key)),
      numeric: true,
    })),
    { title: 'الخصم', value: (r: PriceRow) => (Number(r.discount_pct) ? `${Number(r.discount_pct)}%` : '') },
  ];

  const printIt = () => {
    if (!shown.length) { message.info('مافيش أصناف للطباعة'); return; }
    printReport(
      {
        title: 'كشف تسعير',
        meta: [
          ['عدد الأصناف', String(shown.length)],
          ['الأسعار', netMode ? 'بعد الخصم' : 'قبل الخصم'],
          ...(category ? [['الفئة', category] as [string, string]] : []),
          ...(query.trim() ? [['بحث', query.trim()] as [string, string]] : []),
        ],
      },
      printCols(),
      shown,
      [],
    );
  };

  const exportIt = () => {
    if (!shown.length) { message.info('مافيش أصناف للتصدير'); return; }
    const cols: CsvColumn<PriceRow>[] = printCols()
      .map(({ title, value }) => ({ title, value }) as CsvColumn<PriceRow>);
    writeCsv('price-sheet', cols, shown);
  };

  return (
    <Card
      title="كشف تسعير"
      extra={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
          <Button icon={<DownloadOutlined />} onClick={exportIt}>تصدير</Button>
          <Button type="primary" icon={<PrinterOutlined />} onClick={printIt}>طباعة</Button>
        </Space>
      )}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear prefix={<SearchOutlined />} placeholder="بحث بالاسم أو الكود"
          value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 260 }}
        />
        <Select
          allowClear placeholder="كل الفئات" style={{ width: 200 }}
          value={category} onChange={setCategory} options={categories} showSearch
        />
        <Checkbox checked={netMode} onChange={(e) => setNetMode(e.target.checked)}>
          الأسعار بعد الخصم
        </Checkbox>
        <Checkbox checked={withStock} onChange={(e) => setWithStock(e.target.checked)}>
          أظهر الرصيد
        </Checkbox>
      </Space>

      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={`${shown.length} صنف من ${rows.length}`}
        description={'الكشف ده مش مستند: مابيحجزش بضاعة ومابيخصمش مخزون ومابيدخلش '
          + 'الدفتر. الصنف اللي رصيده صفر بيفضل معروض — التاجر بيسأل عن السعر قبل ما '
          + 'البضاعة توصل. والخانة الفاضية معناها «مش بيتباع بالشريحة دي»، مش صفر.'}
      />

      <Table<PriceRow>
        {...kb.tableProps}
        rowKey="item_id"
        size="small"
        loading={loading}
        dataSource={shown}
        columns={columns}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} صنف` }}
        locale={{ emptyText: 'مافيش أصناف' }}
      />
    </Card>
  );
}
