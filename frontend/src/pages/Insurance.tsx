import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Checkbox, Col, DatePicker, Input, Row, Select, Space, Table, Tag, message,
} from 'antd';
import {
  ClearOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import InsurancePanel from '../components/InsurancePanel';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import ListPage, { ListStat } from '../components/ListPage';
import { useListFilter } from '../components/ListToolbar';
import { InputNumber } from '../components/NumberInput';
import { TabModal } from '../components/TabModal';
import { useQueryTab } from '../components/useQueryTab';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { money, numeralsLocale } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';

interface Row {
  employee_id: number; code: string; name: string; active: boolean;
  branch_id: number | null; department: string | null;
  versions: number; amount: string | null; effective_from: string | null;
  upcoming: { amount: string; effective_from: string } | null;
}

interface Remittance {
  id: number; document_number: string; amount: string; remit_date: string;
  branch_id: number | null; treasury_id: number | null; notes: string | null;
  ledger_entry_id: number | null;
}

const n = (v: any) => Number(v || 0);

export default function Insurance() {
  const [tab, setTab] = useQueryTab('employees');
  const [rows, setRows] = useState<Row[]>([]);
  const [remits, setRemits] = useState<Remittance[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [target, setTarget] = useState<Row | null>(null);
  const [remitOpen, setRemitOpen] = useState(false);
  const [remitForm, setRemitForm] = useState<{
    amount?: number; remit_date: Dayjs; treasury_id?: number; notes: string;
  }>({ remit_date: dayjs(), notes: '' });
  const [saving, setSaving] = useState(false);

  const fail = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    message.error(detail?.message || fallback);
  };

  const load = async (inactive = showInactive) => {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([
        api.get('/api/v1/hr/insurance', { params: { include_inactive: inactive } }),
        api.get('/api/v1/hr/insurance/remittances'),
      ]);
      setRows(r.data || []);
      setRemits(m.data || []);
    } catch (err: any) { fail(err, 'تعذر تحميل التأمينات'); } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => {});
    api.get('/api/v1/treasuries').then((r) => setTreasuries(r.data || [])).catch(() => {});
  }, []);

  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '';
  const treasuryName = (id: number | null) => treasuries.find((t) => t.id === id)?.name || '';

  const filter = useListFilter(rows, {
    search: (r) => [r.code, r.name, r.department],
    filters: {
      insured: (r, v) => (v === 'yes' ? n(r.amount) > 0 : n(r.amount) === 0),
      branch_id: (r, v) => r.branch_id === v,
    },
  });
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const saveRemit = async () => {
    if (!remitForm.amount) { message.warning('أدخل المبلغ'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/insurance/remittances', {
        amount: String(remitForm.amount), remit_date: remitForm.remit_date.format('YYYY-MM-DD'),
        treasury_id: remitForm.treasury_id ?? null, notes: remitForm.notes || null,
      });
      message.success('تم تسجيل السداد');
      setRemitOpen(false);
      setRemitForm({ remit_date: dayjs(), notes: '' });
      load();
    } catch (err: any) { fail(err, 'تعذر التسجيل'); } finally { setSaving(false); }
  };

  const columns: ColumnsType<Row> = [
    { title: 'رقم', dataIndex: 'code', key: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الموظف', dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <Space size={4}>
          <a onClick={() => setTarget(r)}><b>{v}</b></a>
          {!r.active ? <Tag>موقوف</Tag> : null}
        </Space>
      ) },
    { title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', render: (v: number | null) => branchName(v) },
    { title: 'القسم', dataIndex: 'department', key: 'department', render: (v: string | null) => v || '' },
    { title: 'المبلغ الشهري', dataIndex: 'amount', key: 'amount', align: 'left',
      render: (v: string | null) => (v !== null ? <b>{money(v)}</b> : '—') },
    { title: 'ساري من', dataIndex: 'effective_from', key: 'effective_from', width: 120,
      render: (v: string | null, r) => (
        <Space size={2} direction="vertical">
          <span>{v ?? '—'}</span>
          {r.upcoming ? (
            <Tag color="blue">{money(r.upcoming.amount)} من {r.upcoming.effective_from}</Tag>
          ) : null}
        </Space>
      ) },
    { title: 'تغييرات', dataIndex: 'versions', key: 'versions', width: 90 },
    { title: '', key: 'x', width: 60,
      render: (_: any, r) => (
        <Button type="text" icon={<SafetyOutlined />} title="السجل والتعديل"
          onClick={() => setTarget(r)} />
      ) },
  ];

  const cols = useTableColumns('insurance', columns as any, {
    locked: ['name'],
    export: {
      name: 'التأمينات',
      rows: filter.filtered.map((r) => ({
        code: r.code, name: r.name, branch_id: branchName(r.branch_id),
        department: r.department, amount: r.amount ?? '', effective_from: r.effective_from ?? '',
        versions: r.versions,
      })),
    },
  });

  const kb = useTableKeyboard<Row>({
    rows: filter.filtered, rowKey: (r) => r.employee_id, onOpen: (r) => setTarget(r),
  });

  const remitColumns: ColumnsType<Remittance> = [
    { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number', width: 130 },
    { title: 'التاريخ', dataIndex: 'remit_date', key: 'remit_date', width: 120 },
    { title: 'المبلغ', dataIndex: 'amount', key: 'amount', align: 'left',
      render: (v: string) => <b>{money(v)}</b> },
    { title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', render: (v: number | null) => branchName(v) },
    { title: 'الخزنة', dataIndex: 'treasury_id', key: 'treasury_id',
      render: (v: number | null) => treasuryName(v) },
    { title: 'ملاحظات', dataIndex: 'notes', key: 'notes', render: (v: string | null) => v || '' },
  ];

  const shown = filter.filtered;
  const insured = shown.filter((r) => n(r.amount) > 0);
  const monthly = insured.reduce((t, r) => t + n(r.amount), 0);
  const remitted = remits.reduce((t, r) => t + n(r.amount), 0);
  const fmt = (v: number) => v.toLocaleString(numeralsLocale());

  return (
    <>
      <ListPage
        icon={<SafetyOutlined />}
        title="التأمينات"
        tabs={[
          { key: 'employees', label: 'تأمينات الموظفين', count: insured.length },
          { key: 'remittances', label: 'سداد التأمينات', count: remits.length },
        ]}
        activeTab={tab as any}
        onTabChange={(k) => setTab(k)}
        actions={(<>
          {tab === 'employees' ? (<>
            <Checkbox checked={showInactive}
              onChange={(e) => { setShowInactive(e.target.checked); load(e.target.checked); }}>
              إظهار الموقوفين
            </Checkbox>
            {cols.control}
          </>) : (
            <Button type="primary" className="sl-create" icon={<PlusOutlined />}
              onClick={() => setRemitOpen(true)}>سداد جديد</Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        </>)}
        filters={tab === 'employees' ? (<>
          <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
            placeholder="بحث بالكود أو الاسم أو القسم" prefix={<SearchOutlined />}
            onChange={(e) => filter.setQuery(e.target.value)} />
          <Select allowClear placeholder="التأمين" style={{ minWidth: 150 }}
            value={filter.values.insured}
            onChange={(v) => filter.setValue('insured', v)}
            options={[
              { value: 'yes', label: 'مؤمَّن عليهم' },
              { value: 'no', label: 'بلا تأمينات' },
            ]} />
          {branches.length > 1 ? (
            <Select allowClear showSearch placeholder="الفرع" style={{ minWidth: 150 }}
              value={filter.values.branch_id}
              onChange={(v) => filter.setValue('branch_id', v)}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              filterOption={searchFilter} filterSort={searchRank} />
          ) : null}
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>) : undefined}
        summary={tab === 'employees' ? (<>
          <ListStat label="الموظفين" value={fmt(shown.length)} />
          <ListStat label="مؤمَّن عليهم" value={fmt(insured.length)} tone="pos" />
          <ListStat label="إجمالي التأمينات الشهرية" value={money(monthly)} tone="strong" />
        </>) : (<>
          <ListStat label="عدد مرات السداد" value={fmt(remits.length)} />
          <ListStat label="إجمالي المسدد" value={money(remitted)} tone="strong" />
        </>)}
      >
        {tab === 'employees' ? (
          <Table<Row>
            {...kb.tableProps}
            className="sl-table"
            rowKey="employee_id" size="small" loading={loading} dataSource={shown}
            locale={{ emptyText: 'لا يوجد موظفون' }}
            pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={cols.columns}
          />
        ) : (
          <Table<Remittance>
            className="sl-table"
            rowKey="id" size="small" loading={loading} dataSource={remits}
            locale={{ emptyText: 'لا توجد مبالغ مسددة' }}
            pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={remitColumns}
          />
        )}
      </ListPage>

      <TabModal
        open={!!target} width={820} destroyOnClose footer={null}
        title={target ? `التأمينات — ${target.name}` : ''}
        onCancel={() => setTarget(null)}
      >
        {target ? <InsurancePanel employeeId={target.employee_id} onChanged={() => load()} /> : null}
      </TabModal>

      <TabModal
        open={remitOpen} title="سداد تأمينات" destroyOnClose
        onCancel={() => setRemitOpen(false)} onOk={saveRemit} okText="حفظ" cancelText="إلغاء"
        okButtonProps={{ loading: saving }}
      >
        <Row gutter={[10, 10]}>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>المبلغ *</div>
            <InputNumber style={{ width: '100%' }} min={0} value={remitForm.amount}
              onChange={(v) => setRemitForm({ ...remitForm, amount: v ?? undefined })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>التاريخ</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={remitForm.remit_date}
              onChange={(v) => v && setRemitForm({ ...remitForm, remit_date: v })} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>الخزنة</div>
            <Select allowClear style={{ width: '100%' }} placeholder="خزنة الفرع"
              value={remitForm.treasury_id}
              onChange={(v) => setRemitForm({ ...remitForm, treasury_id: v })}
              options={treasuries.filter((t: any) => t.active !== false)
                .map((t: any) => ({ value: t.id, label: `${t.name} — ${money(t.balance)}` }))} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>ملاحظات</div>
            <Input value={remitForm.notes}
              onChange={(e) => setRemitForm({ ...remitForm, notes: e.target.value })} />
          </Col>
        </Row>
      </TabModal>
    </>
  );
}
