import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { Alert, Button, Input, Select, Table, Tag, message } from 'antd';
import {
  DownloadOutlined, IdcardOutlined, PrinterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useTableKeyboard } from '../components/keyboard';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn, type PrintTotal } from '../print/reportSheet';

import { money, numeralsLocale } from '../utils/money';
import ListPage from '../components/ListPage';

/**
 * ذمم الموظفين — «سلفت مين وكام، ولسه عليه كام».
 *
 * **الرصيد بيتقرا من الدفتر، مش متخزّن على الموظف.** كل حركة بتترحّل على حساب ذمته
 * بتبان هنا في نفس اللحظة، فمافيش رقمين لنفس الذمة يفضلوا يفرقوا مع الوقت. المخزّن
 * على الموظف هو **مين حسابه** (`receivable_account_id`) وبس.
 *
 * **الفرق بين الشاشة دي وشاشة «سلف العاملين»:** السلفة مستند بجدول أقساط بيتخصم من
 * المرتب. الذمة أوسع — أي حاجة الموظف أخدها ولسه عليه: سلفة، عهدة سيارة، بضاعة
 * خدها المندوب، فلوس حصّلها ولسه ماورّدهاش. الاتنين بيقعدوا في نفس الحساب في a5،
 * وده الحساب اللي الشاشة بتقراه.
 *
 * **والحسابات اللي مالهاش موظف بتبان برضه.** «عهدة سيارة الفيوم» و«فرع اكتوبر»
 * دلاء محاسبية عليها فلوس فعلاً — إخفاؤها كان هيخلّي مجموع الشاشة أقل من مجموع
 * «ذمم الموظفين» في ميزان المراجعة، ورقمين مختلفين لنفس الحاجة أسوأ من صف ناقص اسم.
 */

interface Row {
  employee_id: number | null;
  employee_code: string | null;
  employee_name: string | null;
  job_title: string | null;
  department: string | null;
  branch_id: number | null;
  active: boolean | null;
  account_id: number;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  balance: string;
  lines: number;
}

interface Payload {
  rows: Row[];
  total_debit: string;
  total_credit: string;
  total_balance: string;
  unlinked_employees: number;
}

export default function EmployeeReceivables() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState<number | undefined>();
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  // «الكل» بيوري الحسابات الصفرية كمان — الموظف اللي خلّص ذمته له سطر بصفر، وده
  // جواب مختلف عن «مش في الكشف».
  const [scope, setScope] = useState<'nonzero' | 'all'>('nonzero');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/employee-receivables', {
        params: {
          q: q || undefined,
          branch_id: branchId,
          only_nonzero: scope === 'nonzero',
          include_orphans: true,
        },
      });
      setData(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message ?? 'تعذّر تحميل ذمم الموظفين');
    } finally {
      setLoading(false);
    }
  }, [q, branchId, scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data)).catch(() => {});
  }, []);

  const rows = data?.rows ?? [];
  const branchName = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);

  const columns: ColumnsType<Row> = [
    {
      title: 'الموظف',
      dataIndex: 'employee_name',
      key: 'employee_name',
      width: 220,
      ellipsis: true,
      sorter: (a, b) => (a.employee_name ?? '').localeCompare(b.employee_name ?? ''),
      render: (v: string | null, r) => (v ? (
        <span>
          {v}
          {r.active === false ? <Tag style={{ marginInlineStart: 6 }}>معطّل</Tag> : null}
        </span>
      ) : (
        // الحساب اللي مالوش موظف — بيتقال إنه كده صراحةً بدل شرطة بتوحي إن فيه ناقص.
        <Tag color="default">حساب بلا موظف</Tag>
      )),
    },
    { title: 'كود الموظف', dataIndex: 'employee_code', key: 'employee_code', width: 120,
      render: (v: string | null) => v ?? '—' },
    { title: 'الوظيفة', dataIndex: 'job_title', key: 'job_title', width: 130, ellipsis: true,
      render: (v: string | null) => v ?? '—' },
    { title: 'القسم', dataIndex: 'department', key: 'department', width: 130, ellipsis: true,
      render: (v: string | null) => v ?? '—' },
    { title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', width: 100,
      render: (v: number | null) => (v ? branchName[v] ?? `#${v}` : '—') },
    { title: 'الحساب', dataIndex: 'account_name', key: 'account_name', width: 200, ellipsis: true },
    { title: 'كود الحساب', dataIndex: 'account_code', key: 'account_code', width: 130 },
    { title: 'مدين', dataIndex: 'debit', key: 'debit', width: 130, align: 'left',
      sorter: (a, b) => Number(a.debit) - Number(b.debit), render: money },
    { title: 'دائن', dataIndex: 'credit', key: 'credit', width: 130, align: 'left',
      sorter: (a, b) => Number(a.credit) - Number(b.credit), render: money },
    {
      title: 'الرصيد',
      dataIndex: 'balance',
      key: 'balance',
      width: 140,
      align: 'left',
      defaultSortOrder: 'descend',
      sorter: (a, b) => Math.abs(Number(a.balance)) - Math.abs(Number(b.balance)),
      // الرصيد السالب معناه إن الشركة هي اللي عليها للراجل مش العكس — لون مختلف
      // لأن الإشارة لوحدها بتتقرا غلط في عمود مليان أرقام.
      render: (v: string) => (
        <b style={{ color: Number(v) < 0 ? '#cf1322' : undefined }}>{money(v)}</b>
      ),
    },
    { title: 'حركات', dataIndex: 'lines', key: 'lines', width: 90, align: 'left' },
  ];

  const csvCols: CsvColumn<Row>[] = [
    { title: 'الموظف', value: (r) => r.employee_name ?? '(حساب بلا موظف)' },
    { title: 'كود الموظف', value: (r) => r.employee_code ?? '' },
    { title: 'الوظيفة', value: (r) => r.job_title ?? '' },
    { title: 'القسم', value: (r) => r.department ?? '' },
    { title: 'الفرع', value: (r) => (r.branch_id ? branchName[r.branch_id] ?? '' : '') },
    { title: 'الحساب', value: (r) => r.account_name },
    { title: 'كود الحساب', value: (r) => r.account_code },
    { title: 'مدين', value: (r) => r.debit },
    { title: 'دائن', value: (r) => r.credit },
    { title: 'الرصيد', value: (r) => r.balance },
  ];

  const printIt = () => {
    const cols: PrintColumn<Row>[] = [
      { title: 'الموظف', value: (r) => r.employee_name ?? '(حساب بلا موظف)' },
      { title: 'الوظيفة', value: (r) => r.job_title ?? '' },
      { title: 'الحساب', value: (r) => `${r.account_name} (${r.account_code})` },
      { title: 'مدين', value: (r) => money(r.debit), numeric: true },
      { title: 'دائن', value: (r) => money(r.credit), numeric: true },
      { title: 'الرصيد', value: (r) => money(r.balance), numeric: true },
    ];
    const totals: PrintTotal[] = [
      { label: 'إجمالي المدين', value: money(data?.total_debit) },
      { label: 'إجمالي الدائن', value: money(data?.total_credit) },
      { label: 'صافي الذمم', value: money(data?.total_balance) },
    ];
    printReport(
      {
        title: 'ذمم الموظفين',
        date: new Date().toLocaleDateString('en-CA'),
        meta: [
          ['الفرع', branchId ? branchName[branchId] ?? '—' : 'كل الفروع'],
          ['النطاق', scope === 'nonzero' ? 'اللي عليهم رصيد' : 'كل الحسابات'],
        ],
      },
      cols, rows, totals,
    );
  };

  const kb = useTableKeyboard<Row>({ rows, rowKey: (r) => String(r.account_id) });
  const tableCols = useTableColumns('employee-receivables', columns,
    { export: { name: 'ذمم الموظفين', rows } });

  const netBalance = Number(data?.total_balance ?? 0);

  return (
    <ListPage<'nonzero' | 'all'>
      icon={<IdcardOutlined />}
      title="ذمم الموظفين"
      subtitle="اللي على كل موظف من الدفتر — سلف، عهد، بضاعة، وفلوس محصّلة لسه ماتورّدتش"
      // «الكل» بيوري الحسابات الصفرية كمان.
      tabs={[
        { key: 'nonzero', label: 'اللي عليهم رصيد' },
        { key: 'all', label: 'كل الحسابات' },
      ]}
      activeTab={scope} onTabChange={setScope}
      actions={(<>
        <Button icon={<PrinterOutlined />} onClick={printIt}>طباعة</Button>
        <Button icon={<DownloadOutlined />}
          onClick={() => writeCsv('employee-receivables', csvCols, rows)}>تصدير CSV</Button>
        {tableCols.control}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={(<>
        <Input.Search className="sl-f-search" allowClear placeholder="بحث بالاسم أو الكود"
          onSearch={setQ} onChange={(e) => { if (!e.target.value) setQ(''); }} />
        <Select className="sl-f-customer" allowClear placeholder="كل الفروع"
          value={branchId} onChange={setBranchId}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} />
      </>)}
    >
      {data && data.unlinked_employees > 0 ? (
        <Alert
          type="info" showIcon style={{ margin: '6px 0 8px' }}
          message={`${data.unlinked_employees} موظف نشط مالوش حساب ذمة في شجرة a5`}
          description={
            'دول مش «رصيدهم صفر» — دول مالهمش حساب أصلاً، يعني الشاشة مش بتعرف عنهم حاجة. '
            + 'لو واحد فيهم بياخد سلف، لازم يتعمله حساب تحت «ذمم الموظفين» ويتربط '
            + 'بـ`link_employee_receivables`.'
          }
        />
      ) : null}

      <Table<Row>
        className="sl-table"
        rowKey={(r) => String(r.account_id)}
        columns={tableCols.columns}
        dataSource={rows}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{
          pageSize: PAGE_SIZE, showSizeChanger: true,
          // الإجماليات من السيرفر — كانت كروت فوق الجدول وسطر ملخّص تحته.
          showTotal: (t) => (
            <span className="sl-foot">
              <span>عدد الذمم: <b>{t.toLocaleString(numeralsLocale())}</b></span>
              <span>مدين: <b>{money(data?.total_debit)}</b></span>
              <span>دائن: <b>{money(data?.total_credit)}</b></span>
              <span>صافي الذمم: <b className={netBalance < 0 ? 'is-neg' : 'is-pos'}>
                {money(data?.total_balance)}</b></span>
            </span>
          ),
        }}
        {...kb.tableProps}
      />
    </ListPage>
  );
}
