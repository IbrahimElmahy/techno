import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Input, Row, Segmented, Select,
  Space, Statistic, Table, Tabs, Tag, Typography, message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { InputNumber } from '../components/NumberInput';
import {
  DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, ArrowLeftOutlined, SettingOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DocumentLink from '../components/DocumentLink';
import ListToolbar from '../components/ListToolbar';
import { useLookup } from '../hooks/useLookup';
import CouponStatsOverview from '../components/CouponStatsOverview';

// `wrong_kind` = الرقم متصرّف فعلاً، بس تحت فئة تانية. مش «مش موجود»، والفرق ده
// هو اللي بيخلّي اللي بيدخل يبص على الورقة تاني بدل ما يفتكر إنها مزوّرة.
type Status = 'valid' | 'unknown' | 'received' | 'checking' | 'pending'
  | 'wrong_kind' | 'ambiguous';

interface Entry {
  serial: string;
  status: Status;
  // الطرف اللي **اتصرفت له** الورقة — التاجر غالباً. مش اللي بيسلّمها دلوقتي.
  issuedToId?: number | null;
  issuedToName?: string | null;
  documentNumber?: string | null;
  // الفئة اللي الرقم اتفحص تحتها (اللي المستخدم اختارها).
  couponKind?: string | null;
  // الفئات اللي الرقم متصرّف تحتها فعلاً — بتتقال في رسالة الرفض.
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
  lines: ReceiptLineOut[];
}

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
  // أنواع العملاء زي ما الأدمن ظابطها — مش مكتوبة في الكود، عشان النوع المضاف من
  // الإعدادات يبان باسمه في قايمة «بستلم من مين».
  const { options: customerTypeLookup } = useLookup('customer_type');

  // مصدر واحد لفئات الورق: قائمة «فئات الكوبونات» في الإعدادات.
  //
  // كانت بتتاخد من كتالوج استبدال النقاط الأول والقائمة دي بديل — وده اللي خلّى فيه
  // مكانين بيتحكموا في نفس الحاجة وهما مش نفس الحاجة أصلاً.
  const kindOptions = useMemo(
    () => (kindLookup || []).map((o) => ({
      value: o.value, label: o.label, defaultValue: 0,
    })),
    [kindLookup]);

  // ⛔ مافيش فئة افتراضية بتتحط لوحدها.
  //
  // الفئة مكتوبة على الورقة اللي في إيد اللي بيستلم، والنظام مايعرفهاش. لما كانت
  // بتتحط على أول فئة في القايمة، أول رقم يتدخّل كان بيتفحص تحت «عادي» وهو ذهبي —
  // والورقة تتحسب على دفتر مش بتاعها ومحدش ياخد باله. الفاضي هنا سؤال مقصود.

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
  }

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
      const params: Record<string, any> = {};
      if (q.trim()) params.q = q.trim();
      const res = await api.get<ReceiptsSummary>('/api/v1/coupon-receipts/summary', { params });
      setSummaryData({
        total_receipts: Number(res.data.total_receipts || 0),
        total_coupons: Number(res.data.total_coupons || 0),
        total_value: Number(res.data.total_value || 0),
        kind_counts: res.data.kind_counts || {},
      });
    } catch {
      // ignore
    }
  }, [searchQuery]);

  const loadReceipts = useCallback(async (targetPage = page, targetPageSize = pageSize, q = searchQuery) => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        limit: targetPageSize,
        offset: (targetPage - 1) * targetPageSize,
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
      setLoading(false);
    }
  }, [page, pageSize, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      loadReceipts(1, pageSize, searchQuery);
      loadSummary(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    api.get('/api/v1/customers').then((r) => setCustomers(r.data || [])).catch(console.error);
  }, []);

  const customerName = (id: number | null) =>
    customers.find((c) => c.id === id)?.name ?? (id ? `عميل #${id}` : '-');

  const addSerial = async (raw: string) => {
    const serial = String(raw).trim();
    if (!serial) return;
    if (!kind) { message.warning('اختر فئة الكوبون الأول'); return; }
    if (entries.some((e) => e.serial === serial)) {
      message.warning('الكوبون ده مضاف بالفعل');
      return;
    }
    setEntries((prev) => [{ serial, status: 'checking', couponKind: kind }, ...prev]);
    try {
      // الفئة بتتبعت مع كل رقم: البحث بيتضيّق عليها، فـ«٥ فضي» مابيلاقيش دفتر الذهبي.
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
      if (st === 'unknown') message.warning(`الكوبون ${serial} مش متصرّف من النظام`);
      if (st === 'received') message.warning(`الكوبون ${serial} مُستلَم من قبل`);
      if (st === 'wrong_kind') {
        // ❌ الرفض مقصود، والتصحيح الأوتوماتيكي ممنوع: لو غيّرنا الفئة لوحدنا
        // رجعنا لنفس المشكلة — ورقة بتتحسب على دفتر مش بتاعها ومحدش واخد باله.
        const where = ((d.kinds || []) as string[]).map(kindLabel).join(' + ');
        message.error(
          `الكوبون ${serial} مش متصرّف تحت فئة ${kindLabel(kind)}`
          + (where ? `. موجود تحت: ${where}` : ''));
      }
      if (st === 'ambiguous') {
        message.warning(`الكوبون ${serial} متصرّف تحت أكتر من فئة — راجع الورقة`);
      }
    } catch (err: any) {
      setEntries((prev) => prev.map((e) => (e.serial === serial ? { ...e, status: 'pending' } : e)));
      message.warning(`الكوبون ${serial} هيتراجع مع الحفظ (${err?.message || 'انقطاع'})`);
    }
  };

  const addRange = async () => {
    if (!kind) { message.warning('اختر فئة الكوبون الأول'); return; }
    if (rangeFrom === null || rangeTo === null) { message.warning('النطاق لازم يكون أرقام'); return; }
    if (rangeTo < rangeFrom) { message.warning('رقم النهاية أصغر من البداية'); return; }
    if (rangeTo - rangeFrom + 1 > 2000) { message.warning('النطاق كبير — أقصى ٢٠٠٠ كوبون في المرة'); return; }
    const from = rangeFrom; const to = rangeTo;
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
  // ⛔ مافيش تحقّق «كوبونات متصرّفة لعميل تاني» هنا، وده مقصود.
  //
  // الدورة: الشركة بتصرف للتاجر ← التاجر بيدّي الفني ← الفني بيرجّع لينا. يبقى
  // الاستلام من سباك لورقة اتصرفت لتاجر هو **الحالة الطبيعية** مش خطأ. التحقق اللي
  // كان هنا كان بيرفض أكتر استلام بيحصل فعلاً، وبيجبر اللي بيدخل يحط اسم التاجر
  // مكان اللي واقف قدامه.
  const issuedToNames = Array.from(
    new Set(counted.map((e) => e.issuedToName).filter(Boolean) as string[]));
  const issuedToText = issuedToNames.length === 0 ? ''
    : issuedToNames.length <= 2 ? issuedToNames.join(' + ')
      : `أكتر من تاجر (${issuedToNames.length})`;
  const totalValue = (value ?? 0) * counted.length;

  // «بستلم منه» **مابيتفلترش** — النوع المختار بيرتّب بس.
  //
  // `customer_type` قايمة حرة يديرها الأدمن (فيها `owner` و`other` ونوع أي حد يضيفه)،
  // وفلترة القايمة على نوعين كانت بتخفي كل عميل غير كده — يعني الاستلام منه يبقى
  // مستحيل خالص وهو واقف بالورق. اللي بيتصرف هنا الترتيب: النوع المختار فوق،
  // والباقي تحته، والنوع مكتوب جنب الاسم عشان اللي بيدخل يفرّق.
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
        || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ar');
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
    if (rejects.length) { message.warning('شيل الكوبونات المرفوضة الأول'); return; }
    if (!kind) { message.warning('اختر فئة الكوبون الأول'); return; }
    // اللي بنستلم منه لازم يتقال. مش استنتاج — هو الواقف قدام اللي بيدخل دلوقتي.
    if (!customerId) { message.warning('حدد بتستلم من مين'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/coupon-receipts', {
        serials: counted.map((e) => e.serial),
        customer_id: customerId ?? null,
        notes: notes.trim() || null,
        client_uuid: clientUuid.current,
        received_date: receivedDate.format('YYYY-MM-DD'),
        declared_kind: kind,
        // الفئة دي هوية الورقة مش تصريح وخلاص — من غيرها بتتخزن السطور بفئة فاضية
        // وقيد التفرّد (فئة، رقم) بيرجع يشتغل على الرقم لوحده.
        coupon_kind: kind,
        declared_value: value,
        customer_type: customerType,
      });
      message.success('تم تسجيل الاستلام ورفعه إلى الخادم');
      // ⛔ والفئة بترجع فاضية زي كل حاجة تانية.
      //
      // المستند الواحد دفتر واحد، والمستند اللي بعده قرار جديد. لو سابناها، المندوب
      // اللي خلّص ٥٠ ذهبي وبدأ على طول في دفتر فضي بيلاقي الحقل مفتوح وفيه «ذهبي»،
      // وأول رقم يتفحص تحت الدفتر الغلط. الفاضي هنا سؤال مقصود — بيرجّع تحذير
      // «اختر فئة الكوبون الأول» ويقفل حقول النطاق لحد ما يتقرر.
      setEntries([]); setNotes(''); setCustomerId(undefined); setKind('');
      setValue(null); setCustomerType('plumber');
      setReceivedDate(dayjs());
      clientUuid.current = crypto.randomUUID();
      loadReceipts();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الاستلام');
    } finally { setSaving(false); }
  };

  const statusChip = (e: Entry) => {
    switch (e.status) {
      case 'valid':
        return <Tag color="green">سليم</Tag>;
      case 'unknown':
        return <Tag color="red">مش متصرّف من النظام</Tag>;
      case 'wrong_kind':
        return (
          <Tag color="red">
            مش تحت فئة {kindLabel(e.couponKind || kind)}
            {e.kinds && e.kinds.length
              ? ` — موجود تحت ${e.kinds.map(kindLabel).join(' + ')}` : ''}
          </Tag>
        );
      case 'ambiguous':
        return <Tag color="volcano">متصرّف تحت أكتر من فئة</Tag>;
      case 'received':
        return <Tag color="orange">مُستلَم من قبل</Tag>;
      case 'checking':
        return <Tag>بيتراجع…</Tag>;
      default:
        return <Tag color="geekblue">هيتراجع مع المزامنة</Tag>;
    }
  };

  const listColumns = [
    { title: 'رقم المستند', dataIndex: 'document_number',
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'اتستلم من', dataIndex: 'customer_id',
      render: (id: number | null) => customerName(id) },
    { title: 'الفئة', dataIndex: 'declared_kind',
      render: (v: string | null) => (v ? <Tag color="gold">{kindLabel(v)}</Tag> : '-') },
    { title: 'التاريخ', dataIndex: 'received_date',
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'عدد الكوبونات', dataIndex: 'coupon_count',
      render: (v: number) => <b style={{ color: '#F5A11D' }}>{v}</b> },
    { title: 'ملاحظات', dataIndex: 'notes', render: (v: string) => v || '-' },
  ];

  const listCols = useTableColumns('coupon-receipts', listColumns);

  // Read-only on purpose: a receipt is the act that spends coupons — un-spending one by editing
  // the paper would leave the system counting a coupon the customer already handed over.

  const receiveTab = (
    <Card
      title="تسجيل استلام جديد"
      extra={(
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              // «تفريغ» بيفضّي الفئة كمان: الشاشة بترجع لسؤالها الأول بدل ما تفضل
              // محطوط عليها دفتر المستند اللي فات.
              setEntries([]); setNotes(''); setCustomerId(undefined); setKind('');
              setValue(null);
            }}
          >
            تفريغ
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving}
            disabled={!counted.length || !!rejects.length || !kind || !customerId}
            onClick={save}>
            تسجيل الاستلام
          </Button>
        </Space>
      )}
    >
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
          {/* ✏️ اختيار — المستخدم هو اللي بيقول الفئة.
              «٥ ذهبي» و«٥ فضي» ورقتين مختلفتين، والرقم لوحده مش هوية. المكتوب على
              الورقة مايعرفوش غير اللي ماسكها، فالحقل ده سؤال ليه مش عرض عليه.
              وبيتقفل بعد أول كوبون: المستند الواحد دفتر واحد. */}
          <Select
            style={{ width: '100%' }} showSearch optionFilterProp="label"
            placeholder="فئة الكوبون — اختر قبل الإدخال"
            status={!kind ? 'warning' : undefined}
            disabled={entries.length > 0}
            value={kind || undefined} onChange={handleKindChange}
            options={kindOptions.map((k) => ({ value: k.value, label: k.label }))}
          />
        </Col>
        <Col xs={12} md={4}>
          <InputNumber
            style={{ width: '100%' }} placeholder="قيمة الكوبون" min={0}
            addonAfter="ج.م" value={value} onChange={(v) => setValue(v as number | null)}
          />
        </Col>
        <Col xs={24} md={10}>
          {/* 👁️ عرض فقط — استنتاج مش إدخال.
              ده الطرف اللي الشركة صرفت له الورقة (التاجر). غير اللي بيسلّمها دلوقتي
              (السباك غالباً)، والاتنين بيتعرضوا مع بعض عشان اللي بيدخل يشوف الفرق. */}
          <Input
            style={{ width: '100%' }} readOnly addonBefore="اتصرف له"
            placeholder="التاجر اللي اتصرف له — بيظهر بعد أول كوبون سليم"
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
              { value: 'plumber', label: 'بستلم من سباك' },
              { value: 'merchant', label: 'بستلم من تاجر' },
            ]}
          />
        </Col>
        <Col xs={24} md={16}>
          {/* ✏️ اختيار — ده اللي واقف قدامي بيسلّم الورق دلوقتي.
              كان بيتكتب لوحده من أول كوبون سليم، يعني اسم التاجر اللي اتصرف له —
              وده طرف تاني خالص. الملء الأوتوماتيكي اتشال عن قصد. */}
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="بستلم من مين"
            status={!customerId ? 'warning' : undefined}
            value={customerId} onChange={setCustomerId}
            options={receiverOptions}
            notFoundContent="مافيش عميل بالاسم ده"
          />
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
            style={{ width: '100%' }} placeholder="إلى رقم" precision={0}
            value={rangeTo} onChange={(v) => setRangeTo(v as number | null)}
            onPressEnter={addRange} disabled={!kind}
          />
        </Col>
        <Col xs={8} md={4}>
          <Button type="primary" icon={<PlusOutlined />} onClick={addRange} block
            disabled={!kind}>
            إضافة النطاق
          </Button>
        </Col>
      </Row>

      {customerId != null && (
        <Alert type="success" showIcon={false} style={{ marginTop: 8 }}
          message={`بستلم من: ${customerName(customerId)}`} />
      )}

      <Table<Entry>
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
            title: 'التاجر اللي اتصرف له',
            key: 'issued_to',
            render: (_: any, r: Entry) => {
              const name = r.issuedToName || (r.issuedToId ? customerName(r.issuedToId) : null);
              if (!name) return <span style={{ color: '#8c8c8c' }}>-</span>;
              return (
                <Tag color="cyan" style={{ fontSize: 13, padding: '2px 8px' }}>
                  {name}
                </Tag>
              );
            },
          },
          {
            title: 'الفاتورة الأصلية',
            dataIndex: 'documentNumber',
            width: 150,
            render: (v: string) => (v ? <Tag color="default">{v}</Tag> : <span style={{ color: '#8c8c8c' }}>-</span>),
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
        {/* المستند الواحد دفتر واحد: الفئة اللي فوق هي فئة كل الأرقام اللي تحت،
            لأن أي رقم مش متصرّف تحتها بيترفض ومابيدخلش أصلاً. */}
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
          message={`فيه ${rejects.length} كوبون مرفوض`}
          description="شيلهم من القائمة الأول — الكوبون الواحد الغلط بيرفض الاستلام كله." />
      )}
      {issuedToNames.length > 1 && (
        <Alert type="info" showIcon style={{ marginTop: 12 }}
          message="الورق ده متصرّف لأكتر من تاجر"
          description="ده مش خطأ — السباك بيجمّع ورق من أكتر من تاجر. متسجّل للعلم بس." />
      )}

      <div style={{ marginTop: 12 }}>
        <Typography.Text strong type={rejects.length ? 'danger' : 'success'}>
          مقبول {good.length}
          {offline.length > 0 ? ` · بانتظار الاتصال ${offline.length}` : ''}
          {rejects.length ? ' · فيه مرفوض' : ''}
        </Typography.Text>
      </div>
    </Card>
  );

  const detailBody = detail && (
    <>
      <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="رقم المستند">
          <Tag>{detail.document_number}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="اتستلم من">
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
        <Descriptions.Item label="ملاحظات" span={2}>{detail.notes || '-'}</Descriptions.Item>
      </Descriptions>
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
    <Card
      title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setDetail(null)}>رجوع</Button>
          <span>{detail.document_number}</span>
        </Space>
      )}
      extra={(
        <Button onClick={() => setDetail(null)}>إغلاق</Button>
      )}
    >
      {detailBody}
    </Card>
  ) : (
    <Card size="small" title="سجل الاستلامات"
      extra={(
        <Space>
          {listCols.control}
          <Button icon={<ReloadOutlined />} onClick={loadReceipts}>تحديث</Button>
        </Space>
      )}>
      <CouponStatsOverview
        totalCount={summaryData.total_coupons}
        totalValue={summaryData.total_value}
        kinds={kindOptions.map((k) => ({
          key: k.value,
          label: k.label,
          count: summaryData.kind_counts[k.value] || 0,
        }))}
      />
      <ListToolbar
        searchPlaceholder="بحث برقم المستند أو رقم كوبون أو اسم العميل"
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onReset={() => setSearchQuery('')}
        total={totalCount}
        shown={receipts.length}
        searchSpan={10}
      />
      <Table<Receipt>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={receipts}
        onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد استلامات' }}
        pagination={{
          current: page,
          pageSize,
          total: totalCount,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            loadReceipts(p, ps, searchQuery);
          },
          showTotal: (t) => `إجمالي ${t} استلام`,
        }}
        columns={listCols.columns}
      />
    </Card>
  );

  return (
    <Card
      title="استلام الكوبونات"
      extra={(
        <Button icon={<SettingOutlined />} onClick={() => navigate('/loyalty?tab=kinds')}>
          إدارة أنواع وفئات الكوبونات
        </Button>
      )}
    >
      <Tabs items={[
        { key: 'receive', label: 'استلام كوبونات', children: receiveTab },
        { key: 'history', label: `السجل (${totalCount})`, children: historyTab },
      ]} />
    </Card>
  );
}
