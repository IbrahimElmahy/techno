import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { useNavigate } from 'react-router-dom';
import {
  Table, Select, Button, Tag, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, DownloadOutlined, StarOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { api } from '../api/client';
import DateRangeFilter from '../components/DateRangeFilter';
import { DocRef, type DocKind } from '../components/DocumentLink';
import { useTableColumns } from '../components/ColumnSettings';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import ListPage from '../components/ListPage';
import { useCanSeeStats } from '../components/StatsRow';
import { qty as num } from '../utils/money';
const { Text } = Typography;

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
    api.get('/api/v1/customers/options', { params: { limit: 20000 } }).then((r) => setCustomers(r.data || [])).catch(() => {});
  }, []);

  const filterKey = JSON.stringify([
    customerId ?? null, kinds, range ? range.map((d) => d.format('YYYY-MM-DD')) : null]);
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      if (page !== 1) { setPage(1); return; }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page]);

  const kindOptions = useMemo(
    () => Object.entries(data?.kinds || {}).map(([value, label]) => ({ value, label })),
    [data?.kinds],
  );

  const customerOptions = useMemo(
    () => sortByName(customers, (c) => c.name).map((c) => ({ value: c.id, label: c.name })),
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

  const { columns, control: columnSettings } = useTableColumns('points-ledger', rawColumns, {
    export: { name: 'سجل النقاط', rows: data?.rows || [] },
  });

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

  const canSeeStats = useCanSeeStats();
  const footer = (
    <span className="sl-foot">
      <span>عدد الحركات: <b>{num(total)}</b></span>
      {total > 0 && <span>المعروض: <b>{num(shown)}</b></span>}
      {canSeeStats && (<>
        <span>وارد: <b className="is-pos">{num(data?.earned)}</b></span>
        <span>منصرف: <b className="is-neg">{num(data?.spent)}</b></span>
        <span>الصافي: <b className={net < 0 ? 'is-neg' : 'is-pos'}>{num(data?.net)}</b></span>
      </>)}
    </span>
  );

  return (
    <ListPage
      icon={<StarOutlined />}
      title="سجل النقاط"
      actions={(<>
        {columnSettings}
        <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!shown}>
          تصدير الصفحة
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Select
          className="sl-f-customer"
          allowClear showSearch
          placeholder="كل العملاء"
          value={customerId}
          onChange={setCustomerId}
          options={customerOptions} filterOption={searchFilter} filterSort={searchRank}/>
        <Select
          allowClear mode="multiple"
          placeholder="كل أنواع الحركة"
          value={kinds}
          onChange={setKinds}
          options={kindOptions}
          maxTagCount="responsive"
        />
        <DateRangeFilter className="sl-f-dates" value={range} onChange={setRange} />
      </>)}
    >
      <Table<PointRow>
        className="sl-table"
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
          showTotal: () => footer,
        }}
      />
    </ListPage>
  );
}
