import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Empty, Input, Row, Select, Space, Spin, Table,
  Tabs, Tag, Tooltip, message,
} from 'antd';
import {
  ArrowLeftOutlined, BuildOutlined, CalculatorOutlined, ClearOutlined, FileTextOutlined,
  LinkOutlined, PlusOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import { useScreenShortcuts } from '../components/keyboard';
import { TabDrawer } from '../components/TabModal';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import { useDocRoute } from '../components/useDocRoute';
import { DocRef, ManualEntryLink } from '../components/DocumentLink';
import { money } from '../utils/money';
import {
  type Asset, type Category, METHOD_LABELS, METHOD_OPTIONS, STATE_LABELS, STATE_OPTIONS,
  StateTag, USAGE_LABELS, USAGE_OPTIONS, errMsg, rateText,
} from '../components/fixedAssets/shared';
import {
  DisposeModal, ModifyModal, ReasonModal, RevalueModal, RunDepreciationModal,
} from '../components/fixedAssets/AssetModals';

interface BoardRow {
  period: string; amount: string; accumulated: string; book_value: string;
  state: 'posted' | 'due' | 'planned'; ledger_entry_id: number | null; entry_number: string | null;
}
interface Board {
  rows: BoardRow[]; posted_total: string; planned_total: string; due_count: number;
  remaining_months: number; end_period: string | null;
}

const BOARD_STATE: Record<string, { label: string; color: string }> = {
  posted: { label: 'مرحّل', color: 'green' },
  due: { label: 'مستحق', color: 'orange' },
  planned: { label: 'مخطط', color: 'default' },
};

const blank = () => ({
  id: 0, name: '', category_id: undefined, usage: undefined, method: undefined,
  annual_rate: undefined, useful_life_months: undefined, cost: undefined, salvage_value: 0,
  opening_accumulated: 0, acquisition_date: dayjs(), depreciation_start: null,
  prorata: false, branch_id: undefined, notes: '', old: false,
});

const toForm = (a: Asset) => ({
  id: a.id, name: a.name, category_id: a.category_id ?? undefined, usage: a.usage,
  method: a.method, annual_rate: a.annual_rate != null ? Number(a.annual_rate) : undefined,
  useful_life_months: a.useful_life_months || undefined, cost: Number(a.cost),
  salvage_value: Number(a.salvage_value) || 0, opening_accumulated: Number(a.opening_accumulated) || 0,
  acquisition_date: dayjs(a.acquisition_date),
  depreciation_start: a.depreciation_start ? dayjs(a.depreciation_start) : null,
  prorata: !!a.prorata, branch_id: a.branch_id ?? undefined, notes: a.notes || '',
  old: Number(a.opening_accumulated) > 0 || !!a.depreciation_start,
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fa-field">
      <div className="fa-field-label">{label}</div>
      <div className="fa-field-value">{children}</div>
    </div>
  );
}

const STEPS = ['draft', 'running', 'closed'];

function StatusBar({ state }: { state: string }) {
  const active = state === 'paused' ? 'running' : state;
  return (
    <div className="fa-statusbar">
      {STEPS.map((s) => (
        <span key={s} className={`fa-step${s === active ? ' is-on' : ''}`}>
          {STATE_LABELS[s]}{s === 'running' && state === 'paused' ? ' (موقوف)' : ''}
        </span>
      ))}
    </div>
  );
}

export default function FixedAssets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const [current, setCurrent] = useState<Asset | null>(null);
  const [form, setForm] = useState<any | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<null | 'run' | 'modify' | 'revalue' | 'dispose' | 'pause'>(null);

  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '-';
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const load = async () => {
    setLoading(true);
    try {
      const [res, br, cats] = await Promise.all([
        api.get('/api/v1/fixed-assets'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/fixed-assets/categories'),
      ]);
      setBranches(br.data || []);
      setAssets(res.data || []);
      setCategories(cats.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const loadDoc = async (id: number) => {
    setDocLoading(true);
    try {
      const [a, b, e] = await Promise.all([
        api.get(`/api/v1/fixed-assets/${id}`),
        api.get(`/api/v1/fixed-assets/${id}/board`),
        api.get(`/api/v1/fixed-assets/${id}/events`),
      ]);
      setCurrent(a.data);
      setForm(toForm(a.data));
      setBoard(b.data);
      setEvents(e.data || []);
      setEntries(null);
    } catch (err) {
      message.error(errMsg(err, 'تعذر فتح الأصل'));
    } finally { setDocLoading(false); }
  };

  const { markOpen, markClosed } = useDocRoute<Asset>({
    rows: assets,
    openId: current?.id ?? null,
    open: (row) => { void loadDoc(row.id); },
    close: () => { setCurrent(null); setForm(null); },
    fetchOne: async (id) => ({ id } as Asset),
  });

  const openAsset = (a: Asset) => { markOpen(a.id, 'view'); void loadDoc(a.id); };
  const closeDoc = () => { setCurrent(null); setForm(null); setBoard(null); markClosed(); load(); };
  const newAsset = () => {
    setCurrent(null); setBoard(null); setEvents([]); setEntries(null);
    setForm(blank());
  };

  const afterAction = (a: Asset) => { void loadDoc(a.id); };

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const filter = useListFilter(assets, {
    search: (a) => [a.code, a.name, a.category],
    filters: {
      state: (a, v) => a.state === v,
      category_id: (a, v) => a.category_id === v,
      usage: (a, v) => a.usage === v,
      branch_id: (a, v) => a.branch_id === v,
    },
  });

  const pickCategory = (id: number | undefined) => {
    const c = id ? catById.get(id) : undefined;
    setForm((f: any) => ({
      ...f, category_id: id,
      method: c?.method ?? f.method,
      usage: c?.usage ?? f.usage,
      annual_rate: c?.annual_rate != null ? Number(c.annual_rate) : undefined,
      useful_life_months: c?.useful_life_months ?? undefined,
      prorata: c?.prorata ?? f.prorata,
    }));
  };

  const payload = () => ({
    name: form.name,
    category_id: form.category_id ?? null,
    usage: form.usage || null,
    method: form.method || null,
    annual_rate: form.annual_rate != null && form.annual_rate !== '' ? String(form.annual_rate) : null,
    useful_life_months: form.useful_life_months || null,
    cost: form.cost != null ? String(form.cost) : undefined,
    salvage_value: String(form.salvage_value || 0),
    opening_accumulated: form.old ? String(form.opening_accumulated || 0) : '0',
    depreciation_start: form.old && form.depreciation_start
      ? form.depreciation_start.startOf('month').format('YYYY-MM-DD') : null,
    acquisition_date: form.acquisition_date.format('YYYY-MM-DD'),
    prorata: !!form.prorata,
    branch_id: form.branch_id || null,
    notes: form.notes || null,
  });

  const save = async (confirm = false) => {
    if (!form.name?.trim()) { message.warning('اكتب اسم الأصل'); return; }
    if (!form.category_id) { message.warning('اختر فئة الأصل'); return; }
    if (!form.cost) { message.warning('اكتب القيمة الأصلية'); return; }
    setSaving(true);
    try {
      let id = form.id;
      if (!id) {
        const r = await api.post('/api/v1/fixed-assets', { ...payload(), confirm });
        id = r.data.id;
        markOpen(id, 'view');
      } else {
        const body: any = current?.state === 'draft' ? payload() : {
          name: form.name, usage: form.usage, notes: form.notes || null,
        };
        await api.put(`/api/v1/fixed-assets/${id}`, body);
        if (confirm) await api.post(`/api/v1/fixed-assets/${id}/confirm`);
      }
      message.success(confirm ? 'تم تأكيد الأصل' : 'تم الحفظ');
      await loadDoc(id);
    } catch (err) {
      message.error(errMsg(err, 'تعذر الحفظ'));
    } finally { setSaving(false); }
  };

  const act = async (path: string, ok: string, body?: any) => {
    if (!current) return;
    try {
      const r = await api.post(`/api/v1/fixed-assets/${current.id}/${path}`, body ?? {});
      message.success(ok);
      afterAction(r.data);
    } catch (err) { message.error(errMsg(err, 'تعذر تنفيذ العملية')); }
  };

  const remove = async () => {
    if (!current) return;
    try {
      await api.delete(`/api/v1/fixed-assets/${current.id}`);
      message.success('تم حذف الأصل');
      closeDoc();
    } catch (err) { message.error(errMsg(err, 'تعذر حذف الأصل')); }
  };

  const runForAsset = async () => {
    if (!current || !board?.due_count) return;
    const last = board.rows.filter((r) => r.state === 'due').slice(-1)[0];
    const [y, m] = last.period.split('-').map(Number);
    try {
      const r = await api.post('/api/v1/fixed-assets/depreciation/run', { year: y, month: m, asset_ids: [current.id] });
      message.success(`تم ترحيل ${r.data.lines} قسط بإجمالي ${money(r.data.total)}`);
      void loadDoc(current.id);
    } catch (err) { message.error(errMsg(err, 'تعذر الترحيل')); }
  };

  const openEntries = async () => {
    if (!current) return;
    try {
      const r = await api.get(`/api/v1/fixed-assets/${current.id}/entries`);
      setEntries(r.data || []);
    } catch (err) { message.error(errMsg(err, 'تعذر تحميل القيود')); }
  };

  const active = assets.filter((a) => a.state !== 'closed');
  const totals = filter.filtered.reduce((t, a) => ({
    cost: t.cost + Number(a.cost), acc: t.acc + Number(a.accumulated_depreciation),
    book: t.book + Number(a.book_value),
  }), { cost: 0, acc: 0, book: 0 });
  const categoryOptions = categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }));

  const columns: ColumnsType<Asset> = [
    { title: 'الكود', dataIndex: 'code', width: 105, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الأصل', dataIndex: 'name', ellipsis: true, render: (v: string) => <b>{v}</b> },
    { title: 'الفئة', dataIndex: 'category', width: 130, ellipsis: true, render: (v) => v || '-' },
    { title: 'تاريخ الشراء', dataIndex: 'acquisition_date', width: 110,
      render: (d: string) => String(d).slice(0, 10) },
    { title: 'القيمة الأصلية', dataIndex: 'cost', width: 125, align: 'left', render: (v) => money(v) },
    { title: 'مجمع الإهلاك', dataIndex: 'accumulated_depreciation', width: 120, align: 'left',
      render: (v) => <span style={{ color: '#cf1322' }}>{money(v)}</span> },
    { title: 'القيمة الدفترية', dataIndex: 'book_value', width: 125, align: 'left',
      render: (v) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
    { title: 'الاستخدام', dataIndex: 'usage', width: 85, render: (v: string) => USAGE_LABELS[v] || v },
    { title: 'الفرع', dataIndex: 'branch_id', width: 100, render: (v: number | null) => branchName(v) },
    { title: 'الحالة', dataIndex: 'state', width: 110, render: (v: string) => <StateTag state={v} /> },
  ];
  const tableCols = useTableColumns('fixed-assets-v2', columns, {
    export: { name: 'الأصول الثابتة', rows: filter.filtered },
  });

  if (form) {
    const isNew = !form.id;
    const draft = isNew || current?.state === 'draft';
    const closed = current?.state === 'closed';
    const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
    const ro = (v: React.ReactNode) => <span className="fa-ro">{v ?? '-'}</span>;

    const actions = (
      <Space wrap>
        {draft && (<>
          <Button type="primary" loading={saving} onClick={() => save(true)}>تأكيد</Button>
          <Button loading={saving} onClick={() => save(false)}>حفظ</Button>
        </>)}
        {!draft && !closed && (
          <Button loading={saving} onClick={() => save(false)}>حفظ</Button>
        )}
        {current?.state === 'running' && (<>
          <Button icon={<CalculatorOutlined />} onClick={() => setDialog('modify')}>تعديل الإهلاك</Button>
          <Button onClick={() => setDialog('revalue')}>إعادة تقييم</Button>
          <Button onClick={() => setDialog('pause')}>إيقاف</Button>
        </>)}
        {current?.state === 'paused' && (
          <Button type="primary" onClick={() => act('resume', 'تم استئناف الإهلاك')}>استئناف</Button>
        )}
        {(current?.state === 'running' || current?.state === 'paused') && (<>
          <Button danger onClick={() => setDialog('dispose')}>بيع أو استبعاد</Button>
          <Popconfirm title="إرجاع الأصل إلى مسودة؟" onConfirm={() => act('draft', 'تم الإرجاع إلى مسودة')}
            okText="إرجاع" cancelText="إلغاء">
            <Button type="text">إرجاع لمسودة</Button>
          </Popconfirm>
        </>)}
        {current?.state === 'draft' && !current.source_kind && (
          <Popconfirm title="حذف الأصل؟" onConfirm={remove} okText="حذف" cancelText="إلغاء">
            <Button type="text" danger>حذف</Button>
          </Popconfirm>
        )}
      </Space>
    );

    const valueSection = (
      <Card size="small" title="القيمة" className="fa-card">
        <Field label="القيمة الأصلية">
          {draft && !current?.source_kind
            ? <InputNumber style={{ width: '100%' }} min={0} value={form.cost} onChange={(v) => set({ cost: v })} />
            : ro(money(current?.cost))}
        </Field>
        <Field label="تاريخ الشراء">
          {draft && !current?.source_kind
            ? <DatePicker style={{ width: '100%' }} value={form.acquisition_date} allowClear={false}
              onChange={(v) => v && set({ acquisition_date: v })} />
            : ro(String(current?.acquisition_date || '').slice(0, 10))}
        </Field>
        <Field label="القيمة التخريدية">
          {draft
            ? <InputNumber style={{ width: '100%' }} min={0} value={form.salvage_value} onChange={(v) => set({ salvage_value: v })} />
            : ro(money(current?.salvage_value))}
        </Field>
        {draft ? (
          <Field label="أصل قديم">
            <Checkbox checked={form.old} onChange={(e) => set({ old: e.target.checked })}>
              عليه إهلاك قبل النظام
            </Checkbox>
          </Field>
        ) : null}
        {(form.old || Number(current?.opening_accumulated) > 0) && (<>
          <Field label="إهلاك سابق">
            {draft
              ? <InputNumber style={{ width: '100%' }} min={0} value={form.opening_accumulated}
                onChange={(v) => set({ opening_accumulated: v })} />
              : ro(money(current?.opening_accumulated))}
          </Field>
          <Field label="بداية الإهلاك على النظام">
            {draft
              ? <DatePicker picker="month" style={{ width: '100%' }} value={form.depreciation_start}
                onChange={(v) => set({ depreciation_start: v })} />
              : ro(current?.depreciation_start ? String(current.depreciation_start).slice(0, 7) : '-')}
          </Field>
        </>)}
        {current && (<>
          <Field label="مجمع الإهلاك">{ro(<span style={{ color: '#cf1322' }}>{money(current.accumulated_depreciation)}</span>)}</Field>
          <Field label="القيمة الدفترية">{ro(<b style={{ color: '#0B5CA8' }}>{money(current.book_value)}</b>)}</Field>
        </>)}
      </Card>
    );

    const depSection = (
      <Card size="small" title="الإهلاك" className="fa-card">
        <Field label="الفئة">
          {draft
            ? <Select showSearch style={{ width: '100%' }} value={form.category_id} onChange={pickCategory}
              filterOption={searchFilter} filterSort={searchRank} options={categoryOptions} placeholder="اختر الفئة" />
            : ro(current?.category)}
        </Field>
        <Field label="الطريقة">
          {draft
            ? <Select style={{ width: '100%' }} value={form.method} onChange={(v) => set({ method: v })} options={METHOD_OPTIONS} />
            : ro(METHOD_LABELS[current?.method || ''] || current?.method)}
        </Field>
        <Field label="النسبة السنوية">
          {draft
            ? <InputNumber style={{ width: '100%' }} min={0} max={100} addonAfter="%" value={form.annual_rate}
              onChange={(v) => set({ annual_rate: v })} />
            : ro(current ? rateText(current) : '-')}
        </Field>
        <Field label="العمر الإنتاجي">
          {draft
            ? <InputNumber style={{ width: '100%' }} min={1} addonAfter="شهر" value={form.useful_life_months}
              onChange={(v) => set({ useful_life_months: v })} />
            : ro(current?.useful_life_months ? `${current.useful_life_months} شهر` : '-')}
        </Field>
        <Field label="جزء الشهر الأول">
          {draft
            ? <Checkbox checked={form.prorata} onChange={(e) => set({ prorata: e.target.checked })}>بالأيام</Checkbox>
            : ro(current?.prorata ? 'بالأيام' : 'شهر كامل')}
        </Field>
        <Field label="الاستخدام">
          {!closed
            ? <Select style={{ width: '100%' }} value={form.usage} onChange={(v) => set({ usage: v })} options={USAGE_OPTIONS} />
            : ro(USAGE_LABELS[current?.usage || ''])}
        </Field>
        <Field label="الفرع">
          {draft && !current?.source_kind
            ? <Select allowClear style={{ width: '100%' }} value={form.branch_id} onChange={(v) => set({ branch_id: v })}
              options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="فرع المستخدم" />
            : ro(branchName(current?.branch_id ?? null))}
        </Field>
      </Card>
    );

    const boardTab = (
      <>
        {board && board.due_count > 0 && current?.state === 'running' && (
          <Alert type="warning" showIcon style={{ marginBottom: 10 }}
            message={`يوجد ${board.due_count} قسط مستحق لم يُرحَّل`}
            action={<Button size="small" type="primary" onClick={runForAsset}>ترحيل المستحق</Button>} />
        )}
        {board && (
          <Space size={24} wrap style={{ marginBottom: 8, color: '#475569' }}>
            <span>المرحّل: <b>{money(board.posted_total)}</b></span>
            <span>الباقي: <b>{money(board.planned_total)}</b></span>
            <span>الشهور الباقية: <b>{board.remaining_months}</b></span>
            {board.end_period && <span>ينتهي في: <b>{board.end_period}</b></span>}
          </Space>
        )}
        <Table<BoardRow> size="small" rowKey="period" dataSource={board?.rows || []}
          pagination={{ defaultPageSize: 24, showSizeChanger: true }}
          locale={{ emptyText: 'لا يوجد جدول إهلاك' }}
          summary={() => (board?.rows.length ? (
            <Table.Summary.Row style={{ fontWeight: 700, background: '#fafafa' }}>
              <Table.Summary.Cell index={0}>الإجمالي</Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="left">
                {money(Number(board.posted_total) + Number(board.planned_total))}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={4} />
            </Table.Summary.Row>
          ) : null)}
          columns={[
            { title: 'الشهر', dataIndex: 'period', width: 100 },
            { title: 'القسط', dataIndex: 'amount', align: 'left', render: (v) => money(v) },
            { title: 'مجمع الإهلاك', dataIndex: 'accumulated', align: 'left', render: (v) => money(v) },
            { title: 'القيمة الدفترية', dataIndex: 'book_value', align: 'left', render: (v) => money(v) },
            { title: 'الحالة', dataIndex: 'state', width: 100,
              render: (v: string) => <Tag color={BOARD_STATE[v].color}>{BOARD_STATE[v].label}</Tag> },
            { title: 'القيد', dataIndex: 'ledger_entry_id', width: 150,
              render: (v: number | null, r) => (v ? <ManualEntryLink entryId={v} label={r.entry_number || `#${v}`} /> : '-') },
          ]} />
      </>
    );

    const accountsTab = current ? (
      <div style={{ maxWidth: 640 }}>
        <Field label="حساب الأصل">{ro(current.accounts?.asset)}</Field>
        <Field label="مجمع الإهلاك">{ro(current.accounts?.accumulated)}</Field>
        <Field label="مصروف الإهلاك">{ro(current.accounts?.expense)}</Field>
      </div>
    ) : <Empty description="تظهر الحسابات بعد حفظ الأصل" />;

    const eventsTab = (
      <Table size="small" rowKey="id" dataSource={events} pagination={false} summary={() => null}
        locale={{ emptyText: 'لا توجد عمليات' }}
        columns={[
          { title: 'التاريخ', dataIndex: 'date', width: 110 },
          { title: 'العملية', dataIndex: 'label', width: 150 },
          { title: 'المبلغ', dataIndex: 'amount', width: 120, render: (v) => (v ? money(v) : '-') },
          { title: 'التفاصيل', dataIndex: 'details', render: (v: any) => {
            if (!v) return '-';
            if (typeof v === 'string') return v;
            if (v.reason) return v.reason;
            return '-';
          } },
          { title: 'القيد', dataIndex: 'ledger_entry_id', width: 120,
            render: (v: number | null) => (v ? <ManualEntryLink entryId={v} label={`#${v}`} /> : '-') },
          { title: 'المستخدم', dataIndex: 'user', width: 140, render: (v) => v || '-' },
        ]} />
    );

    return (
      <Spin spinning={docLoading}>
        <Card className="fa-doc" title={(
          <Space wrap>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={closeDoc}>الأصول الثابتة</Button>
            <span>/ {isNew ? 'أصل جديد' : current?.code}</span>
          </Space>
        )} extra={current ? <StatusBar state={current.state} /> : <StatusBar state="draft" />}>
          <div className="fa-top">
            {actions}
            {current && (
              <Space wrap>
                <Button icon={<FileTextOutlined />} onClick={openEntries}>القيود</Button>
                {current.source_kind && current.source_id && (
                  <Tooltip title="المستند المصدر">
                    <span className="fa-smart">
                      <LinkOutlined />{' '}
                      <DocRef kind={current.source_kind === 'purchase' ? 'purchase' : 'voucher'}
                        id={current.source_id} label={current.source_label || 'المستند المصدر'} />
                    </span>
                  </Tooltip>
                )}
              </Space>
            )}
          </div>

          <div className="fa-title">
            {draft || !closed
              ? <Input size="large" variant="borderless" placeholder="اسم الأصل" value={form.name}
                onChange={(e) => set({ name: e.target.value })} />
              : <h2>{current?.name}</h2>}
          </div>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>{valueSection}</Col>
            <Col xs={24} lg={12}>{depSection}</Col>
          </Row>

          <Tabs style={{ marginTop: 12 }} items={[
            { key: 'board', label: 'جدول الإهلاك', children: boardTab },
            { key: 'accounts', label: 'الحسابات', children: accountsTab },
            { key: 'events', label: 'السجل', children: eventsTab },
            { key: 'notes', label: 'ملاحظات', children: (
              <Input.TextArea rows={4} value={form.notes} disabled={closed}
                onChange={(e) => set({ notes: e.target.value })} />
            ) },
          ]} />
        </Card>

        {current && (<>
          <ModifyModal asset={current} open={dialog === 'modify'} onClose={() => setDialog(null)}
            onDone={afterAction} remaining={board?.remaining_months ?? null} />
          <RevalueModal asset={current} open={dialog === 'revalue'} onClose={() => setDialog(null)}
            onDone={afterAction} />
          <DisposeModal asset={current} open={dialog === 'dispose'} onClose={() => setDialog(null)}
            onDone={afterAction} dueCount={board?.due_count || 0} />
          <ReasonModal open={dialog === 'pause'} title="إيقاف الإهلاك" onClose={() => setDialog(null)}
            onOk={async (reason) => { await act('pause', 'تم إيقاف الإهلاك', { reason }); setDialog(null); }} />
        </>)}

        <TabDrawer open={entries !== null} onClose={() => setEntries(null)} width={560}
          placement="left" title={`قيود ${current?.code || ''}`}>
          <Table size="small" rowKey="entry_id" dataSource={entries || []} pagination={false}
            summary={() => null}
            columns={[
              { title: 'التاريخ', dataIndex: 'date', width: 105 },
              { title: 'البيان', dataIndex: 'label' },
              { title: 'القيد', dataIndex: 'entry_id', width: 150,
                render: (v: number, r: any) => <ManualEntryLink entryId={v} label={r.number || `#${v}`} /> },
            ]} />
        </TabDrawer>
      </Spin>
    );
  }

  return (
    <>
      <ListPage
        icon={<BuildOutlined />}
        title="الأصول الثابتة"
        actions={(<>
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={newAsset}>أصل جديد</Button>
          <Button icon={<CalculatorOutlined />} onClick={() => setDialog('run')}>ترحيل الإهلاك</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
          {tableCols.control}
        </>)}
        filters={(<>
          <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
            placeholder="بحث بالكود أو الاسم أو الفئة" prefix={<SearchOutlined />}
            onChange={(e) => filter.setQuery(e.target.value)} />
          <Select allowClear placeholder="الحالة" value={filter.values.state}
            onChange={(v) => filter.setValue('state', v ?? undefined)} options={STATE_OPTIONS} />
          <Select allowClear placeholder="الفئة" value={filter.values.category_id}
            onChange={(v) => filter.setValue('category_id', v ?? undefined)} options={categoryOptions} />
          <Select allowClear placeholder="الاستخدام" value={filter.values.usage}
            onChange={(v) => filter.setValue('usage', v ?? undefined)} options={USAGE_OPTIONS} />
          <Select allowClear placeholder="الفرع" value={filter.values.branch_id}
            onChange={(v) => filter.setValue('branch_id', v ?? undefined)}
            options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>)}
      >
        <Table<Asset>
          className="sl-table"
          rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
          onRow={(r) => ({ onClick: () => openAsset(r), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'لا توجد أصول مسجلة' }}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            showTotal: () => (
              <span className="sl-foot">
                <span>المعروض: <b>{filter.filtered.length}</b> من {assets.length}</span>
                <span>أصول قائمة: <b>{active.length}</b></span>
              </span>
            ) }}
          tableLayout="fixed"
          columns={tableCols.columns}
          summary={() => (filter.filtered.length ? (
            <Table.Summary fixed="bottom">
              <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                <Table.Summary.Cell index={0} colSpan={4}>الإجمالي</Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="left">{money(totals.cost)}</Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="left">
                  <span style={{ color: '#cf1322' }}>{money(totals.acc)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="left">
                  <b style={{ color: '#0B5CA8' }}>{money(totals.book)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} colSpan={3} />
              </Table.Summary.Row>
            </Table.Summary>
          ) : null)}
        />
      </ListPage>
      <RunDepreciationModal open={dialog === 'run'} onClose={() => setDialog(null)} onDone={load}
        branchName={branchName} />
    </>
  );
}

