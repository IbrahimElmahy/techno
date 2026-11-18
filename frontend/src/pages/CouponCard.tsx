import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, Table, Tag, message } from 'antd';
import { IdcardOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { withReturn } from '../components/docReturn';
import { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import ExportExcelButton from '../components/ExportExcelButton';
import { useTableColumns } from '../components/ColumnSettings';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { numeralsLocale } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';

interface Row {
  key: string;
  source: 'issue' | 'invoice' | 'receipt';
  type: string;
  doc_id: number;
  doc: string | null;
  date: string | null;
  party_id: number | null;
  party: string | null;
  party_type: string | null;
  rep_id: number | null;
  rep: string | null;
  kind: string | null;
  value: string | null;
  issued: number;
  received: number;
  serial_from: string | null;
  serial_to: string | null;
  ranges: string;
  balance: number;
}

interface CardData {
  rows: Row[];
  opening: number;
  totals: { issued: number; received: number; closing: number };
  kinds: string[];
}

interface Option { value: number; label: string }

const num = (v: number | null | undefined) => Number(v || 0).toLocaleString(numeralsLocale());

const SOURCE_COLOR: Record<string, string> = { issue: 'gold', invoice: 'blue', receipt: 'green' };

const CouponCard: React.FC = () => {
  const navigate = useNavigate();
  const here = useLocation();
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [partyId, setPartyId] = useState<number | undefined>(undefined);
  const [repId, setRepId] = useState<number | undefined>(undefined);
  const [parties, setParties] = useState<Option[]>([]);
  const [reps, setReps] = useState<Option[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.get('/api/v1/users').then((r) => {
      setReps(sortByName(((r.data || []) as any[]).map((u) => ({
        value: u.id, label: u.full_name || u.username,
      })), (o: Option) => o.label));
    }).catch(() => undefined);
  }, []);

  const searchParties = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (q.trim().length < 2) return;
      try {
        const r = await api.get('/api/v1/customers/options', { params: { q: q.trim(), limit: 30 } });
        setParties(((r.data || []) as any[]).map((c) => ({ value: c.id, label: c.name })));
      } catch {
        setParties([]);
      }
    }, 300);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (kind) params.kind = kind;
      if (range?.[0]) params.date_from = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.date_to = range[1].format('YYYY-MM-DD');
      if (partyId) params.party_id = String(partyId);
      if (repId) params.rep_id = String(repId);
      const r = await api.get<CardData>('/api/v1/after-sales-reports/coupon-card', { params });
      setData(r.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل كارت الكوبونات');
    } finally {
      setLoading(false);
    }
  }, [kind, range, partyId, repId]);

  useEffect(() => { load(); }, [load]);

  const openDoc = (r: Row) => navigate(withReturn(`/invoices?doc=${r.doc_id}`, here.pathname + here.search));

  const columns = [
    { title: 'التاريخ', dataIndex: 'date', key: 'date', width: 110 },
    { title: 'نوع الحركة', dataIndex: 'type', key: 'type', width: 130,
      render: (v: string, r: Row) => <Tag color={SOURCE_COLOR[r.source]}>{v}</Tag> },
    { title: 'رقم المستند', dataIndex: 'doc', key: 'doc', width: 140,
      render: (v: string, r: Row) => (r.source === 'invoice'
        ? <a onClick={() => openDoc(r)}>{v}</a> : v) },
    { title: 'الجهة', dataIndex: 'party', key: 'party', width: 200,
      render: (v: string | null, r: Row) => (r.party_id
        ? <a onClick={() => navigate(withReturn(`/customers/${r.party_id}`, here.pathname + here.search))}>{v}</a> : (v || '-')) },
    { title: 'المندوب', dataIndex: 'rep', key: 'rep', width: 150, render: (v: string | null) => v || '-' },
    { title: 'الفئة', dataIndex: 'kind', key: 'kind', width: 90, render: (v: string | null) => v || '-' },
    { title: 'مصروف', dataIndex: 'issued', key: 'issued', width: 90, align: 'center' as const,
      render: (v: number) => (v ? <b>{num(v)}</b> : '-') },
    { title: 'مستلم', dataIndex: 'received', key: 'received', width: 90, align: 'center' as const,
      render: (v: number) => (v ? <b style={{ color: '#2f7d32' }}>{num(v)}</b> : '-') },
    { title: 'من', dataIndex: 'serial_from', key: 'serial_from', width: 100, render: (v: string | null) => v || '-' },
    { title: 'إلى', dataIndex: 'serial_to', key: 'serial_to', width: 100, render: (v: string | null) => v || '-' },
    { title: 'الأرقام', dataIndex: 'ranges', key: 'ranges', ellipsis: true,
      render: (v: string) => <span dir="ltr">{v || '-'}</span> },
    { title: 'القيمة', dataIndex: 'value', key: 'value', width: 90, render: (v: string | null) => v || '-' },
    { title: 'الرصيد', dataIndex: 'balance', key: 'balance', width: 100, align: 'center' as const,
      render: (v: number) => <b>{num(v)}</b> },
  ];
  const cols = useTableColumns('coupon-card', columns as any);
  const rows = useMemo(() => (data?.rows ?? []).slice().reverse(), [data]);

  return (
    <ListPage
      icon={<IdcardOutlined />}
      title="كارت الكوبونات"
      actions={(<>
        {cols.control}
        <ExportExcelButton name="كارت الكوبونات" rows={rows} tableColumns={cols.columns as any}
          style={{ marginInlineStart: 0 }} />
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={(<>
        <Select allowClear showSearch placeholder="فئة الكوبون" style={{ minWidth: 140 }}
          value={kind} onChange={setKind}
          options={(data?.kinds ?? []).map((k) => ({ value: k, label: k }))} />
        <DateRangeFilter value={range as any} onChange={(v: any) => setRange(v)} />
        <Select allowClear showSearch placeholder="التاجر / السباك" style={{ minWidth: 200 }}
          filterOption={false} onSearch={searchParties} options={parties}
          value={partyId} onChange={setPartyId} />
        <Select allowClear showSearch placeholder="المندوب" style={{ minWidth: 180 }}
          value={repId} onChange={setRepId} options={reps}
          filterOption={searchFilter} filterSort={searchRank} />
      </>)}
      summary={data && (<>
        <ListStat label="رصيد أول المدة" value={num(data.opening)} />
        <ListStat label="مصروف" value={num(data.totals.issued)} tone="strong" />
        <ListStat label="مستلم" value={num(data.totals.received)} tone="pos" />
        <ListStat label="الرصيد (لم يُستلم بعد)" value={num(data.totals.closing)} tone="info" />
      </>)}
    >
      <Table<Row>
        className="sl-table" size="small" loading={loading}
        rowKey="key" dataSource={rows} columns={cols.columns as any}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 1400 }}
      />
    </ListPage>
  );
};

export default CouponCard;
