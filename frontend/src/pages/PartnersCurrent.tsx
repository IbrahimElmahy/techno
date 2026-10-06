import React, { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Empty, Space, Switch, Table, Tag, Tooltip } from 'antd';
import { FileSearchOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';

/**
 * «جاري الشركاء» — شاشة «الجاري» بتاعة a5 (٢٠٢٦-١٠-٠٦).
 *
 * حسابات الشركاء (جارى الشركاء وسنواته، رأس المال، استثمار) متنقلة من a5 بأرصدتها، بس
 * ماكانش ليها مكان غير شجرة الحسابات. هنا كل حساب بسطر: مدين ودائن ورصيد، والرصيد بإشارة
 * الشريك — موجب «له»، سالب «عليه». والسطر بيفتح كشف حسابه.
 */
interface Row {
  account_id: number; code: string | null; name: string;
  group_id: number; group_name: string;
  branch_id: number | null; branch_name: string | null;
  debit: string; credit: string; balance: string; lines: number; last_date: string | null;
}

const fmt = (v: string | number) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PartnersCurrent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState<Dayjs | null>(null);
  const [withZero, setWithZero] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/partners-current', {
        params: {
          include_zero: withZero,
          ...(asOf ? { as_of: asOf.format('YYYY-MM-DD') } : {}),
        },
      });
      setRows(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [asOf, withZero]);

  const totals = useMemo(() => {
    let dr = 0; let cr = 0;
    for (const r of rows) { dr += Number(r.debit); cr += Number(r.credit); }
    return { dr, cr, bal: cr - dr };
  }, [rows]);

  // صف مجموع لكل مجموعة (فرع × سنة) — زي a5: الحسابات تحت عنوان مجموعتها.
  const groupTotal = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.branch_id}|${r.group_id}`;
      m.set(k, (m.get(k) || 0) + Number(r.balance));
    }
    return m;
  }, [rows]);

  const columns = [
    {
      title: 'الفرع', dataIndex: 'branch_name', key: 'branch_name', width: 110,
      onCell: (r: Row, i?: number) => {
        const prev = i ? rows[i - 1] : undefined;
        if (prev && prev.branch_id === r.branch_id) return { rowSpan: 0 };
        return { rowSpan: rows.filter((x) => x.branch_id === r.branch_id).length };
      },
      render: (v: string | null) => <b>{v || '—'}</b>,
    },
    {
      title: 'المجموعة', dataIndex: 'group_name', key: 'group_name', width: 230,
      onCell: (r: Row, i?: number) => {
        const prev = i ? rows[i - 1] : undefined;
        if (prev && prev.branch_id === r.branch_id && prev.group_id === r.group_id) return { rowSpan: 0 };
        return { rowSpan: rows.filter((x) => x.branch_id === r.branch_id && x.group_id === r.group_id).length };
      },
      render: (v: string, r: Row) => {
        const t = groupTotal.get(`${r.branch_id}|${r.group_id}`) || 0;
        return (
          <Space direction="vertical" size={0}>
            <span style={{ fontWeight: 600 }}>{v}</span>
            <span style={{ fontSize: 13, color: t < 0 ? '#cf1322' : '#389e0d' }} dir="ltr">{fmt(t)}</span>
          </Space>
        );
      },
    },
    {
      title: 'الحساب', dataIndex: 'name', key: 'name', width: 230,
      render: (v: string, r: Row) => (
        <Space direction="vertical" size={0}>
          <span>{v}</span>
          <span style={{ fontSize: 12, color: '#8c8c8c' }} dir="ltr">{r.code}</span>
        </Space>
      ),
    },
    { title: 'مدين', dataIndex: 'debit', key: 'debit', width: 130, align: 'right' as const,
      render: (v: string) => <span dir="ltr">{fmt(v)}</span> },
    { title: 'دائن', dataIndex: 'credit', key: 'credit', width: 130, align: 'right' as const,
      render: (v: string) => <span dir="ltr">{fmt(v)}</span> },
    {
      title: 'الرصيد', dataIndex: 'balance', key: 'balance', width: 160, align: 'right' as const,
      render: (v: string) => {
        const n = Number(v);
        return (
          <Space size={4}>
            <b dir="ltr" style={{ color: n < 0 ? '#cf1322' : n > 0 ? '#389e0d' : undefined }}>{fmt(Math.abs(n))}</b>
            {n !== 0 && <Tag color={n > 0 ? 'green' : 'red'}>{n > 0 ? 'له' : 'عليه'}</Tag>}
          </Space>
        );
      },
    },
    { title: 'حركات', dataIndex: 'lines', key: 'lines', width: 80, align: 'center' as const },
    { title: 'آخر حركة', dataIndex: 'last_date', key: 'last_date', width: 110,
      render: (v: string | null) => <span dir="ltr">{v || '—'}</span> },
    {
      title: '', key: 'go', width: 60,
      render: (_: any, r: Row) => (
        <Tooltip title="كشف الحساب">
          <Button type="text" size="small" icon={<FileSearchOutlined />}
            onClick={() => navigate(`/account-statement?account=${r.account_id}`)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <ListPage
      icon={<TeamOutlined />}
      title="جاري الشركاء"
      subtitle="حسابات الشركاء ورأس المال والاستثمار في كل فرع — زي شاشة «الجاري» في a5"
      summary={(
        <>
          <ListStat label="إجمالي المدين" value={fmt(totals.dr)} />
          <ListStat label="إجمالي الدائن" value={fmt(totals.cr)} />
          <ListStat label="الصافي" value={fmt(Math.abs(totals.bal))}
            tone={totals.bal < 0 ? 'neg' : 'pos'} hint={totals.bal < 0 ? 'على الشركاء' : 'للشركاء'} />
        </>
      )}
      actions={<Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>}
      filters={(
        <>
          <DatePicker placeholder="الرصيد لحد تاريخ" value={asOf} onChange={setAsOf} format="YYYY/MM/DD" />
          <Space><Switch size="small" checked={withZero} onChange={setWithZero} /> يشمل الحسابات من غير حركة</Space>
        </>
      )}
    >
      <Table<Row>
        className="sl-table"
        rowKey="account_id"
        size="small"
        bordered
        loading={loading}
        dataSource={rows}
        columns={columns as any}
        pagination={false}
        locale={{ emptyText: <Empty description="مافيش حسابات شركاء" /> }}
      />
    </ListPage>
  );
}
