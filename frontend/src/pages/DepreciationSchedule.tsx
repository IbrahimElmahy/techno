import React, { useEffect, useState } from 'react';
import { Button, DatePicker, Select, Table, message } from 'antd';
import { DownloadOutlined, ReloadOutlined, TableOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api/client';
import ListPage from '../components/ListPage';
import { money } from '../utils/money';
import { exportCsv } from '../utils/exportCsv';
import { errMsg } from '../components/fixedAssets/shared';

interface Row {
  id: number | string; code?: string; name?: string; category: string; acquisition_date?: string;
  cost_open: string; cost_add: string; cost_out: string; cost_close: string;
  dep_open: string; dep_add: string; dep_out: string; dep_close: string; book: string;
  children?: Row[];
}

const NUM_KEYS: (keyof Row)[] = ['cost_open', 'cost_add', 'cost_out', 'cost_close',
  'dep_open', 'dep_add', 'dep_out', 'dep_close', 'book'];

const NUM_LABELS: Record<string, string> = {
  cost_open: 'التكلفة أول المدة', cost_add: 'إضافات التكلفة', cost_out: 'استبعادات التكلفة',
  cost_close: 'التكلفة آخر المدة', dep_open: 'المجمع أول المدة', dep_add: 'إهلاك الفترة',
  dep_out: 'استبعادات المجمع', dep_close: 'المجمع آخر المدة', book: 'القيمة الدفترية',
};

export default function DepreciationSchedule() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs().endOf('month')]);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [branches, setBranches] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => {});
    api.get('/api/v1/fixed-assets/categories').then((r) => setCategories(r.data || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/v1/fixed-assets/schedule-report', { params: {
        date_from: range[0].format('YYYY-MM-DD'), date_to: range[1].format('YYYY-MM-DD'),
        branch_id: branchId, category_id: categoryId,
      } });
      setData(r.data);
    } catch (err) { message.error(errMsg(err, 'تعذر تحميل التقرير')); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range[0].valueOf(), range[1].valueOf(), branchId, categoryId]);

  const tree: Row[] = (data?.groups || []).map((g: any) => ({
    ...g, id: `g-${g.category}`, name: g.category,
    children: (data.rows || []).filter((r: any) => r.category === g.category),
  }));

  const num = (key: keyof Row, color?: string) => ({
    dataIndex: key, key, width: 120, align: 'left' as const,
    render: (v: string, r: Row) => {
      const text = Number(v) ? money(v) : '-';
      return r.children ? <b style={{ color }}>{text}</b> : <span style={{ color }}>{text}</span>;
    },
  });

  const columns: ColumnsType<Row> = [
    { title: 'الأصل', key: 'name', fixed: 'right', width: 260,
      render: (_: any, r) => (r.children ? <b>{r.name} ({r.children.length})</b>
        : <span>{r.code} — {r.name}</span>) },
    { title: 'تاريخ الشراء', dataIndex: 'acquisition_date', width: 105, render: (v) => v || '' },
    { title: 'التكلفة', children: [
      { title: 'أول المدة', ...num('cost_open') },
      { title: 'إضافات', ...num('cost_add', '#15803d') },
      { title: 'استبعادات', ...num('cost_out', '#dc2626') },
      { title: 'آخر المدة', ...num('cost_close') },
    ] },
    { title: 'مجمع الإهلاك', children: [
      { title: 'أول المدة', ...num('dep_open') },
      { title: 'إضافات', ...num('dep_add', '#dc2626') },
      { title: 'استبعادات', ...num('dep_out', '#15803d') },
      { title: 'آخر المدة', ...num('dep_close') },
    ] },
    { title: 'القيمة الدفترية', ...num('book', '#0B5CA8') },
  ];

  const doExport = () => exportCsv('depreciation-schedule', [
    { title: 'الفئة', value: (r: any) => r.category },
    { title: 'الكود', value: (r: any) => r.code },
    { title: 'الأصل', value: (r: any) => r.name },
    { title: 'تاريخ الشراء', value: (r: any) => r.acquisition_date },
    ...NUM_KEYS.map((k) => ({ title: NUM_LABELS[k as string], value: (r: any) => r[k] })),
  ], data?.rows || []);

  return (
    <ListPage
      icon={<TableOutlined />}
      title="جدول الإهلاك"
      actions={(<>
        <Button icon={<DownloadOutlined />} onClick={doExport} disabled={!data?.rows?.length}>تصدير</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={(<>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Select allowClear placeholder="الفرع" style={{ minWidth: 140 }} value={branchId} onChange={setBranchId}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        <Select allowClear placeholder="الفئة" style={{ minWidth: 160 }} value={categoryId} onChange={setCategoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      </>)}
    >
      <Table<Row> key={`${data?.date_from}-${data?.date_to}-${data?.rows?.length ?? 0}`}
        className="sl-table" rowKey="id" size="small" bordered loading={loading}
        dataSource={tree} columns={columns} pagination={false} scroll={{ x: 1500 }}
        expandable={{ defaultExpandAllRows: true }}
        locale={{ emptyText: 'لا توجد أصول في هذه الفترة' }}
        summary={() => (data?.rows?.length ? (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row style={{ background: '#f1f5f9', fontWeight: 800 }}>
              <Table.Summary.Cell index={0} colSpan={2}>الإجمالي</Table.Summary.Cell>
              {NUM_KEYS.map((k, i) => (
                <Table.Summary.Cell key={k} index={i + 2} align="left">{money(data.totals[k])}</Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          </Table.Summary>
        ) : null)} />
    </ListPage>
  );
}
