import { allRows } from '../components/tableDefaults';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, compareArabic } from '../utils/arabicSort';
import {
  Alert, Button, Col, DatePicker, Descriptions, Empty, Input, Modal, Row, Segmented, Select,
  Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { InputNumber } from '../components/NumberInput';
import {
  DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, ArrowLeftOutlined, SettingOutlined,
  TagsOutlined, SearchOutlined, ClearOutlined, CheckCircleOutlined, CloseCircleOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { Popconfirm } from '../components/noConfirm';
import { useTableColumns } from '../components/ColumnSettings';
import DocumentLink from '../components/DocumentLink';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { useScreenShortcuts } from '../components/keyboard';
import { numeralsLocale } from '../utils/money';
import { useLookup } from '../hooks/useLookup';
import CouponStatsOverview from '../components/CouponStatsOverview';
import { useLiveRefresh } from '../utils/live';

type Status = 'valid' | 'unknown' | 'received' | 'checking' | 'pending'
  | 'wrong_kind' | 'ambiguous';

interface Entry {
  serial: string;
  status: Status;
  issuedToId?: number | null;
  issuedToName?: string | null;
  documentNumber?: string | null;
  couponKind?: string | null;
  kinds?: string[];
}

interface ReceiptLineOut {
  id: number;
  serial: string;
  coupon_kind?: string | null;
  sales_invoice_id?: number | null;
  coupon_issue_id?: number | null;
}

interface Receipt {
  id: number;
  document_number: string;
  customer_id: number | null;
  received_date: string;
  coupon_count: number;
  notes?: string | null;
  declared_kind?: string | null;
  declared_value?: string | number | null;
  customer_type?: string | null;
  status?: ReceiptStatus;
  source?: string | null;
  reject_reason?: string | null;
  rejected_serials?: string[];
  approved_at?: string | null;
  lines: ReceiptLineOut[];
}

type ReceiptStatus = 'pending' | 'approved' | 'rejected';

const RECEIPT_STATUS: Record<ReceiptStatus, { color: string; text: string; dot: string }> = {
  pending: { color: 'warning', text: 'بانتظار الاعتماد', dot: '#F5A11D' },
  approved: { color: 'success', text: 'تم الاعتماد', dot: '#6AB42D' },
  rejected: { color: 'error', text: 'مرفوض', dot: '#f5222d' },
};

const rangeOf = (from: number | null, to: number | null): [number, number] | null => {
  const a = from ?? to;
  const b = to ?? from;
  return a === null || b === null ? null : [a, b];
};

interface CouponTypeItem {
  id: number;
  name: string;
  kind?: string;
  value?: string | number;
  active: boolean;
}

export default function CouponReceipts() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rangeFrom, setRangeFrom] = useState<number | null>(null);
  const [rangeTo, setRangeTo] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customers, setCustomers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [receivedDate, setReceivedDate] = useState<Dayjs>(dayjs());
  const [kind, setKind] = useState<string>('');
  const [value, setValue] = useState<number | null>(null);
  const [customerType, setCustomerType] = useState<string>('plumber');

  const { options: kindLookup } = useLookup('coupon_kind');
  const { options: customerTypeLookup } = useLookup('customer_type');

  const kindOptions = useMemo(
    () => (kindLookup || []).map((o) => ({
      value: o.value, label: o.label, defaultValue: 0,
    })),
    [kindLookup]);

  const handleKindChange = (newKind: string) => {
    setKind(newKind);
    const opt = kindOptions.find((o) => o.value === newKind);
    if (opt && opt.defaultValue) {
      setValue(opt.defaultValue);
    }
  };

  const kindLabel = (k: string) => kindOptions.find((o) => o.value === k)?.label ?? k;

  interface ReceiptsSummary {
    total_receipts: number;
    total_coupons: number;
    total_value: number;
    kind_counts: Record<string, number>;
    status_counts?: Record<string, number>;
  }

  const { can } = useAuth();
  const canManage = can('coupon.custody');
  const [statusFilter, setStatusFilter] = useState<'all' | ReceiptStatus>('all');
  const statusRef = useRef(statusFilter);
  statusRef.current = statusFilter;
  const statusParam = () => (statusRef.current === 'all' ? {} : { status: statusRef.current });

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Receipt | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [summaryData, setSummaryData] = useState<ReceiptsSummary>({
    total_receipts: 0,
    total_coupons: 0,
    total_value: 0,
    kind_counts: {},
  });

  const clientUuid = useRef<string>(crypto.randomUUID());

  const loadSummary = useCallback(async (q = searchQuery) => {
    try {
      const params: Record<string, any> = { ...statusParam() };
      if (q.trim()) params.q = q.trim();
      const res = await api.get<ReceiptsSummary>('/api/v1/coupon-receipts/summary', { params });
      setSummaryData({
        total_receipts: Number(res.data.total_receipts || 0),
        total_coupons: Number(res.data.total_coupons || 0),
        total_value: Number(res.data.total_value || 0),
        kind_counts: res.data.kind_counts || {},
        status_counts: res.data.status_counts || {},
      });
    } catch {
    }
  }, [searchQuery]);

  const fetchAllReceipts = async () => {
    const params: Record<string, any> = { ...statusParam() };
    if (searchQuery.trim()) params.q = searchQuery.trim();
    const res = await api.get<any>('/api/v1/coupon-receipts', { params });
    return (Array.isArray(res.data) ? res.data : (res.data?.rows ?? []));
  };

  const loadReceipts = useCallback(async (
    targetPage = page, targetPageSize = pageSize, q = searchQuery, opts?: { silent?: boolean },
  ) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const params: Record<string, any> = {
        limit: targetPageSize,
        offset: (targetPage - 1) * targetPageSize,
        ...statusParam(),
      };
      if (q.trim()) params.q = q.trim();
      const res = await api.get<any>('/api/v1/coupon-receipts', { params });
      if (Array.isArray(res.data)) {
        setReceipts(res.data);
        const headerTotal = res.headers['x-total-count'];
        setTotalCount(headerTotal ? Number(headerTotal) : res.data.length);
      } else {
        setReceipts(res.data.rows || []);
        setTotalCount(Number(res.data.total || 0));
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, pageSize, searchQuery]);

  useLiveRefresh(['coupon-receipts'], () => {
    loadReceipts(undefined, undefined, undefined, { silent: true });
    loadSummary();
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      loadReceipts(1, pageSize, searchQuery);
      loadSummary(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    api.get('/api/v1/customers/options', { params: { limit: 20000 } }).then((r) => setCustomers(r.data || [])).catch(console.error);
  }, []);

  const customerName = (id: number | null) =>
    customers.find((c) => c.id === id)?.name ?? (id ? `عميل #${id}` : '-');

  const addSerial = async (raw: string) => {
    const serial = String(raw).trim();
    if (!serial) return;
    if (!kind) { message.warning('اختر فئة الكوبون أولاً'); return; }
    if (entries.some((e) => e.serial === serial)) {
      message.warning('هذا الكوبون مضاف بالفعل');
      return;
    }
    setEntries((prev) => [{ serial, status: 'checking', couponKind: kind }, ...prev]);
    try {
      const res = await api.get('/api/v1/coupon-receipts/check',
        { params: { serial, coupon_kind: kind } });
      const d = res.data;
      const st = (d.status as Status) || 'unknown';
      setEntries((prev) => prev.map((e) => (e.serial === serial ? {
        serial,
        status: st,
        issuedToId: d.issued_to_id ?? d.customer_id ?? null,
        issuedToName: d.issued_to_name ?? d.customer_name ?? null,
        documentNumber: d.document_number,
        couponKind: d.coupon_kind || kind,
        kinds: (d.kinds || []) as string[],
      } : e)));
      if (d.in_custody) {
        message.error(`الكوبون ${serial} لا يزال في عهدة المندوب ${d.custody_rep_name || ''} — لم يُصرف لعميل`);
      } else if (st === 'unknown') message.warning(`الكوبون ${serial} غير مصروف من النظام`);
      if (st === 'received') message.warning(`الكوبون ${serial} مُستلَم من قبل`);
      if (st === 'wrong_kind') {
        const where = ((d.kinds || []) as string[]).map(kindLabel).join(' + ');
        message.error(
          `الكوبون ${serial} غير مصروف تحت فئة ${kindLabel(kind)}`
          + (where ? `. موجود تحت: ${where}` : ''));
      }
      if (st === 'ambiguous') {
        message.warning(`الكوبون ${serial} مصروف تحت أكثر من فئة — راجع الورقة`);
      }
    } catch (err: any) {
      setEntries((prev) => prev.map((e) => (e.serial === serial ? { ...e, status: 'pending' } : e)));
      message.warning(`الكوبون ${serial} ستتم مراجعته عند الحفظ (${err?.message || 'انقطاع'})`);
    }
  };

  const addRange = async () => {
    if (!kind) { message.warning('اختر فئة الكوبون أولاً'); return; }
    const range = rangeOf(rangeFrom, rangeTo);
    if (!range) { message.warning('اكتب رقم الكوبون في «من رقم»'); return; }
    const [from, to] = range;
    if (to < from) { message.warning('رقم النهاية أصغر من البداية'); return; }
    if (to - from + 1 > 2000) { message.warning('النطاق كبير — الحد الأقصى ٢٠٠٠ كوبون في المرة الواحدة'); return; }
    setRangeFrom(null); setRangeTo(null);
    for (let n = from; n <= to; n += 1) {
      await addSerial(String(n));
    }
  };

  const good = entries.filter((e) => e.status === 'valid');
  const rejects = entries.filter((e) => e.status === 'unknown' || e.status === 'received'
    || e.status === 'wrong_kind' || e.status === 'ambiguous');
  const offline = entries.filter((e) => e.status === 'pending' || e.status === 'checking');
  const counted = [...good, ...offline];
  const issuedToNames = Array.from(
    new Set(counted.map((e) => e.issuedToName).filter(Boolean) as string[]));
  const issuedToText = issuedToNames.length === 0 ? ''
    : issuedToNames.length <= 2 ? issuedToNames.join(' + ')
      : `أكثر من تاجر (${issuedToNames.length})`;
  const totalValue = (value ?? 0) * counted.length;

  const receiverTypes = customerType === 'plumber' ? ['plumber'] : ['trader', 'merchant'];
  const customerTypeLabel = (t: unknown) => {
    const key = String(t ?? '');
    if (!key) return '';
    return customerTypeLookup.find((o) => o.value === key)?.label ?? key;
  };
  const receiverOptions = [...customers]
    .sort((a, b) => {
      const rank = (c: any) => (receiverTypes.includes(String(c.customer_type)) ? 0 : 1);
      return rank(a) - rank(b)
        || compareArabic(a.name, b.name);
    })
    .map((c) => {
      const typeLabel = customerTypeLabel(c.customer_type);
      return {
        value: c.id as number,
        label: typeLabel ? `${String(c.name)} — ${typeLabel}` : String(c.name),
      };
    });

  const save = async () => {
    if (!entries.length) { message.warning('لا توجد كوبونات'); return; }
    if (rejects.length) { message.warning('احذف الكوبونات المرفوضة أولاً'); return; }
    if (!kind) { message.warning('اختر فئة الكوبون أولاً'); return; }
    if (!customerId) { message.warning('حدد جهة الاستلام'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/coupon-receipts', {
        serials: counted.map((e) => e.serial),
        customer_id: customerId ?? null,
        notes: notes.trim() || null,
        client_uuid: clientUuid.current,
        received_date: receivedDate.format('YYYY-MM-DD'),
        declared_kind: kind,
        coupon_kind: kind,
        declared_value: value,
        customer_type: customerType,
      });
      message.success('تم تسجيل الاستلام ورفعه إلى الخادم');
      setEntries([]); setNotes(''); setCustomerId(undefined); setKind('');
      setValue(null); setCustomerType('plumber');
      setReceivedDate(dayjs());
      clientUuid.current = crypto.randomUUID();
      loadReceipts();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الاستلام');
    } finally { setSaving(false); }
  };

  const [acting, setActing] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Receipt | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const afterAction = (updated?: Receipt | null, removedId?: number) => {
    loadReceipts(undefined, undefined, undefined, { silent: true });
    loadSummary();
    setDetail((d) => {
      if (!d) return d;
      if (removedId != null && d.id === removedId) return null;
      return updated && d.id === updated.id ? updated : d;
    });
  };

  const errorText = (err: any, fallback: string) =>
    err?.response?.data?.detail?.message || fallback;

  const approve = async (r: Receipt) => {
    setActing(r.id);
    try {
      const res = await api.post<Receipt>(`/api/v1/coupon-receipts/${r.id}/approve`);
      message.success(`تم اعتماد ${r.document_number}`);
      afterAction(res.data);
    } catch (err: any) {
      message.error(errorText(err, 'تعذر الاعتماد'));
    } finally { setActing(null); }
  };

  const reject = async () => {
    if (!rejecting) return;
    const r = rejecting;
    setActing(r.id);
    try {
      const res = await api.post<Receipt>(`/api/v1/coupon-receipts/${r.id}/reject`,
        { reason: rejectReason.trim() || null });
      message.success(`تم رفض ${r.document_number} — أُعيدت أرقامه متاحة للاستلام`);
      setRejecting(null); setRejectReason('');
      afterAction(res.data);
    } catch (err: any) {
      message.error(errorText(err, 'تعذر الرفض'));
    } finally { setActing(null); }
  };

  const remove = async (r: Receipt) => {
    setActing(r.id);
    try {
      await api.delete(`/api/v1/coupon-receipts/${r.id}`);
      message.success(`تم حذف ${r.document_number} — أُعيدت أرقامه للتداول`);
      afterAction(null, r.id);
    } catch (err: any) {
      message.error(errorText(err, 'تعذر الحذف'));
    } finally { setActing(null); }
  };

  const [editing, setEditing] = useState<Receipt | null>(null);
  const [editSerials, setEditSerials] = useState<string[]>([]);
  const [editKind, setEditKind] = useState<string>('');
  const [editCustomer, setEditCustomer] = useState<number | undefined>();
  const [editDate, setEditDate] = useState<Dayjs | null>(null);
  const [editValue, setEditValue] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editFrom, setEditFrom] = useState<number | null>(null);
  const [editTo, setEditTo] = useState<number | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (r: Receipt) => {
    setEditing(r);
    setEditSerials(r.lines.map((l) => l.serial));
    setEditKind(r.declared_kind || r.lines.find((l) => l.coupon_kind)?.coupon_kind || '');
    setEditCustomer(r.customer_id ?? undefined);
    setEditDate(r.received_date ? dayjs(r.received_date) : null);
    setEditValue(r.declared_value != null ? Number(r.declared_value) : null);
    setEditNotes(r.notes || '');
    setEditFrom(null); setEditTo(null);
  };

  const addEditRange = () => {
    const range = rangeOf(editFrom, editTo);
    if (!range) { message.warning('اكتب رقم الكوبون في «من رقم»'); return; }
    const [from, to] = range;
    if (to < from) { message.warning('رقم النهاية أصغر من البداية'); return; }
    if (to - from + 1 > 500) { message.warning('النطاق كبير — الحد الأقصى ٥٠٠ كوبون'); return; }
    const added: string[] = [];
    for (let n = from; n <= to; n += 1) added.push(String(n));
    setEditSerials((prev) => Array.from(new Set([...prev, ...added])));
    setEditFrom(null); setEditTo(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const serials = editSerials.map((s) => s.trim()).filter(Boolean);
    if (!serials.length) { message.warning('يجب أن يتضمن الاستلام كوبوناً واحداً على الأقل'); return; }
    setEditSaving(true);
    try {
      const res = await api.put<Receipt>(`/api/v1/coupon-receipts/${editing.id}`, {
        serials,
        coupon_kind: editKind || null,
        customer_id: editCustomer ?? null,
        received_date: editDate ? editDate.format('YYYY-MM-DD') : null,
        declared_value: editValue,
        notes: editNotes.trim() || null,
      });
      message.success(`تم تعديل ${editing.document_number}`);
      setEditing(null);
      afterAction(res.data);
    } catch (err: any) {
      message.error(errorText(err, 'تعذر حفظ التعديل'));
    } finally { setEditSaving(false); }
  };

  const statusTag = (r: Receipt) => {
    const st = RECEIPT_STATUS[(r.status || 'approved') as ReceiptStatus] || RECEIPT_STATUS.approved;
    return (
      <Space size={2}>
        <Tag color={st.color} style={{ marginInlineEnd: 0 }}>{st.text}</Tag>
        {r.source === 'app' ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>من التطبيق</Tag> : null}
      </Space>
    );
  };

  const rowActions = (r: Receipt) => {
    if (!canManage) return null;
    const st = r.status || 'approved';
    const busy = acting === r.id;
    return (
      <Space size={2} onClick={(e) => e.stopPropagation()}>
        {st === 'pending' && (
          <Tooltip title="اعتماد">
            <Button type="text" icon={<CheckCircleOutlined style={{ color: '#6AB42D' }} />}
              loading={busy} onClick={() => approve(r)} />
          </Tooltip>
        )}
        {st === 'pending' && (
          <Tooltip title="رفض">
            <Button type="text" danger icon={<CloseCircleOutlined />} disabled={busy}
              onClick={() => { setRejecting(r); setRejectReason(''); }} />
          </Tooltip>
        )}
        {st !== 'rejected' && (
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} disabled={busy}
              onClick={() => openEdit(r)} />
          </Tooltip>
        )}
        <Popconfirm title="هل تريد حذف هذا الاستلام؟ ستعود أرقامه للتداول" onConfirm={() => remove(r)}>
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />} disabled={busy} />
          </Tooltip>
        </Popconfirm>
      </Space>
    );
  };

  const statusChip = (e: Entry) => {
    switch (e.status) {
      case 'valid':
        return <Tag color="green">سليم</Tag>;
      case 'unknown':
        return <Tag color="red">غير مصروف من النظام</Tag>;
      case 'wrong_kind':
        return (
          <Tag color="red">
            ليس تحت فئة {kindLabel(e.couponKind || kind)}
            {e.kinds && e.kinds.length
              ? ` — موجود تحت ${e.kinds.map(kindLabel).join(' + ')}` : ''}
          </Tag>
        );
      case 'ambiguous':
        return <Tag color="volcano">مصروف تحت أكثر من فئة</Tag>;
      case 'received':
        return <Tag color="orange">مُستلَم من قبل</Tag>;
      case 'checking':
        return <Tag>جارٍ التحقق…</Tag>;
      default:
        return <Tag color="geekblue">ستتم مراجعته عند المزامنة</Tag>;
    }
  };

  const listColumns = [
    { title: 'رقم المستند', dataIndex: 'document_number',
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'مُستلَم من', dataIndex: 'customer_id',
      render: (id: number | null) => customerName(id) },
    { title: 'الفئة', dataIndex: 'declared_kind',
      render: (v: string | null) => (v ? <Tag color="gold">{kindLabel(v)}</Tag> : '-') },
    { title: 'التاريخ', dataIndex: 'received_date',
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'عدد الكوبونات', dataIndex: 'coupon_count',
      render: (v: number) => <b style={{ color: '#F5A11D' }}>{v}</b> },
    { title: 'ملاحظات', dataIndex: 'notes', render: (v: string) => v || '-' },
    { title: 'الحالة', dataIndex: 'status', key: 'status',
      render: (_: any, r: Receipt) => statusTag(r) },
    ...(canManage ? [{
      title: 'الإجراءات', key: 'actions', width: 150, fixed: 'left' as const,
      render: (_: any, r: Receipt) => rowActions(r),
    }] : []),
  ];

  const listCols = useTableColumns('coupon-receipts', listColumns, {
    export: { name: 'سجل الاستلامات', rows: receipts },
  });

  const [tabRaw, setTab] = useQueryTab('receive');
  const tab = (tabRaw === 'history' ? 'history' : 'receive') as 'receive' | 'history';

  const receiveActions = (
    <>
      <Button type="primary" className="sl-create" icon={<SaveOutlined />} loading={saving}
        disabled={!counted.length || !!rejects.length || !kind || !customerId}
        onClick={save}>
        تسجيل الاستلام
      </Button>
      <Button
        icon={<ReloadOutlined />}
        onClick={() => {
          setEntries([]); setNotes(''); setCustomerId(undefined); setKind('');
          setValue(null);
        }}
      >
        تفريغ
      </Button>
    </>
  );

  const receiveTab = (
    <>
      <Row gutter={[8, 8]}>
        <Col xs={24} md={5}>
          <DatePicker
            style={{ width: '100%' }} allowClear={false} format="YYYY/MM/DD"
            placeholder="تاريخ الاستلام"
            value={receivedDate} onChange={(d) => d && setReceivedDate(d)}
            disabledDate={(d) => d.isAfter(dayjs().add(1, 'day'), 'day')}
          />
        </Col>
        <Col xs={12} md={5}>
          <Select
            style={{ width: '100%' }} showSearch
            placeholder="فئة الكوبون"
            status={!kind ? 'warning' : undefined}
            disabled={entries.length > 0}
            value={kind || undefined} onChange={handleKindChange}
            options={kindOptions.map((k) => ({ value: k.value, label: k.label }))} filterOption={searchFilter} filterSort={searchRank}/>
        </Col>
        <Col xs={12} md={4}>
          <InputNumber
            style={{ width: '100%' }} placeholder="قيمة الكوبون" min={0} value={value} onChange={(v) => setValue(v as number | null)}
          />
        </Col>
        <Col xs={24} md={10}>
          <Input
            style={{ width: '100%' }} readOnly addonBefore="صُرف له"
            placeholder="التاجر الذي صُرف له"
            value={issuedToText}
          />
        </Col>
      </Row>

      <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
        <Col xs={24} md={8}>
          <Segmented
            style={{ width: '100%', display: 'flex' }}
            value={customerType}
            onChange={(v) => { setCustomerType(v as string); setCustomerId(undefined); }}
            options={[
              { value: 'plumber', label: 'استلام من سباك' },
              { value: 'merchant', label: 'استلام من تاجر' },
            ]}
          />
        </Col>
        <Col xs={24} md={16}>
          <Select
            allowClear showSearch style={{ width: '100%' }}
            placeholder="الاستلام من"
            status={!customerId ? 'warning' : undefined}
            value={customerId} onChange={setCustomerId}
            options={receiverOptions}
            notFoundContent="لا يوجد عميل بهذا الاسم" filterOption={searchFilter} filterSort={searchRank}/>
        </Col>
      </Row>

      <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
        <Col xs={8} md={4}>
          <InputNumber
            style={{ width: '100%' }} placeholder="من رقم" precision={0}
            value={rangeFrom} onChange={(v) => setRangeFrom(v as number | null)}
            onPressEnter={addRange} disabled={!kind}
          />
        </Col>
        <Col xs={8} md={4}>
          <InputNumber
            style={{ width: '100%' }} placeholder="إلى رقم (اختياري)" precision={0}
            value={rangeTo} onChange={(v) => setRangeTo(v as number | null)}
            onPressEnter={addRange} disabled={!kind}
          />
        </Col>
        <Col xs={8} md={4}>
          <Button type="primary" icon={<PlusOutlined />} onClick={addRange} block
            disabled={!kind}>
            إضافة
          </Button>
        </Col>
      </Row>

      {customerId != null && (
        <Alert type="success" showIcon={false} style={{ marginTop: 8 }}
          message={`الاستلام من: ${customerName(customerId)}`} />
      )}

      <Table<Entry>
        className="sl-table"
        rowKey="serial" size="small" dataSource={entries} pagination={false}
        locale={{ emptyText: 'لا توجد كوبونات مضافة' }}
        scroll={{ y: 320 }} style={{ marginTop: 12 }}
        columns={[
          {
            title: 'رقم الكوبون',
            dataIndex: 'serial',
            width: 140,
            render: (v: string) => <b style={{ color: '#1677ff' }}>{v}</b>,
          },
          {
            title: 'التاجر الذي صُرف له',
            key: 'issued_to',
            render: (_: any, r: Entry) => {
              const name = r.issuedToName || (r.issuedToId ? customerName(r.issuedToId) : null);
              if (!name) return <span style={{ color: '#555b65' }}>-</span>;
              return (
                <Tag color="cyan" style={{ fontSize: 15, padding: '2px 8px' }}>
                  {name}
                </Tag>
              );
            },
          },
          {
            title: 'الفاتورة الأصلية',
            dataIndex: 'documentNumber',
            width: 150,
            render: (v: string) => (v ? <Tag color="default">{v}</Tag> : <span style={{ color: '#555b65' }}>-</span>),
          },
          {
            title: 'حالة الكوبون',
            dataIndex: 'status',
            width: 140,
            render: (_: any, r: Entry) => statusChip(r),
          },
          {
            title: '',
            width: 50,
            render: (_: any, r: Entry) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setEntries((prev) => prev.filter((e) => e.serial !== r.serial))}
              />
            ),
          },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        <CouponStatsOverview
          totalCount={counted.length}
          totalValue={totalValue}
          currentKind={kind ? kindLabel(kind) : undefined}
          kinds={kindOptions.map((k) => ({
            key: k.value,
            label: k.label,
            count: counted.filter((e) => (e.couponKind || kind) === k.value).length,
          }))}
        />
      </div>

      <Input.TextArea rows={2} placeholder="ملاحظات (اختياري)" value={notes}
        style={{ marginTop: 8 }} onChange={(e) => setNotes(e.target.value)} />

      {rejects.length > 0 && (
        <Alert type="error" showIcon style={{ marginTop: 12 }}
          message={`يوجد ${rejects.length} كوبون مرفوض`}
          description="احذفها من القائمة أولاً؛ فالكوبون الخاطئ الواحد يرفض الاستلام كله." />
      )}
      {issuedToNames.length > 1 && (
        <Alert type="info" showIcon style={{ marginTop: 12 }}
          message="هذه الكوبونات مصروفة لأكثر من تاجر" />
      )}

      <div style={{ marginTop: 12 }}>
        <Typography.Text strong type={rejects.length ? 'danger' : 'success'}>
          مقبول {good.length}
          {offline.length > 0 ? ` · بانتظار الاتصال ${offline.length}` : ''}
          {rejects.length ? ' · يوجد مرفوض' : ''}
        </Typography.Text>
      </div>
    </>
  );

  const detailBody = detail && (
    <>
      <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="رقم المستند">
          <Tag>{detail.document_number}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="مُستلَم من">
          {customerName(detail.customer_id)}
          {detail.customer_type ? (
            <Tag style={{ marginInlineStart: 6 }}>
              {detail.customer_type === 'plumber' ? 'سباك' : 'تاجر'}
            </Tag>
          ) : null}
        </Descriptions.Item>
        <Descriptions.Item label="فئة الكوبون">
          {detail.declared_kind ? <Tag color="gold">{kindLabel(detail.declared_kind)}</Tag> : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="التاريخ">
          {detail.received_date ? String(detail.received_date).slice(0, 10) : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="العدد">{detail.coupon_count}</Descriptions.Item>
        <Descriptions.Item label="الحالة">{statusTag(detail)}</Descriptions.Item>
        <Descriptions.Item label="ملاحظات" span={2}>{detail.notes || '-'}</Descriptions.Item>
      </Descriptions>
      {detail.status === 'pending' && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="هذا الاستلام وارد من التطبيق وبانتظار الاعتماد" />
      )}
      {detail.status === 'rejected' && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }}
          message={detail.reject_reason ? `مرفوض — السبب: ${detail.reject_reason}` : 'تم رفض هذا الاستلام'}
          description={detail.rejected_serials && detail.rejected_serials.length
            ? `الأرقام التي كانت عليه (أُعيدت متاحة للاستلام): ${detail.rejected_serials.join('، ')}`
            : undefined} />
      )}
      {detail.lines.length ? (
        <Table
          rowKey="id" size="small" dataSource={detail.lines} pagination={false}
          columns={[
            { title: 'رقم الكوبون', dataIndex: 'serial',
              render: (v: string) => <b>{v}</b> },
            { title: 'الفئة', dataIndex: 'coupon_kind',
              render: (v: string | null) => (v ? <Tag color="gold">{kindLabel(v)}</Tag>
                : <Tag>غير محددة</Tag>) },
            { title: 'من فاتورة', dataIndex: 'sales_invoice_id',
              render: (v: number | null, r: ReceiptLineOut) => (v
                ? <DocumentLink kind="invoice" id={v} size="small" label={`#${v}`}
                    onNavigate={() => setDetail(null)} />
                : r.coupon_issue_id ? <Tag color="blue">مستند صرف #{r.coupon_issue_id}</Tag>
                  : <Tag>غير معروفة</Tag>) },
          ]}
        />
      ) : <Empty description="لا توجد سطور" />}
    </>
  );

  const historyTab = detail ? (
    <>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setDetail(null)}>رجوع</Button>
          <b>{detail.document_number}</b>
        </Space>
        <Space>
          {rowActions(detail)}
          <Button onClick={() => setDetail(null)}>إغلاق</Button>
        </Space>
      </Space>
      {detailBody}
    </>
  ) : (
    <>
      <Segmented
        style={{ marginBottom: 12 }}
        value={statusFilter}
        onChange={(v) => { setStatusFilter(v as 'all' | ReceiptStatus); setPage(1); }}
        options={[
          { value: 'all', label: `الكل (${Object.values(summaryData.status_counts || {}).reduce((a, b) => a + b, 0)})` },
          ...(Object.keys(RECEIPT_STATUS) as ReceiptStatus[]).map((k) => ({
            value: k,
            label: (
              <span>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4,
                  background: RECEIPT_STATUS[k].dot, marginInlineEnd: 6 }} />
                {RECEIPT_STATUS[k].text} ({summaryData.status_counts?.[k] ?? 0})
              </span>
            ),
          })),
        ]}
      />
      <CouponStatsOverview
        totalCount={summaryData.total_coupons}
        totalValue={summaryData.total_value}
        kinds={kindOptions.map((k) => ({
          key: k.value,
          label: k.label,
          count: summaryData.kind_counts[k.value] || 0,
        }))}
      />
      <Table<Receipt>
        className="sl-table"
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={receipts}
        {...allRows(fetchAllReceipts)}
        onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد استلامات' }}
        pagination={{
          current: page,
          pageSize,
          total: totalCount,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            loadReceipts(p, ps, searchQuery);
          },
          showTotal: (t) => (
            <span className="sl-foot">
              <span>إجمالي الاستلامات: <b>{t.toLocaleString(numeralsLocale())}</b></span>
              <span>المعروض: <b>{receipts.length.toLocaleString(numeralsLocale())}</b></span>
            </span>
          ),
        }}
        columns={listCols.columns}
      />
    </>
  );

  const searchRef = useRef<any>(null);
  const listShown = tab === 'history' && !detail;
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } }, listShown);

  return (
    <ListPage<'receive' | 'history'>
      icon={<TagsOutlined />}
      title="استلام الكوبونات"
      tabs={[
        { key: 'receive', label: 'استلام كوبونات' },
        { key: 'history',
          label: (summaryData.status_counts?.pending ?? 0) > 0 ? (
            <span>السجل <Tag color="warning" style={{ marginInlineStart: 4 }}>
              {summaryData.status_counts?.pending} بانتظار الاعتماد</Tag></span>
          ) : 'السجل',
          count: totalCount },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      actions={(<>
        {tab === 'receive' && receiveActions}
        {listShown && (<>
          <Button type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => setTab('receive')}>
            استلام جديد
          </Button>
          {listCols.control}
          <Button icon={<ReloadOutlined />} onClick={() => loadReceipts()}>تحديث</Button>
        </>)}
        <Button icon={<SettingOutlined />} onClick={() => navigate('/loyalty?tab=kinds')}>
          إدارة أنواع وفئات الكوبونات
        </Button>
      </>)}
      filters={listShown ? (<>
        <Input
          className="sl-f-search"
          ref={searchRef}
          allowClear
          prefix={<SearchOutlined />}
          placeholder="بحث برقم المستند أو رقم كوبون أو اسم العميل"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={() => setSearchQuery('')}>
          مسح
        </Button>
      </>) : undefined}
    >
      {tab === 'receive' ? receiveTab : historyTab}

      <Modal
        open={!!rejecting} title={rejecting ? `رفض ${rejecting.document_number}` : 'رفض'}
        okText="رفض" okButtonProps={{ danger: true, loading: acting === rejecting?.id }}
        cancelText="رجوع" onOk={reject}
        onCancel={() => { setRejecting(null); setRejectReason(''); }}
      >
        <Input.TextArea rows={3} autoFocus placeholder="سبب الرفض (اختياري)"
          value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>

      <Modal
        open={!!editing} width={720}
        title={editing ? `تعديل ${editing.document_number}` : 'تعديل'}
        okText="حفظ التعديل" cancelText="رجوع"
        okButtonProps={{ icon: <SaveOutlined />, loading: editSaving }}
        onOk={saveEdit} onCancel={() => setEditing(null)}
        destroyOnClose
      >
        {editing?.status === 'approved' && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="هذا الاستلام معتمد — يُحتسب التعديل فوراً في التقارير" />
        )}
        <Row gutter={[8, 8]}>
          <Col xs={24} md={8}>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" placeholder="تاريخ الاستلام"
              value={editDate} onChange={(d) => setEditDate(d)}
              disabledDate={(d) => d.isAfter(dayjs().add(1, 'day'), 'day')} />
          </Col>
          <Col xs={12} md={8}>
            <Select style={{ width: '100%' }} showSearch placeholder="فئة الكوبون"
              value={editKind || undefined} onChange={(v) => setEditKind(v)}
              options={kindOptions.map((k) => ({ value: k.value, label: k.label }))}
              filterOption={searchFilter} filterSort={searchRank} />
          </Col>
          <Col xs={12} md={8}>
            <InputNumber style={{ width: '100%' }} placeholder="قيمة الكوبون" min={0}
              value={editValue} onChange={(v) => setEditValue(v as number | null)} />
          </Col>
          <Col xs={24}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="مُستلَم من"
              value={editCustomer} onChange={setEditCustomer}
              options={receiverOptions} filterOption={searchFilter} filterSort={searchRank} />
          </Col>
          <Col xs={24}>
            <Typography.Text type="secondary">أرقام الكوبونات ({editSerials.length})</Typography.Text>
            <Select mode="tags" style={{ width: '100%' }} open={false}
              placeholder="اكتب رقم الكوبون واضغط Enter"
              tokenSeparators={[',', ' ', '،']}
              value={editSerials}
              onChange={(v) => setEditSerials(Array.from(new Set((v as string[])
                .map((s) => String(s).trim()).filter(Boolean))))} />
          </Col>
          <Col xs={8}>
            <InputNumber style={{ width: '100%' }} placeholder="من رقم" precision={0}
              value={editFrom} onChange={(v) => setEditFrom(v as number | null)}
              onPressEnter={addEditRange} />
          </Col>
          <Col xs={8}>
            <InputNumber style={{ width: '100%' }} placeholder="إلى رقم (اختياري)"
              precision={0} value={editTo} onChange={(v) => setEditTo(v as number | null)}
              onPressEnter={addEditRange} />
          </Col>
          <Col xs={8}>
            <Button block icon={<PlusOutlined />} onClick={addEditRange}>إضافة</Button>
          </Col>
          <Col xs={24}>
            <Input.TextArea rows={2} placeholder="ملاحظات" value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)} />
          </Col>
        </Row>
      </Modal>
    </ListPage>
  );
}
