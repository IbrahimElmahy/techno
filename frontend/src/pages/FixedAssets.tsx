import React, { useEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Input, Row, Select, Space, Table,
  Tabs, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, ReloadOutlined, ArrowLeftOutlined, BuildOutlined, SearchOutlined, ClearOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import { useScreenShortcuts } from '../components/keyboard';
import { TabModal } from '../components/TabModal';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';

import { money } from '../utils/money';

interface Asset {
  id: number; code: string; name: string; category: string | null;
  category_id: number | null; usage: string; annual_rate: string | null;
  opening_accumulated: string; depreciation_start: string | null;
  source_kind: string | null; source_id: number | null;
  acquisition_date: string; cost: string; salvage_value: string;
  useful_life_months: number; method: string; status: string;
  accumulated_depreciation: string; book_value: string;
  disposal_date: string | null; disposal_proceeds: string | null;
  gain_loss: string | null; notes: string | null;
  branch_id: number | null;
}

interface Category {
  id: number; name: string; method: string; annual_rate: string | null;
  useful_life_months: number | null; usage: string; active: boolean;
}

interface ReportRow {
  id: number; code: string; name: string; category: string | null; usage: string;
  branch_id: number | null; acquisition_date: string; method: string;
  annual_rate: string | null; useful_life_months: number | null;
  cost: string; accumulated: string; book_value: string; monthly: string;
  remaining_months: number | null; end_month: string | null;
}

interface ScheduleRow {
  year: number; month: number; amount: string; ledger_entry_id: number | null;
}

export const METHOD_LABELS: Record<string, string> = {
  straight_line: 'القسط الثابت',
  declining_balance: 'القسط المتناقص',
  sum_of_years: 'مجموع أرقام السنين',
  none: 'بدون إهلاك',
};
export const METHOD_OPTIONS = Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label }));
export const USAGE_LABELS: Record<string, string> = {
  production: 'إنتاجي', admin: 'إداري',
};
const USAGE_OPTIONS = [
  { value: 'production', label: 'إنتاجي (إهلاك صناعي)' },
  { value: 'admin', label: 'إداري (إهلاك إداري)' },
];
const SOURCE_LABELS: Record<string, string> = { purchase: 'فاتورة شراء', voucher: 'سند مصروف' };

const emptyForm = () => ({
  name: '', cost: undefined, salvage_value: 0, useful_life_months: undefined,
  annual_rate: undefined, method: undefined, usage: undefined, category_id: undefined,
  notes: '', branch_id: undefined, old: false, opening_accumulated: 0,
});

const rateText = (r: { annual_rate: string | null; useful_life_months: number | null }) => {
  if (r.annual_rate != null && Number(r.annual_rate) > 0) return `${Number(r.annual_rate)}%`;
  if (r.useful_life_months) return `${(1200 / r.useful_life_months).toFixed(2)}%`;
  return '-';
};

export default function FixedAssets() {
  const [tab, setTab] = useState('assets');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(emptyForm());
  const [acquired, setAcquired] = useState<Dayjs>(dayjs());
  const [depStart, setDepStart] = useState<Dayjs>(dayjs().startOf('month'));
  const [saving, setSaving] = useState(false);

  const [period, setPeriod] = useState<Dayjs>(dayjs());
  const [running, setRunning] = useState(false);

  const [disposing, setDisposing] = useState<Asset | null>(null);
  const [proceeds, setProceeds] = useState<number>(0);
  const [disposalDate, setDisposalDate] = useState<Dayjs>(dayjs());

  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [repFilters, setRepFilters] = useState<any>({});
  const [report, setReport] = useState<{ rows: ReportRow[]; totals: any } | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  const [catEdit, setCatEdit] = useState<any | null>(null);

  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '-';

  const load = async () => {
    setLoading(true);
    try {
      const [res, br, cats] = await Promise.all([
        api.get('/api/v1/fixed-assets'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/fixed-assets/categories'),
      ]);
      setBranches(br.data);
      setAssets(res.data || []);
      setCategories(cats.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const loadReport = async () => {
    setRepLoading(true);
    try {
      const r = await api.get('/api/v1/fixed-assets/report', {
        params: { as_of: asOf.endOf('month').format('YYYY-MM-DD'), ...repFilters },
      });
      setReport(r.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally { setRepLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === 'report') loadReport(); }, [tab, asOf, JSON.stringify(repFilters)]);

  useEffect(() => {
    if (!detail) { setSchedule([]); return; }
    api.get(`/api/v1/fixed-assets/${detail.id}/schedule`)
      .then((r) => setSchedule(r.data || []))
      .catch(console.error);
  }, [detail]);

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const filter = useListFilter(assets, {
    search: (a) => [a.code, a.name, a.category],
    filters: {
      status: (a, v) => a.status === v,
      method: (a, v) => a.method === v,
      category_id: (a, v) => a.category_id === v,
      usage: (a, v) => a.usage === v,
    },
  });

  const pickCategory = (id: number | undefined) => {
    const c = categories.find((x) => x.id === id);
    setForm((f: any) => ({
      ...f, category_id: id,
      method: c?.method ?? f.method,
      usage: c?.usage ?? f.usage,
      annual_rate: c?.annual_rate != null ? Number(c.annual_rate) : undefined,
      useful_life_months: c?.useful_life_months ?? undefined,
    }));
  };

  const save = async () => {
    if (!form.name || !form.cost) { message.warning('الاسم والتكلفة مطلوبان'); return; }
    if (!form.category_id) { message.warning('اختر فئة الأصل'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/fixed-assets', {
        name: form.name,
        cost: String(form.cost),
        salvage_value: String(form.salvage_value || 0),
        acquisition_date: acquired.format('YYYY-MM-DD'),
        category_id: form.category_id,
        usage: form.usage || null,
        method: form.method || null,
        annual_rate: form.annual_rate != null && form.annual_rate !== '' ? String(form.annual_rate) : null,
        useful_life_months: form.useful_life_months || null,
        opening_accumulated: form.old ? String(form.opening_accumulated || 0) : '0',
        depreciation_start: form.old ? depStart.startOf('month').format('YYYY-MM-DD') : null,
        branch_id: form.branch_id || null,
        notes: form.notes || null,
      });
      message.success('تم تسجيل الأصل');
      setCreating(false);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الأصل');
    } finally { setSaving(false); }
  };

  const runDepreciation = async () => {
    setRunning(true);
    try {
      const res = await api.post('/api/v1/fixed-assets/depreciation/run', {
        year: period.year(), month: period.month() + 1,
      });
      const { total, assets: count, skipped } = res.data;
      if (Number(total) === 0) {
        message.info(skipped
          ? `هذا الشهر مُرحَّل من قبل (${skipped} أصل) ولم يتغير شيء.`
          : 'لا يوجد إهلاك مستحق لهذا الشهر.');
      } else {
        message.success(`تم ترحيل إهلاك ${count} أصل بإجمالي ${money(total)}`);
      }
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر ترحيل الإهلاك');
    } finally { setRunning(false); }
  };

  const reverseDepreciation = async () => {
    try {
      await api.post('/api/v1/fixed-assets/depreciation/reverse', {
        year: period.year(), month: period.month() + 1,
      });
      message.success('تم عكس إهلاك الشهر');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر عكس الإهلاك');
    }
  };

  const dispose = async () => {
    if (!disposing) return;
    try {
      await api.post(`/api/v1/fixed-assets/${disposing.id}/dispose`, {
        disposal_date: disposalDate.format('YYYY-MM-DD'), proceeds: String(proceeds || 0),
      });
      message.success('تم تسجيل استبعاد الأصل');
      setDisposing(null); setDetail(null); setProceeds(0); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر استبعاد الأصل');
    }
  };

  const removeAsset = async (a: Asset) => {
    try {
      await api.delete(`/api/v1/fixed-assets/${a.id}`);
      message.success('تم حذف الأصل');
      setDetail(null); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حذف الأصل');
    }
  };

  const saveCategory = async () => {
    if (!catEdit?.name) { message.warning('اسم الفئة مطلوب'); return; }
    const body = {
      name: catEdit.name, method: catEdit.method || 'straight_line', usage: catEdit.usage || 'admin',
      annual_rate: catEdit.annual_rate != null && catEdit.annual_rate !== '' ? String(catEdit.annual_rate) : null,
      useful_life_months: catEdit.useful_life_months || null,
      active: catEdit.active !== false,
    };
    try {
      if (catEdit.id) await api.put(`/api/v1/fixed-assets/categories/${catEdit.id}`, body);
      else await api.post('/api/v1/fixed-assets/categories', body);
      message.success('تم حفظ الفئة');
      setCatEdit(null); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الفئة');
    }
  };

  const active = assets.filter((a) => a.status === 'active');
  const totalCost = active.reduce((s, a) => s + Number(a.cost), 0);
  const totalBook = active.reduce((s, a) => s + Number(a.book_value), 0);
  const categoryOptions = categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }));

  const docOpen = creating || !!detail;

  const columns: ColumnsType<Asset> = [
    { title: 'رقم', dataIndex: 'code', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'تاريخ الشراء', dataIndex: 'acquisition_date', width: 115,
      render: (d: string) => String(d).slice(0, 10) },
    { title: 'الاسم', dataIndex: 'name', ellipsis: true,
      render: (v: string, r: Asset) => (
        <Space size={4}>
          <b>{v}</b>
          {r.status !== 'active' && <Tag>مستبعد</Tag>}
        </Space>
      ) },
    { title: 'الفئة', dataIndex: 'category', width: 140, ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'الاستخدام', dataIndex: 'usage', width: 90,
      render: (v: string) => USAGE_LABELS[v] || v },
    { title: 'الفرع', dataIndex: 'branch_id', width: 110, ellipsis: true,
      render: (id: number | null) => branchName(id) },
    { title: 'الطريقة', dataIndex: 'method', width: 140,
      render: (v: string) => METHOD_LABELS[v] || v },
    { title: 'نسبة الإهلاك', key: 'rate', width: 100,
      render: (_: any, r: Asset) => rateText(r) },
    { title: 'التكلفة', dataIndex: 'cost', align: 'left', width: 130,
      render: (v: string) => money(v) },
    { title: 'القيمة الدفترية', dataIndex: 'book_value', align: 'left', width: 130,
      render: (v: string) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
  ];

  const tableCols = useTableColumns('fixed-assets', columns, {
    export: { name: 'الأصول الثابتة', rows: filter.filtered },
  });

  const reportCols: ColumnsType<ReportRow> = [
    { title: 'رقم', dataIndex: 'code', width: 100 },
    { title: 'الأصل', dataIndex: 'name', ellipsis: true },
    { title: 'الفئة', dataIndex: 'category', width: 130, render: (v) => v || '-' },
    { title: 'الاستخدام', dataIndex: 'usage', width: 80, render: (v: string) => USAGE_LABELS[v] || v },
    { title: 'الفرع', dataIndex: 'branch_id', width: 100, render: (v: number | null) => branchName(v) },
    { title: 'تاريخ الشراء', dataIndex: 'acquisition_date', width: 105 },
    { title: 'الطريقة', dataIndex: 'method', width: 120, render: (v: string) => METHOD_LABELS[v] || v },
    { title: 'النسبة', key: 'rate', width: 75, render: (_: any, r) => rateText(r) },
    { title: 'التكلفة', dataIndex: 'cost', width: 120, align: 'left', render: (v) => money(v) },
    { title: 'مجمع الإهلاك', dataIndex: 'accumulated', width: 120, align: 'left',
      render: (v) => <span style={{ color: '#cf1322' }}>{money(v)}</span> },
    { title: 'القيمة الدفترية', dataIndex: 'book_value', width: 125, align: 'left',
      render: (v) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
    { title: 'إهلاك الشهر القادم', dataIndex: 'monthly', width: 120, align: 'left', render: (v) => money(v) },
    { title: 'المتبقي (شهر)', dataIndex: 'remaining_months', width: 100, align: 'center',
      render: (v: number | null) => (v == null ? '-' : v) },
    { title: 'ينتهي في', dataIndex: 'end_month', width: 95, render: (v: string | null) => v || '-' },
  ];

  const categoryCols: ColumnsType<Category> = [
    { title: 'الفئة', dataIndex: 'name', render: (v: string, r) => (
      <Space>{v}{!r.active && <Tag>موقوفة</Tag>}</Space>) },
    { title: 'الاستخدام', dataIndex: 'usage', width: 120, render: (v: string) => USAGE_LABELS[v] || v },
    { title: 'الطريقة', dataIndex: 'method', width: 160, render: (v: string) => METHOD_LABELS[v] || v },
    { title: 'النسبة السنوية', key: 'rate', width: 120,
      render: (_: any, r) => (r.annual_rate != null ? `${Number(r.annual_rate)}%` : '-') },
    { title: 'العمر (شهور)', dataIndex: 'useful_life_months', width: 110, render: (v) => v || '-' },
    { title: '', key: 'edit', width: 90, render: (_: any, r) => (
      <Button size="small" onClick={() => setCatEdit({
        ...r, annual_rate: r.annual_rate != null ? Number(r.annual_rate) : undefined })}>تعديل</Button>) },
  ];

  const assetsTab = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        padding: '6px 4px 10px', borderBottom: '1px solid #f1f5f9', marginBottom: 6 }}>
        <b style={{ color: '#334155' }}>ترحيل إهلاك الشهر:</b>
        <DatePicker picker="month" value={period} allowClear={false}
          onChange={(v) => v && setPeriod(v)} />
        <Button type="primary" loading={running} onClick={runDepreciation}>
          ترحيل الإهلاك
        </Button>
        <Popconfirm title="عكس إهلاك الشهر؟"
          description="سيتم إنشاء قيد عكسي ويعود الشهر متاحاً للترحيل مرة أخرى."
          onConfirm={reverseDepreciation} okText="عكس" cancelText="إلغاء">
          <Button danger>عكس الشهر</Button>
        </Popconfirm>
      </div>

      <Table<Asset>
        className="sl-table"
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد أصول مسجلة' }}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true,
          showTotal: () => (
            <span className="sl-foot">
              <span>المعروض: <b>{filter.filtered.length}</b> من {assets.length}</span>
              <span>أصول قائمة: <b>{active.length}</b></span>
              <span>إجمالي التكلفة: <b>{money(totalCost)}</b></span>
              <span>القيمة الدفترية: <b style={{ color: '#0B5CA8' }}>{money(totalBook)}</b></span>
            </span>
          ) }}
        tableLayout="fixed"
        columns={tableCols.columns}
      />
    </>
  );

  const reportTab = (
    <>
      <Space wrap style={{ marginBottom: 10 }}>
        <span>حتى نهاية شهر:</span>
        <DatePicker picker="month" value={asOf} allowClear={false} onChange={(v) => v && setAsOf(v)} />
        <Select allowClear placeholder="الفئة" style={{ minWidth: 160 }} options={categoryOptions}
          value={repFilters.category_id}
          onChange={(v) => setRepFilters((f: any) => ({ ...f, category_id: v }))} />
        <Select allowClear placeholder="الاستخدام" style={{ minWidth: 130 }}
          options={USAGE_OPTIONS} value={repFilters.usage}
          onChange={(v) => setRepFilters((f: any) => ({ ...f, usage: v }))} />
        <Select allowClear placeholder="الفرع" style={{ minWidth: 130 }}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} value={repFilters.branch_id}
          onChange={(v) => setRepFilters((f: any) => ({ ...f, branch_id: v }))} />
        <Button icon={<ReloadOutlined />} onClick={loadReport}>تحديث</Button>
      </Space>
      <Table<ReportRow>
        className="sl-table" rowKey="id" size="small" loading={repLoading}
        dataSource={report?.rows || []} columns={reportCols} scroll={{ x: 1500 }}
        locale={{ emptyText: 'لا توجد أصول' }}
        pagination={{ defaultPageSize: 100, showSizeChanger: true }}
        summary={() => (report && report.rows.length ? (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
              <Table.Summary.Cell index={0} colSpan={8}>الإجمالي ({report.rows.length} أصل)</Table.Summary.Cell>
              <Table.Summary.Cell index={8} align="left">{money(report.totals.cost)}</Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="left">
                <span style={{ color: '#cf1322' }}>{money(report.totals.accumulated)}</span>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={10} align="left">
                <b style={{ color: '#0B5CA8' }}>{money(report.totals.book_value)}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={11} align="left">{money(report.totals.monthly)}</Table.Summary.Cell>
              <Table.Summary.Cell index={12} colSpan={2} />
            </Table.Summary.Row>
          </Table.Summary>
        ) : null)}
      />
    </>
  );

  const categoriesTab = (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 10 }}
        onClick={() => setCatEdit({ name: '', method: 'straight_line', usage: 'admin', active: true })}>
        فئة جديدة
      </Button>
      <Table<Category> className="sl-table" rowKey="id" size="small" dataSource={categories}
        columns={categoryCols} pagination={false} />
    </>
  );

  return (
    <>
    {!docOpen && (
    <ListPage
      icon={<BuildOutlined />}
      title="الأصول الثابتة"
      actions={(<>
        <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
          onClick={() => { setForm(emptyForm()); setCreating(true); }}>أصل جديد</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        {tab === 'assets' && tableCols.control}
      </>)}
      filters={tab === 'assets' ? (<>
        <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
          placeholder="بحث بالكود أو الاسم أو الفئة" prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        <Select allowClear placeholder="الفئة" value={filter.values.category_id}
          onChange={(v) => filter.setValue('category_id', v ?? undefined)} options={categoryOptions} />
        <Select allowClear placeholder="الاستخدام" value={filter.values.usage}
          onChange={(v) => filter.setValue('usage', v ?? undefined)} options={USAGE_OPTIONS} />
        <Select allowClear mode="multiple" maxTagCount="responsive" placeholder="الحالة"
          value={filter.values.status}
          onChange={(v) => filter.setValue('status', v?.length ? v : undefined)}
          options={[{ value: 'active', label: 'قائم' }, { value: 'disposed', label: 'مستبعد' }]} />
        <Select allowClear mode="multiple" maxTagCount="responsive" placeholder="طريقة الإهلاك"
          value={filter.values.method}
          onChange={(v) => filter.setValue('method', v?.length ? v : undefined)}
          options={METHOD_OPTIONS} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>) : undefined}
    >
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'assets', label: 'الأصول', children: assetsTab },
        { key: 'report', label: 'تقرير القيمة الدفترية', children: reportTab },
        { key: 'categories', label: 'فئات الأصول', children: categoriesTab },
      ]} />
    </ListPage>
    )}

      {creating && (
      <Card title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setCreating(false)}>رجوع</Button>
          <span>تسجيل أصل ثابت</span>
        </Space>
      )}>
        <Row gutter={[8, 8]}>
          <Col xs={24} md={12}>
            <Input placeholder="اسم الأصل" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Col>
          <Col xs={24} md={12}>
            <Select showSearch style={{ width: '100%' }} placeholder="فئة الأصل"
              value={form.category_id} onChange={pickCategory}
              filterOption={searchFilter} filterSort={searchRank} options={categoryOptions} />
          </Col>
          <Col xs={24} md={8}>
            <DatePicker style={{ width: '100%' }} value={acquired} allowClear={false}
              onChange={(v) => v && setAcquired(v)} placeholder="تاريخ الشراء" />
          </Col>
          <Col xs={24} md={8}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="التكلفة"
              value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
          </Col>
          <Col xs={24} md={8}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="القيمة التخريدية"
              value={form.salvage_value}
              onChange={(v) => setForm({ ...form, salvage_value: v })} />
          </Col>
          <Col xs={24} md={6}>
            <Select style={{ width: '100%' }} placeholder="الاستخدام" value={form.usage}
              onChange={(v) => setForm({ ...form, usage: v })} options={USAGE_OPTIONS} />
          </Col>
          <Col xs={24} md={6}>
            <Select style={{ width: '100%' }} placeholder="طريقة الإهلاك" value={form.method}
              onChange={(v) => setForm({ ...form, method: v })} options={METHOD_OPTIONS} />
          </Col>
          <Col xs={24} md={6}>
            <InputNumber style={{ width: '100%' }} min={0} max={100} placeholder="النسبة السنوية %"
              value={form.annual_rate}
              onChange={(v) => setForm({ ...form, annual_rate: v })} />
          </Col>
          <Col xs={24} md={6}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="العمر الإنتاجي (شهور)"
              value={form.useful_life_months}
              onChange={(v) => setForm({ ...form, useful_life_months: v })} />
          </Col>
          <Col xs={24} md={12}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="الفرع"
              value={form.branch_id}
              onChange={(v) => setForm({ ...form, branch_id: v })}
              filterOption={searchFilter} filterSort={searchRank}
              options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          </Col>
          <Col xs={24} md={12}>
            <Checkbox checked={form.old} onChange={(e) => setForm({ ...form, old: e.target.checked })}>
              أصل قديم عليه إهلاك سابق
            </Checkbox>
          </Col>
          {form.old && (<>
            <Col xs={24} md={12}>
              <InputNumber style={{ width: '100%' }} min={0} placeholder="مجمع الإهلاك السابق"
                value={form.opening_accumulated}
                onChange={(v) => setForm({ ...form, opening_accumulated: v })} />
            </Col>
            <Col xs={24} md={12}>
              <DatePicker picker="month" style={{ width: '100%' }} value={depStart} allowClear={false}
                onChange={(v) => v && setDepStart(v)} placeholder="بداية الإهلاك على النظام" />
            </Col>
          </>)}
          <Col xs={24}>
            <Input.TextArea rows={2} placeholder="ملاحظات" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Col>
        </Row>

        <div style={{
          marginTop: 16, padding: 16, borderRadius: 10,
          background: '#f6faf3', border: '1px solid #e6efe3',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <Button type="primary" size="large" loading={saving} onClick={save}>حفظ</Button>
          <Button size="large" onClick={() => setCreating(false)}>إلغاء</Button>
        </div>
      </Card>
      )}

      <TabModal
        open={!!disposing} onCancel={() => setDisposing(null)} onOk={dispose}
        title={`استبعاد ${disposing?.name || ''}`} okText="تسجيل الاستبعاد" cancelText="إلغاء"
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <DatePicker style={{ width: '100%' }} value={disposalDate} allowClear={false}
            onChange={(v) => v && setDisposalDate(v)} placeholder="تاريخ الاستبعاد" />
          <InputNumber style={{ width: '100%' }} min={0} placeholder="قيمة البيع"
            value={proceeds} onChange={(v) => setProceeds(v as number)} />
          {disposing && (
            <Alert
              type="info" showIcon
              message={`القيمة الدفترية الآن ${money(disposing.book_value)}`}
            />
          )}
        </Space>
      </TabModal>

      <TabModal
        open={!!catEdit} onCancel={() => setCatEdit(null)} onOk={saveCategory}
        title={catEdit?.id ? 'تعديل فئة' : 'فئة جديدة'} okText="حفظ" cancelText="إلغاء" destroyOnHidden
      >
        {catEdit && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input placeholder="اسم الفئة" value={catEdit.name}
              onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })} />
            <Select style={{ width: '100%' }} value={catEdit.usage} options={USAGE_OPTIONS}
              onChange={(v) => setCatEdit({ ...catEdit, usage: v })} />
            <Select style={{ width: '100%' }} value={catEdit.method} options={METHOD_OPTIONS}
              onChange={(v) => setCatEdit({ ...catEdit, method: v })} />
            <InputNumber style={{ width: '100%' }} min={0} max={100} placeholder="النسبة السنوية %"
              value={catEdit.annual_rate} onChange={(v) => setCatEdit({ ...catEdit, annual_rate: v })} />
            <InputNumber style={{ width: '100%' }} min={1} placeholder="العمر الإنتاجي (شهور)"
              value={catEdit.useful_life_months}
              onChange={(v) => setCatEdit({ ...catEdit, useful_life_months: v })} />
            <Checkbox checked={catEdit.active !== false}
              onChange={(e) => setCatEdit({ ...catEdit, active: e.target.checked })}>فعالة</Checkbox>
          </Space>
        )}
      </TabModal>

      {detail && (
      <Card
        title={(
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />}
              onClick={() => setDetail(null)}>رجوع</Button>
            <span>{detail.name}</span>
          </Space>
        )}
        extra={detail.status === 'active' && (
          <Space>
            {!detail.source_kind && (
              <Popconfirm title="حذف الأصل؟" onConfirm={() => removeAsset(detail)}
                okText="حذف" cancelText="إلغاء">
                <Button>حذف</Button>
              </Popconfirm>
            )}
            <Button danger onClick={() => { setDisposing(detail); setProceeds(0); }}>
              استبعاد الأصل
            </Button>
          </Space>
        )}
      >
        <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
          <Descriptions.Item label="الكود">{detail.code}</Descriptions.Item>
          <Descriptions.Item label="الفئة">{detail.category || '-'}</Descriptions.Item>
          <Descriptions.Item label="الاستخدام">{USAGE_LABELS[detail.usage] || detail.usage}</Descriptions.Item>
          <Descriptions.Item label="الفرع">{branchName(detail.branch_id)}</Descriptions.Item>
          {detail.source_kind && (
            <Descriptions.Item label="المصدر">{SOURCE_LABELS[detail.source_kind] || detail.source_kind}</Descriptions.Item>
          )}
          <Descriptions.Item label="تاريخ الشراء">
            {String(detail.acquisition_date).slice(0, 10)}
          </Descriptions.Item>
          {detail.depreciation_start && (
            <Descriptions.Item label="بداية الإهلاك على النظام">
              {String(detail.depreciation_start).slice(0, 7)}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="التكلفة">{money(detail.cost)}</Descriptions.Item>
          <Descriptions.Item label="القيمة التخريدية">{money(detail.salvage_value)}</Descriptions.Item>
          <Descriptions.Item label="الطريقة">{METHOD_LABELS[detail.method] || detail.method}</Descriptions.Item>
          <Descriptions.Item label="النسبة السنوية">{rateText(detail)}</Descriptions.Item>
          <Descriptions.Item label="العمر الإنتاجي">
            {detail.useful_life_months ? `${detail.useful_life_months} شهر` : '-'}
          </Descriptions.Item>
          {Number(detail.opening_accumulated) > 0 && (
            <Descriptions.Item label="إهلاك سابق">{money(detail.opening_accumulated)}</Descriptions.Item>
          )}
          <Descriptions.Item label="مجمع الإهلاك">{money(detail.accumulated_depreciation)}</Descriptions.Item>
          <Descriptions.Item label="القيمة الدفترية"><b>{money(detail.book_value)}</b></Descriptions.Item>
          {detail.status === 'disposed' && (
            <Descriptions.Item label="نتيجة الاستبعاد">
              <span style={{ color: Number(detail.gain_loss) < 0 ? '#cf1322' : '#6AB42D' }}>
                {money(detail.gain_loss)}
              </span>{' '}
              (بيع بـ {money(detail.disposal_proceeds)} يوم{' '}
              {String(detail.disposal_date).slice(0, 10)})
            </Descriptions.Item>
          )}
        </Descriptions>

        <Table<ScheduleRow>
          rowKey={(r) => `${r.year}-${r.month}`} size="small" dataSource={schedule}
          locale={{ emptyText: 'لا يوجد إهلاك مرحل بعد' }}
          pagination={{ defaultPageSize: PAGE_SIZE }}
          columns={[
            { title: 'الشهر', render: (_: any, r) => `${r.year}-${String(r.month).padStart(2, '0')}` },
            { title: 'قيمة الإهلاك', dataIndex: 'amount', render: (v: string) => money(v) },
            { title: 'القيد', dataIndex: 'ledger_entry_id',
              render: (v: number | null) => (v ? <Tag>#{v}</Tag> : '-') },
          ]}
        />

        <div style={{ marginTop: 16, textAlign: 'left' }}>
          <Button size="large" onClick={() => setDetail(null)}>إغلاق</Button>
        </div>
      </Card>
      )}
    </>
  );
}
