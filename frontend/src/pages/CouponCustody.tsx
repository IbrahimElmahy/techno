import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Col, DatePicker, Form, Input, Modal, Row, Select, Table, Tag,
  Typography, message,
} from 'antd';
import {
  DeleteOutlined, ExportOutlined, ImportOutlined, ReloadOutlined, InboxOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { useLiveRefresh } from '../utils/live';
import { useLookup } from '../hooks/useLookup';
import DateRangeFilter from '../components/DateRangeFilter';
import { Popconfirm } from '../components/noConfirm';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { numeralsLocale } from '../utils/money';
import { repOptions as repPickerOptions } from '../utils/reps';

interface CustodyDoc {
  id: number;
  document_number: string;
  direction: 'out' | 'in';
  rep_user_id: number;
  rep_name?: string | null;
  coupon_kind: string;
  serial_from: string;
  serial_to: string;
  count: number;
  doc_date?: string | null;
  notes?: string | null;
}

interface BalanceRow {
  rep_user_id: number;
  rep_name: string;
  coupon_kind: string;
  available: number;
  ranges: [string, string][];
  given: number;
  returned: number;
  issued: number;
}

export function rangesText(ranges: [string, string][] | string[][]): string {
  return (ranges || []).map(([a, b]) => (a === b ? a : `${a}–${b}`)).join('، ');
}

const asciiDigits = (v: string) => String(v ?? '').trim()
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

function rangeCount(from?: string, to?: string): number | null {
  const a = asciiDigits(from || '');
  const b = asciiDigits(to || '') || a;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
  const n = Number(b) - Number(a) + 1;
  return n > 0 ? n : null;
}

export default function CouponCustody() {
  const { options: kindLookup } = useLookup('coupon_kind');
  const kindOptions = useMemo(
    () => (kindLookup || []).map((o) => ({ value: o.value, label: o.label })), [kindLookup]);

  const [reps, setReps] = useState<{ id: number; full_name: string; username?: string }[]>([]);
  const [repId, setRepId] = useState<number | undefined>();
  const repOptions = useMemo(
    () => repPickerOptions(sortByName(reps, (r) => r.full_name || r.username || ''), repId),
    [reps, repId]);

  const [kind, setKind] = useState<string | undefined>();
  const [direction, setDirection] = useState<'out' | 'in' | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [docs, setDocs] = useState<CustodyDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<BalanceRow[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [tabRaw, setTab] = useQueryTab('docs');
  const tab = (tabRaw === 'balance' ? 'balance' : 'docs') as 'docs' | 'balance';

  const [modal, setModal] = useState<'out' | 'in' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const watchFrom = Form.useWatch('serial_from', form);
  const watchTo = Form.useWatch('serial_to', form);
  const watchRep = Form.useWatch('rep_user_id', form);
  const watchKind = Form.useWatch('coupon_kind', form);

  useEffect(() => {
    api.get('/api/v1/users')
      .then((r) => setReps((r.data || []).filter((u: any) => u.role === 'sales_rep')))
      .catch(() => setReps([]));
  }, []);

  const loadDocs = useCallback(async (p = page, ps = pageSize, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params: Record<string, any> = { limit: ps, offset: (p - 1) * ps };
      if (repId) params.rep_user_id = repId;
      if (kind) params.coupon_kind = kind;
      if (direction) params.direction = direction;
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
      }
      const res = await api.get('/api/v1/coupon-custody', { params });
      setDocs(res.data?.rows || []);
      setTotal(Number(res.data?.total || 0));
    } catch {
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [page, pageSize, repId, kind, direction, range]);

  const loadBalance = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setBalanceLoading(true);
    try {
      const res = await api.get('/api/v1/coupon-custody/balance',
        { params: repId ? { rep_user_id: repId } : {} });
      setBalance(res.data || []);
    } catch {
      setBalance([]);
    } finally {
      if (!opts?.silent) setBalanceLoading(false);
    }
  }, [repId]);

  useEffect(() => { setPage(1); loadDocs(1, pageSize); }, [repId, kind, direction, range]);
  useEffect(() => { loadBalance(); }, [repId]);

  useLiveRefresh(['coupon-custody', 'sales'], () => {
    loadDocs(undefined, undefined, { silent: true });
    loadBalance({ silent: true });
  });

  const openModal = (dir: 'out' | 'in') => {
    form.resetFields();
    form.setFieldsValue({ rep_user_id: repId, coupon_kind: kind, doc_date: dayjs() });
    setModal(dir);
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        rep_user_id: v.rep_user_id,
        coupon_kind: v.coupon_kind,
        serial_from: asciiDigits(v.serial_from),
        serial_to: asciiDigits(v.serial_to || '') || null,
        doc_date: v.doc_date ? (v.doc_date as Dayjs).format('YYYY-MM-DD') : null,
        notes: v.notes || null,
      };
      const res = await api.post(`/api/v1/coupon-custody/${modal === 'out' ? 'issue' : 'return'}`, body);
      message.success(`${modal === 'out' ? 'تم صرف' : 'تم استرجاع'} ${res.data.count} ورقة — ${res.data.document_number}`);
      setModal(null);
      loadDocs(1, pageSize);
      setPage(1);
      loadBalance();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const remove = async (doc: CustodyDoc) => {
    try {
      await api.delete(`/api/v1/coupon-custody/${doc.id}`);
      message.success(`تم حذف ${doc.document_number}`);
      loadDocs();
      loadBalance();
    } catch {
    }
  };

  const [modalRepBalance, setModalRepBalance] = useState<BalanceRow[]>([]);
  useEffect(() => {
    if (!modal || !watchRep) { setModalRepBalance([]); return; }
    api.get('/api/v1/coupon-custody/balance', { params: { rep_user_id: watchRep } })
      .then((r) => setModalRepBalance((r.data || []).filter(
        (b: BalanceRow) => !watchKind || b.coupon_kind === watchKind)))
      .catch(() => setModalRepBalance([]));
  }, [modal, watchRep, watchKind]);

  const count = rangeCount(watchFrom, watchTo);

  const docColumns = [
    { title: 'رقم المستند', dataIndex: 'document_number', width: 120,
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'النوع', dataIndex: 'direction', width: 110,
      render: (v: string) => (v === 'out'
        ? <Tag color="blue">صرف للمندوب</Tag> : <Tag color="orange">استرجاع</Tag>) },
    { title: 'التاريخ', dataIndex: 'doc_date', width: 110,
      render: (v: string | null) => (v ? String(v).slice(0, 10) : '-') },
    { title: 'المندوب', dataIndex: 'rep_name' },
    { title: 'الفئة', dataIndex: 'coupon_kind', width: 90,
      render: (v: string) => <Tag color="gold">{v}</Tag> },
    { title: 'من', dataIndex: 'serial_from', width: 100 },
    { title: 'إلى', dataIndex: 'serial_to', width: 100 },
    { title: 'العدد', dataIndex: 'count', width: 80 },
    { title: 'ملاحظات', dataIndex: 'notes', ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: '', key: 'actions', width: 50,
      render: (_: any, r: CustodyDoc) => (
        <Popconfirm onConfirm={() => remove(r)}>
          <Button type="text" danger icon={<DeleteOutlined />} title="حذف المستند" />
        </Popconfirm>
      ) },
  ];

  const balanceColumns = [
    { title: 'المندوب', dataIndex: 'rep_name' },
    { title: 'الفئة', dataIndex: 'coupon_kind', width: 90,
      render: (v: string) => <Tag color="gold">{v}</Tag> },
    { title: 'المتاح لديه', dataIndex: 'available', width: 100,
      render: (v: number) => <b>{v}</b> },
    { title: 'السريالات المتاحة', dataIndex: 'ranges',
      render: (v: [string, string][]) => (v?.length
        ? <Typography.Text style={{ direction: 'ltr', display: 'inline-block' }}>{rangesText(v)}</Typography.Text>
        : <span style={{ color: '#555b65' }}>نفدت</span>) },
    { title: 'صُرف للعملاء', dataIndex: 'given', width: 110 },
    { title: 'أُعيد للمكتب', dataIndex: 'returned', width: 100 },
    { title: 'إجمالي المصروف', dataIndex: 'issued', width: 110 },
  ];

  const filters = (<>
    <Select className="sl-f-customer" allowClear showSearch placeholder="كل المناديب"
      value={repId} onChange={setRepId} options={repOptions} popupMatchSelectWidth={false}
      filterOption={searchFilter} filterSort={searchRank} />
    <Select allowClear showSearch placeholder="كل الفئات"
      value={kind} onChange={setKind} options={kindOptions}
      filterOption={searchFilter} filterSort={searchRank} />
    <Select allowClear placeholder="صرف واسترجاع"
      value={direction} onChange={setDirection}
      options={[{ value: 'out', label: 'صرف للمندوب' }, { value: 'in', label: 'استرجاع' }]} />
    <DateRangeFilter className="sl-f-dates" value={range} onChange={setRange} />
  </>);

  const shownBalance = kind ? balance.filter((b) => b.coupon_kind === kind) : balance;

  return (
    <>
    <ListPage<'docs' | 'balance'>
      icon={<InboxOutlined />}
      title="عهدة الكوبونات"
      tabs={[
        { key: 'docs', label: 'المستندات', count: total },
        { key: 'balance', label: 'الرصيد' },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      actions={(<>
        <Button type="primary" className="sl-create" icon={<ExportOutlined />}
          onClick={() => openModal('out')}>
          صرف عهدة لمندوب
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => openModal('in')}>
          استرجاع من مندوب
        </Button>
        <Button icon={<ReloadOutlined />}
          onClick={() => { loadDocs(); loadBalance(); }}>تحديث</Button>
      </>)}
      filters={filters}
    >
      {tab === 'docs' ? (
        <Table<CustodyDoc>
          className="sl-table"
          rowKey="id" size="small" loading={loading} dataSource={docs}
          columns={docColumns} scroll={{ x: 900 }}
          locale={{ emptyText: 'لا توجد مستندات عهدة' }}
          pagination={{
            current: page, pageSize, total, showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            locale: { items_per_page: '' },
            onChange: (p, ps) => { setPage(p); setPageSize(ps); loadDocs(p, ps); },
            showTotal: (t) => (
              <span className="sl-foot">
                <span>إجمالي المستندات: <b>{t.toLocaleString(numeralsLocale())}</b></span>
              </span>
            ),
          }}
        />
      ) : (
        <Table<BalanceRow>
          className="sl-table"
          rowKey={(r) => `${r.rep_user_id}-${r.coupon_kind}`} size="small"
          loading={balanceLoading}
          dataSource={shownBalance}
          columns={balanceColumns} pagination={false} scroll={{ x: 800 }}
          locale={{ emptyText: 'لا توجد عهدة كوبونات لدى أي مندوب' }}
        />
      )}
    </ListPage>

      <Modal
        open={modal !== null}
        title={modal === 'out' ? 'صرف عهدة كوبونات لمندوب' : 'استرجاع كوبونات من مندوب'}
        onCancel={() => setModal(null)}
        onOk={submit}
        okText={modal === 'out' ? 'صرف' : 'استرجاع'}
        cancelText="إلغاء"
        confirmLoading={saving}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Row gutter={8}>
            <Col span={14}>
              <Form.Item name="rep_user_id" label="المندوب"
                rules={[{ required: true, message: 'اختر المندوب' }]}>
                <Select showSearch placeholder="المندوب" options={repOptions}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="coupon_kind" label="فئة الكوبون"
                rules={[{ required: true, message: 'اختر الفئة' }]}>
                <Select showSearch placeholder="عادي / فضي / ذهبي" options={kindOptions}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={9}>
              <Form.Item name="serial_from" label="من سريال"
                rules={[{ required: true, message: 'اكتب أول سريال' }]}>
                <Input inputMode="numeric" placeholder="1001" />
              </Form.Item>
            </Col>
            <Col span={9}>
              <Form.Item name="serial_to" label="إلى سريال">
                <Input inputMode="numeric" placeholder="1050" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="العدد">
                <Input readOnly value={count ?? ''} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={10}>
              <Form.Item name="doc_date" label="التاريخ">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="notes" label="ملاحظات">
                <Input placeholder="اختياري" />
              </Form.Item>
            </Col>
          </Row>
          {(watchFrom && count === null) && (
            <Alert type="warning" showIcon style={{ marginBottom: 8 }}
              message="يجب أن تكون الأرقام التسلسلية أرقاماً، وألا تكون النهاية أصغر من البداية." />
          )}
          {watchRep && modalRepBalance.length > 0 && (
            <Alert type="info" showIcon
              message="لديه الآن"
              description={modalRepBalance.map((b) => (
                <div key={b.coupon_kind}>
                  <Tag color="gold">{b.coupon_kind}</Tag>
                  {b.available} ورقة
                  {b.ranges.length ? `: ${rangesText(b.ranges)}` : ''}
                </div>
              ))} />
          )}
        </Form>
      </Modal>
    </>
  );
}
