/**
 * جزء من شاشة الأستاذ العام — اتفصل عن `GeneralLedger.tsx` لما الملف وصل ١٤٠٠ سطر
 * وخمس تبويبات. الشاشة والمسار زي ما هما بالظبط؛ اللي اتغيّر هو إن كل تبويب بقى
 * ملف لوحده، فالتعديل في «الدفاتر» مابيفتحش «ميزان المراجعة» قدامك.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tooltip, message, Radio,
} from 'antd';
import { InputNumber } from '../../components/NumberInput';
import {
  PlusOutlined, RollbackOutlined, BookOutlined, FileAddOutlined, BankOutlined,
  ReloadOutlined, SearchOutlined, DownloadOutlined, PrinterOutlined,
  ProfileOutlined, CheckCircleOutlined, EditOutlined, StopOutlined, LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import CostCenterSplit from '../../components/CostCenterSplit';
import { api } from '../../api/client';
import { useQueryTab } from '../../components/useQueryTab';
import {
  APPEARS_IN_LABEL, CostCenter, MAIN_LEVELS, NATURE_COLOR, NATURE_LABEL, egp,
} from '../../utils/accounts';
import { showReversalConfirm } from '../../components/ConfirmationDialog';
import ListToolbar, { useListFilter, normalizeAr } from '../../components/ListToolbar';
import { useTableKeyboard } from '../../components/keyboard';
import { textColumn, numberColumn, choiceColumn, dateColumn } from '../../components/gridColumns';
import { entryTypeLabel } from '../../components/labels';
import PartyField from '../../components/PartyField';
import { TabModal } from '../../components/TabModal';
import { useTableColumns } from '../../components/ColumnSettings';
import { exportCsv } from '../../utils/exportCsv';
import DateRangeFilter from '../../components/DateRangeFilter';
import { printReport } from '../../print/reportSheet';
import { Account, JournalEntry, flatten } from './types';

export default function ChartTab() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<Account[]>([]);
  const [groups, setGroups] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [form] = Form.useForm();
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  const flatAccounts = useMemo(() => tree.flatMap(flatten), [tree]);

  const filter = useListFilter(tree, {
    search: (a) => flatten(a).flatMap((n) => [n.code, n.name]),
    filters: {
      nature: (a, v) => flatten(a).some((n) => n.nature === v),
      appears_in: (a, v) => flatten(a).some((n) => n.appears_in === v),
      is_postable: (a, v) => flatten(a).some((n) => n.is_postable === (v === 'postable')),
      active: (a, v) => flatten(a).some((n) => n.active === (v === 'active')),
    },
  });

  useEffect(() => {
    setExpandedKeys(tree.filter((a) => !a.parent_id).map((a) => a.id));
  }, [tree]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/accounts?tree=true');
      setTree(res.data);
      const flat = await api.get('/api/v1/accounts');
      setGroups(flat.data.filter((a: Account) => !a.is_postable));
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onCreate = async (v: any) => {
    try {
      await api.post('/api/v1/accounts', {
        code: v.code, name: v.name, parent_id: v.parent_id ?? null,
        nature: v.nature, is_postable: v.is_postable,
        appears_in: v.appears_in ?? null,
        main_level: (Array.isArray(v.main_level) ? v.main_level[0] : v.main_level) || null,
      });
      message.success('تم إنشاء الحساب');
      setDrawer(false); form.resetFields(); load();
    } catch (err) { console.error(err); }
  };

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 160,
      ...textColumn(flatAccounts, (a: Account) => a.code),
      render: (c: string) => <Tag color="blue">{c}</Tag> },
    { title: 'اسم الحساب', dataIndex: 'name', key: 'name',
      ...textColumn(flatAccounts, (a: Account) => a.name) },
    { title: 'النوع', dataIndex: 'nature', key: 'nature', width: 120,
      ...textColumn(flatAccounts, (a: Account) => (a.nature ? NATURE_LABEL[a.nature] : '')),
      render: (n: string) => n ? <Tag color={NATURE_COLOR[n]}>{NATURE_LABEL[n]}</Tag> : '-' },
    { title: 'التصنيف', dataIndex: 'is_postable', key: 'is_postable', width: 120,
      ...choiceColumn<Account>([{ text: 'يقبل الترحيل', value: 'yes' }, { text: 'تجميعي', value: 'no' }],
        (a, v) => (v === 'yes' ? !!a.is_postable : !a.is_postable)),
      render: (p: boolean, r: Account) =>
        p ? <Tag color="green">قابل للترحيل</Tag> : <Tag>مجموعة</Tag> },
    { title: 'المستوى الرئيسي', dataIndex: 'main_level', key: 'main_level', width: 170,
      ...textColumn(flatAccounts, (a: any) => a.main_level),
      render: (m: string | null) => m || '-' },
    { title: 'يظهر في', dataIndex: 'appears_in', key: 'appears_in', width: 140,
      ...textColumn(flatAccounts, (a: any) => (a.appears_in ? APPEARS_IN_LABEL[a.appears_in] : '')),
      render: (a: string | null) => (a && APPEARS_IN_LABEL[a]
        ? <Tag color="geekblue">{APPEARS_IN_LABEL[a]}</Tag>
        : <span style={{ color: '#8c8c8c' }}>حسب الطبيعة</span>) },
    { title: 'النظام', dataIndex: 'is_system', key: 'is_system', width: 90,
      ...choiceColumn<Account>([{ text: 'نظام', value: 'yes' }, { text: 'مضاف', value: 'no' }],
        (a: any, v) => (v === 'yes' ? !!a.is_system : !a.is_system)),
      render: (s: boolean) => s ? <Tag color="purple">نظام</Tag> : '-' },
    { title: 'الرصيد (ج.م)', dataIndex: 'balance', key: 'balance', align: 'left' as const,
      ...numberColumn<Account>((a: any) => a.balance),
      render: (b: string) => <strong>{egp(b)}</strong> },
  ];

  // الجدول شجرة، فـ`filter.filtered` فيه الجذور بس والفروع جوّاها — الملف لازم ينزل كل الحسابات
  // اللي الفلتر سابها زي ما الـCSV بينزّلها.
  const chartTabCols = useTableColumns('gl-chart', columns, {
    export: { name: 'دليل الحسابات', rows: filter.filtered.flatMap(flatten) },
  });

  const chartKb = useTableKeyboard<any>({
    rows: filter.filtered, rowKey: (a) => a.id,
    onOpen: (a) => navigate(`/account-statement?account=${a.id}`),
  });

  const chartReportCols = [
    { title: 'الكود', value: (a: Account) => a.code },
    { title: 'اسم الحساب', value: (a: Account) => a.name },
    { title: 'النوع', value: (a: Account) => (a.nature ? NATURE_LABEL[a.nature] : '') },
    { title: 'التصنيف', value: (a: Account) => (a.is_postable ? 'قابل للترحيل' : 'مجموعة') },
    { title: 'المستوى الرئيسي', value: (a: Account) => a.main_level ?? '' },
    { title: 'يظهر في', value: (a: Account) => (a.appears_in && APPEARS_IN_LABEL[a.appears_in]) || '' },
    { title: 'النظام', value: (a: Account) => (a.is_system ? 'نظام' : '') },
    { title: 'الرصيد (ج.م)', value: (a: Account) => a.balance, numeric: true },
  ];
  const shownAccounts = () => filter.filtered.flatMap(flatten);
  const exportChart = () => {
    const rows = shownAccounts();
    if (!rows.length) { message.info('لا توجد بيانات للتصدير'); return; }
    exportCsv('chart-of-accounts', chartReportCols, rows);
  };
  const printChart = () => {
    printReport(
      { title: 'دليل الحسابات', date: dayjs().format('YYYY/MM/DD') },
      chartReportCols, shownAccounts(),
    );
  };

  return (
    <Card
      title="الهيكل الشجري لدليل الحسابات"
      extra={
        <Space>
          <Button icon={<DownloadOutlined />} onClick={exportChart}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />} onClick={printChart}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load} />
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setDrawer(true)}>حساب جديد</Button>
        </Space>
      }
    >
      <ListToolbar
        searchPlaceholder="بحث بكود الحساب أو الاسم"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={tree.length} shown={filter.filtered.length}
        filters={[
          { key: 'nature', placeholder: 'طبيعة الحساب',
            options: Object.entries(NATURE_LABEL).map(([v, l]) => ({ value: v, label: l })) },
          { key: 'is_postable', placeholder: 'التصنيف',
            options: [{ value: 'postable', label: 'قابل للترحيل' }, { value: 'group', label: 'مجموعة' }] },
          { key: 'appears_in', placeholder: 'يظهر في',
            options: Object.entries(APPEARS_IN_LABEL).map(([v, l]) => ({ value: v, label: l })) },
          { key: 'active', placeholder: 'الحالة',
            options: [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'معطّل' }] },
        ]}
      />
      <div style={{ textAlign: 'end', marginBottom: 8 }}>{chartTabCols.control}</div>
      <Table
        {...chartKb.tableProps}
        rowKey="id"
        loading={loading}
        dataSource={filter.filtered}
        columns={chartTabCols.columns}
        pagination={false}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys([...keys]),
          childrenColumnName: 'children',
        }}
      />

      <TabModal footer={null} centered title="إضافة حساب جديد" width={460} open={drawer} onCancel={() => setDrawer(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}
          initialValues={{ is_postable: true, nature: 'expense' }}>
          <Form.Item name="parent_id" label="الحساب الأب (المجموعة)"
            extra="اترك فارغاً لإنشاء حساب جذر">
            <Select allowClear placeholder="اختر المجموعة الأب" showSearch optionFilterProp="label"
              options={groups.map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` }))} />
          </Form.Item>
          <Form.Item name="code" label="كود الحساب (مقطعي)"
            rules={[{ required: true, message: 'أدخل الكود' }]}
            extra="يجب أن يبدأ بكود الأب، مثل 5.10.001">
            <Input placeholder="مثال: 5.10.001" />
          </Form.Item>
          <Form.Item name="name" label="اسم الحساب" rules={[{ required: true, message: 'أدخل الاسم' }]}>
            <Input placeholder="مثال: إيجار" />
          </Form.Item>
          <Form.Item name="nature" label="طبيعة الحساب" rules={[{ required: true }]}>
            <Select options={Object.entries(NATURE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item name="is_postable" label="التصنيف" rules={[{ required: true }]}>
            <Select options={[
              { value: true, label: 'حساب قابل للترحيل (ورقة)' },
              { value: false, label: 'مجموعة (تجميعية فقط)' },
            ]} />
          </Form.Item>
          <Form.Item name="main_level" label="المستوى الرئيسي"
            extra="اختر من القائمة أو اكتب مستوى جديد">
            <Select allowClear showSearch placeholder="مثال: مصروفات غير مباشرة"
              options={MAIN_LEVELS.map((l) => ({ value: l, label: l }))}
              onSearch={() => {}}
              filterOption={(i, o) => normalizeAr(String(o?.label ?? '')).includes(normalizeAr(i))}
              mode="tags" maxCount={1} />
          </Form.Item>
          <Form.Item name="appears_in" label="يظهر في"
            extra="اتركه فارغاً ليتبع طبيعة الحساب تلقائياً">
            <Select allowClear placeholder="حسب الطبيعة"
              options={Object.entries(APPEARS_IN_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>حفظ الحساب</Button>
        </Form>
      </TabModal>
    </Card>
  );
}
