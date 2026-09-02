import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Space, Statistic, Table, Tabs, Tag, message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ExportExcelButton from '../components/ExportExcelButton';
import DateRangeFilter from '../components/DateRangeFilter';
import { useQueryTab } from '../components/useQueryTab';

/**
 * تقارير ما بعد البيع — خمسة من قايمة «تقارير متابعة» في نظامهم القديم.
 *
 * مافيش حاجة جديدة بتتسجّل عشان يتعرضوا: مستند الصرف بيقول الورقة راحت لمين، والاستلام
 * بيقول رجعت من مين، والمعاينة شايلة فنيها ومندوبها ونقاطها.
 *
 * **السباك والموزع ليهم تبويبين مش واحد.** السؤالين مختلفين: الموزع ماسك ورق ولازم يرجّعه،
 * والسباك بيجيب ورق. عمود «المتبقي» على الاتنين بيخلّي واحد منهم يكدب — السباك بيطلع
 * بالسالب لأنه بيرجّع ورق مااتصرفش له، وهو اتصرف للموزع أصلاً.
 *
 * والفترة مشتركة بين التبويبات عن قصد: «رجّع كام الشهر ده» و«عاين كام» بيتسألوا عن نفس
 * الشهر، ومنتقيَي تاريخ ممكن يختلفوا هو اللي بيخلّي حد يقارن مارس بأبريل من غير ما ياخد باله.
 */

interface PartyRow {
  customer_id: number | null;
  name: string;
  phone: string | null;
  issued: number;
  returned: number;
  outstanding: number;
  received: number;
  last_issue: string | null;
  last_receipt: string | null;
}

interface TechRow {
  name: string;
  customer_id: number | null;
  visits: number;
  points: string;
  last_visit: string | null;
}

interface RepRow {
  rep_user_id: number | null;
  name: string;
  visits: number;
  points: string;
  customers: number;
  last_visit: string | null;
}

const num = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
const pts = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 });

export default function AfterSalesReports() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useQueryTab('plumbers');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [loading, setLoading] = useState(false);

  const [plumbers, setPlumbers] = useState<PartyRow[]>([]);
  const [distributors, setDistributors] = useState<PartyRow[]>([]);
  const [techs, setTechs] = useState<TechRow[]>([]);
  const [reps, setReps] = useState<RepRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = {};
    if (range) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    try {
      const [p, d, t, r] = await Promise.all([
        api.get('/api/v1/after-sales-reports/coupons/by-plumber', { params }),
        api.get('/api/v1/after-sales-reports/coupons/by-distributor', { params }),
        api.get('/api/v1/after-sales-reports/inspections/by-technician', { params }),
        api.get('/api/v1/after-sales-reports/inspections/by-rep', { params }),
      ]);
      setPlumbers(p.data || []);
      setDistributors(d.data || []);
      setTechs(t.data || []);
      setReps(r.data || []);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقارير');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const plumberFilter = useListFilter(plumbers, { search: (r) => [r.name, r.phone] });
  const distFilter = useListFilter(distributors, { search: (r) => [r.name, r.phone] });
  const techFilter = useListFilter(techs, { search: (r) => [r.name] });
  const repFilter = useListFilter(reps, { search: (r) => [r.name] });

  const openCard = (id: number | null) => { if (id) navigate(`/customers/${id}`); };

  const plumberColumns = [
    { title: 'الفني', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (v: string, r: PartyRow) => (
        <a onClick={() => openCard(r.customer_id)}>{v}</a>) },
    { title: 'الهاتف', dataIndex: 'phone', key: 'phone', width: 130,
      render: (v: string | null) => v || '-' },
    { title: 'رجّع', dataIndex: 'received', key: 'received', width: 100,
      sorter: (a: PartyRow, b: PartyRow) => a.received - b.received,
      render: (v: number) => <b>{num(v)}</b> },
    // الصرف بيظهر لو حد صرف له مباشرة — ودي حالة نادرة بس موجودة.
    { title: 'اتصرف له', dataIndex: 'issued', key: 'issued', width: 100,
      sorter: (a: PartyRow, b: PartyRow) => a.issued - b.issued,
      render: (v: number) => (v ? num(v) : '-') },
    { title: 'آخر استلام', dataIndex: 'last_receipt', key: 'last_receipt', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const distColumns = [
    { title: 'الموزع / التاجر', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (v: string, r: PartyRow) => (
        <a onClick={() => openCard(r.customer_id)}>{v}</a>) },
    { title: 'الهاتف', dataIndex: 'phone', key: 'phone', width: 130,
      render: (v: string | null) => v || '-' },
    { title: 'اتصرف له', dataIndex: 'issued', key: 'issued', width: 110,
      sorter: (a: PartyRow, b: PartyRow) => a.issued - b.issued,
      render: (v: number) => num(v) },
    { title: 'رجع', dataIndex: 'returned', key: 'returned', width: 100,
      sorter: (a: PartyRow, b: PartyRow) => a.returned - b.returned,
      render: (v: number) => num(v) },
    { title: 'لسه برّه', dataIndex: 'outstanding', key: 'outstanding', width: 110,
      sorter: (a: PartyRow, b: PartyRow) => a.outstanding - b.outstanding,
      render: (v: number) => (
        <Tag color={v > 0 ? 'orange' : 'green'}>{num(v)}</Tag>) },
    { title: 'آخر صرف', dataIndex: 'last_issue', key: 'last_issue', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const techColumns = [
    { title: 'الفني', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (v: string, r: TechRow) => (
        r.customer_id ? <a onClick={() => openCard(r.customer_id)}>{v}</a> : v) },
    { title: 'معاينات', dataIndex: 'visits', key: 'visits', width: 110,
      sorter: (a: TechRow, b: TechRow) => a.visits - b.visits,
      render: (v: number) => <b>{num(v)}</b> },
    { title: 'النقاط', dataIndex: 'points', key: 'points', width: 130,
      sorter: (a: TechRow, b: TechRow) => Number(a.points) - Number(b.points),
      render: (v: string) => pts(v) },
    { title: 'آخر معاينة', dataIndex: 'last_visit', key: 'last_visit', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const repColumns = [
    { title: 'المندوب', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'معاينات', dataIndex: 'visits', key: 'visits', width: 110,
      sorter: (a: RepRow, b: RepRow) => a.visits - b.visits,
      render: (v: number) => <b>{num(v)}</b> },
    { title: 'عملاء', dataIndex: 'customers', key: 'customers', width: 110,
      sorter: (a: RepRow, b: RepRow) => a.customers - b.customers,
      render: (v: number) => num(v) },
    { title: 'النقاط', dataIndex: 'points', key: 'points', width: 130,
      sorter: (a: RepRow, b: RepRow) => Number(a.points) - Number(b.points),
      render: (v: string) => pts(v) },
    { title: 'آخر معاينة', dataIndex: 'last_visit', key: 'last_visit', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const plumberCols = useTableColumns('as-coupons-plumbers', plumberColumns as any, {
    export: { name: 'كوبونات السباكين', rows: plumberFilter.filtered },
  });
  const distCols = useTableColumns('as-coupons-distributors', distColumns as any, {
    export: { name: 'كوبونات الموزعين', rows: distFilter.filtered },
  });
  const techCols = useTableColumns('as-visits-technicians', techColumns as any, {
    export: { name: 'الزيارات بنقاط الفني', rows: techFilter.filtered },
  });
  const repCols = useTableColumns('as-visits-reps', repColumns as any, {
    export: { name: 'زيارات المناديب', rows: repFilter.filtered },
  });

  const totals = useMemo(() => ({
    returnedByPlumbers: plumbers.reduce((s, r) => s + r.received, 0),
    issued: distributors.reduce((s, r) => s + r.issued, 0),
    outstanding: distributors.reduce((s, r) => s + r.outstanding, 0),
    visits: reps.reduce((s, r) => s + r.visits, 0),
    points: reps.reduce((s, r) => s + Number(r.points || 0), 0),
  }), [plumbers, distributors, reps]);

  const stats = (
    <Space size={24} wrap style={{ marginBottom: 12 }}>
      <Statistic title="اتصرف للموزعين" value={num(totals.issued)} />
      <Statistic title="رجع من السباكين" value={num(totals.returnedByPlumbers)} />
      <Statistic title="لسه برّه" value={num(totals.outstanding)}
        valueStyle={{ color: totals.outstanding > 0 ? '#d46b08' : '#389e0d' }} />
      <Statistic title="معاينات" value={num(totals.visits)} />
      <Statistic title="نقاط المعاينات" value={pts(totals.points)} />
    </Space>
  );

  const period = <DateRangeFilter value={range} onChange={setRange} size="small" />;

  // `name` غير `label`: عنوان التبويب جوّاه العدد بين قوسين، وده مايصلحش اسم ملف.
  const tab = (
    key: string, label: string, name: string, rows: any[], filter: any, cols: any, hint: string,
  ) => ({
    key,
    label,
    children: (
      <div>
        <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>{hint}</div>
        <ListToolbar
          searchPlaceholder="بحث بالاسم"
          query={filter.query} onQueryChange={filter.setQuery} onReset={filter.reset}
          total={rows.length} shown={filter.filtered.length} searchSpan={10}
          extra={(
            <ExportExcelButton name={name} rows={filter.filtered} tableColumns={cols.columns} style={{ marginInlineStart: 0 }} />
          )}
        />
        <Table
          rowKey={(r: any) => String(r.customer_id ?? r.rep_user_id ?? r.name)}
          size="small" loading={loading} dataSource={filter.filtered}
          columns={cols.columns} tableLayout="fixed"
          pagination={{ defaultPageSize: 25, showSizeChanger: true }}
          locale={{ emptyText: 'لا توجد بيانات في الفترة دي' }}
        />
      </div>
    ),
  });

  return (
    <Card
      title="تقارير ما بعد البيع"
      extra={<Space>{period}</Space>}
    >
      {stats}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          tab('plumbers', `كوبونات السباكين (${plumbers.length})`, 'كوبونات السباكين',
            plumbers, plumberFilter,
            plumberCols, 'كل فني رجّع كام ورقة. الورقة بتتصرف للموزع وبترجع من الفني، '
            + 'فالمتبقّي بيتحسب على الموزع مش عليه.'),
          tab('distributors', `كوبونات الموزعين (${distributors.length})`, 'كوبونات الموزعين',
            distributors, distFilter,
            distCols, 'اتصرف له كام، رجع من الصرف ده كام، والفرق لسه برّه.'),
          tab('technicians', `الزيارات بنقاط الفني (${techs.length})`, 'الزيارات بنقاط الفني',
            techs, techFilter,
            techCols, 'كل فني عمل كام معاينة وجمّع كام نقطة.'),
          tab('reps', `زيارات المناديب (${reps.length})`, 'زيارات المناديب',
            reps, repFilter,
            repCols, 'كل مندوب نزل كام معاينة وعند كام عميل.'),
        ]}
      />
    </Card>
  );
}
