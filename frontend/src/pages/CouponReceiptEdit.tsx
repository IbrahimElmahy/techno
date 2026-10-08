import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, DatePicker, Input, Segmented, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import {
  ArrowRightOutlined, DeleteOutlined, PlusOutlined, SaveOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { InputNumber } from '../components/NumberInput';
import DocumentLink from '../components/DocumentLink';
import DocOpening from '../components/DocOpening';
import CouponStatsOverview from '../components/CouponStatsOverview';
import { searchFilter, searchRank, compareArabic } from '../utils/arabicSort';
import { repOptions } from '../utils/reps';
import { money } from '../utils/money';

type LineStatus = 'saved' | 'valid' | 'checking' | 'unknown' | 'received' | 'wrong_kind'
  | 'ambiguous' | 'duplicate' | 'empty' | 'error';

interface EditLine {
  key: string;
  id?: number;
  serial: string;
  kind: string | null;
  origSerial?: string;
  origKind?: string | null;
  status: LineStatus;
  documentNumber?: string | null;
  salesInvoiceId?: number | null;
  couponIssueId?: number | null;
  issuedToId?: number | null;
  issuedToName?: string | null;
  kinds?: string[];
}

interface Receiver {
  id: number;
  name: string;
  customer_type?: string | null;
}

interface EditPayload {
  receipt: {
    id: number;
    document_number: string;
    customer_id: number | null;
    rep_user_id: number | null;
    received_date: string | null;
    declared_kind?: string | null;
    declared_value?: string | number | null;
    customer_type?: string | null;
    status?: string;
    source?: string | null;
  };
  lines: {
    id: number;
    serial: string;
    coupon_kind: string | null;
    kind: string | null;
    sales_invoice_id: number | null;
    coupon_issue_id: number | null;
    document_number: string | null;
    issued_to_id: number | null;
    issued_to_name: string | null;
  }[];
  receiver: Receiver | null;
  receiver_note: string | null;
  receiver_suggestion: Receiver | null;
  notes_without_receiver: string | null;
  rep_name: string | null;
}

export interface KindOption {
  value: string;
  label: string;
}

const BAD: LineStatus[] = ['unknown', 'received', 'wrong_kind', 'ambiguous', 'duplicate', 'error'];

const sideOf = (t?: string | null) => (t === 'plumber' ? 'plumber' : 'merchant');

export function receiverOptionsOf(
  customers: any[], customerType: string, typeLabel: (t: unknown) => string,
) {
  const wanted = customerType === 'plumber' ? ['plumber'] : ['trader', 'merchant'];
  return [...customers]
    .sort((a, b) => {
      const rank = (c: any) => (wanted.includes(String(c.customer_type)) ? 0 : 1);
      return rank(a) - rank(b) || compareArabic(a.name, b.name);
    })
    .map((c) => {
      const label = typeLabel(c.customer_type);
      return {
        value: c.id as number,
        label: label ? `${String(c.name)} — ${label}` : String(c.name),
      };
    });
}

let seq = 0;
const nextKey = () => {
  seq += 1;
  return `n${seq}`;
};

export default function CouponReceiptEdit({
  receiptId, customers, kindOptions, customerTypeLabel, onClose, onSaved,
}: {
  receiptId: number;
  customers: any[];
  kindOptions: KindOption[];
  customerTypeLabel: (t: unknown) => string;
  onClose: () => void;
  onSaved: (updated: any) => void;
}) {
  const [data, setData] = useState<EditPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customerType, setCustomerType] = useState<string>('plumber');
  const [repId, setRepId] = useState<number | undefined>();
  const [receivedDate, setReceivedDate] = useState<Dayjs | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [reps, setReps] = useState<any[]>([]);
  const [rangeFrom, setRangeFrom] = useState<number | null>(null);
  const [rangeTo, setRangeTo] = useState<number | null>(null);
  const [rangeKind, setRangeKind] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const checks = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    api.get<EditPayload>(`/api/v1/coupon-receipts/${receiptId}/edit`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        const r = d.receipt;
        const party = d.receiver ?? d.receiver_suggestion;
        setData(d);
        setLines(d.lines.map((l) => ({
          key: `l${l.id}`, id: l.id, serial: l.serial, kind: l.kind,
          origSerial: l.serial, origKind: l.kind, status: 'saved',
          documentNumber: l.document_number, salesInvoiceId: l.sales_invoice_id,
          couponIssueId: l.coupon_issue_id, issuedToId: l.issued_to_id,
          issuedToName: l.issued_to_name,
        })));
        setCustomerId(party?.id ?? undefined);
        setCustomerType(r.customer_type ? sideOf(r.customer_type)
          : party ? sideOf(party.customer_type) : 'plumber');
        setRepId(r.rep_user_id ?? undefined);
        setReceivedDate(r.received_date ? dayjs(r.received_date) : null);
        setValue(r.declared_value != null ? Number(r.declared_value) : null);
        setNotes(d.notes_without_receiver || '');
        const firstKind = r.declared_kind || d.lines.find((l) => l.kind)?.kind || undefined;
        setRangeKind(firstKind ?? undefined);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    api.get('/api/v1/users')
      .then((res) => {
        if (!cancelled) setReps((res.data || []).filter((u: any) => u.role === 'sales_rep'));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [receiptId]);

  const kindLabel = (k?: string | null) => (k
    ? kindOptions.find((o) => o.value === k)?.label ?? k : '');

  const kindChoices = useMemo(() => {
    const extra = Array.from(new Set(lines.map((l) => l.kind).filter(Boolean) as string[]))
      .filter((k) => !kindOptions.some((o) => o.value === k));
    return [...kindOptions, ...extra.map((k) => ({ value: k, label: k }))];
  }, [kindOptions, lines]);

  const receiverOptions = useMemo(() => {
    const opts = receiverOptionsOf(customers, customerType, customerTypeLabel);
    const known = data?.receiver ?? data?.receiver_suggestion;
    if (known && !opts.some((o) => o.value === known.id)) {
      const label = customerTypeLabel(known.customer_type);
      opts.unshift({ value: known.id, label: label ? `${known.name} — ${label}` : known.name });
    }
    return opts;
  }, [customers, customerType, customerTypeLabel, data]);

  const repChoices = useMemo(() => {
    const opts = repOptions(reps, repId);
    if (repId && data?.rep_name && !opts.some((o) => o.value === repId)) {
      opts.unshift({ value: repId, label: data.rep_name });
    }
    return opts;
  }, [reps, repId, data]);

  const unchanged = (l: EditLine) => l.id != null && l.serial === l.origSerial
    && (l.kind ?? null) === (l.origKind ?? null);

  const dupKeys = useMemo(() => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    lines.forEach((l) => {
      if (!l.serial.trim()) return;
      const k = `${l.kind ?? ''}|${l.serial.trim()}`;
      const first = seen.get(k);
      if (first) { dups.add(l.key); dups.add(first); } else seen.set(k, l.key);
    });
    return dups;
  }, [lines]);

  const statusOf = (l: EditLine): LineStatus => {
    if (!l.serial.trim()) return 'empty';
    if (dupKeys.has(l.key)) return 'duplicate';
    if (unchanged(l)) return 'saved';
    return l.status;
  };

  const patch = (key: string, change: Partial<EditLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const verify = async (key: string, serial: string, kind: string | null) => {
    const s = serial.trim();
    if (!s) return;
    const ticket = (checks.current[key] ?? 0) + 1;
    checks.current[key] = ticket;
    patch(key, { status: 'checking' });
    try {
      const res = await api.get('/api/v1/coupon-receipts/check', {
        params: { serial: s, coupon_kind: kind || undefined, receipt_id: receiptId },
      });
      if (checks.current[key] !== ticket) return;
      const d = res.data;
      const st = (d.status as LineStatus) || 'unknown';
      patch(key, {
        status: st,
        documentNumber: d.document_number,
        salesInvoiceId: d.sales_invoice_id,
        couponIssueId: d.coupon_issue_id,
        issuedToId: d.issued_to_id ?? d.customer_id ?? null,
        issuedToName: d.issued_to_name ?? d.customer_name ?? null,
        kinds: (d.kinds || []) as string[],
      });
      if (d.in_custody) {
        message.error(`الكوبون ${s} لا يزال في عهدة المندوب ${d.custody_rep_name || ''}`);
      }
    } catch {
      if (checks.current[key] === ticket) patch(key, { status: 'error' });
    }
  };

  const restoreIfOriginal = (l: EditLine, serial: string, kind: string | null) =>
    l.id != null && serial === l.origSerial && (kind ?? null) === (l.origKind ?? null);

  const commitSerial = (l: EditLine, raw: string) => {
    const serial = raw.trim();
    if (serial === l.serial && l.status !== 'checking' && l.status !== 'error') return;
    if (restoreIfOriginal(l, serial, l.kind)) {
      patch(l.key, { serial, status: 'saved' });
      return;
    }
    patch(l.key, { serial });
    void verify(l.key, serial, l.kind);
  };

  const changeKind = (l: EditLine, kind: string) => {
    if (restoreIfOriginal(l, l.serial, kind)) {
      patch(l.key, { kind, status: 'saved' });
      return;
    }
    patch(l.key, { kind });
    void verify(l.key, l.serial, kind);
  };

  const defaultKind = () => rangeKind
    || lines[lines.length - 1]?.kind || kindOptions[0]?.value || null;

  const addRow = () => {
    const key = nextKey();
    setLines((prev) => [...prev, { key, serial: '', kind: defaultKind(), status: 'empty' }]);
    setTimeout(() => {
      document.querySelector<HTMLInputElement>(`input[data-coupon-row="${key}"]`)?.focus();
    }, 50);
  };

  const addRange = () => {
    const a = rangeFrom ?? rangeTo;
    const b = rangeTo ?? rangeFrom;
    if (a === null || b === null) { message.warning('اكتب رقم الكوبون في «من رقم»'); return; }
    if (b < a) { message.warning('رقم النهاية أصغر من البداية'); return; }
    if (b - a + 1 > 500) { message.warning('النطاق كبير — الحد الأقصى ٥٠٠ كوبون'); return; }
    const kind = defaultKind();
    if (!kind) { message.warning('اختر فئة الكوبون أولاً'); return; }
    const added: EditLine[] = [];
    for (let n = a; n <= b; n += 1) {
      const serial = String(n);
      if (lines.some((l) => l.serial === serial && (l.kind ?? null) === kind)) continue;
      added.push({ key: nextKey(), serial, kind, status: 'checking' });
    }
    setLines((prev) => [...prev, ...added]);
    setRangeFrom(null); setRangeTo(null);
    added.forEach((l) => { void verify(l.key, l.serial, l.kind); });
  };

  const removeRow = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const filled = lines.filter((l) => l.serial.trim());
  const bad = filled.filter((l) => BAD.includes(statusOf(l)));
  const busy = filled.some((l) => statusOf(l) === 'checking');
  const unitValue = value ?? 0;

  const save = async () => {
    if (!data) return;
    if (!filled.length) { message.warning('يجب أن يتضمن الاستلام كوبوناً واحداً على الأقل'); return; }
    if (busy) { message.warning('انتظر حتى ينتهي التحقق من الكوبونات'); return; }
    if (bad.length) { message.warning('صحّح الكوبونات المرفوضة أو احذفها أولاً'); return; }
    if (filled.some((l) => !l.kind)) { message.warning('حدد فئة كل كوبون'); return; }
    if (!customerId) { message.warning('حدد جهة الاستلام'); return; }
    setSaving(true);
    try {
      const res = await api.put(`/api/v1/coupon-receipts/${receiptId}`, {
        lines: filled.map((l) => ({
          id: unchanged(l) ? l.id : null,
          serial: l.serial.trim(),
          coupon_kind: l.kind,
        })),
        customer_id: customerId,
        customer_type: customerType,
        rep_user_id: repId ?? null,
        received_date: receivedDate ? receivedDate.format('YYYY-MM-DD') : null,
        declared_value: value,
        notes: notes.trim() || null,
      });
      message.success(`تم تعديل ${data.receipt.document_number}`);
      onSaved(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ التعديل');
    } finally { setSaving(false); }
  };

  const statusChip = (l: EditLine) => {
    switch (statusOf(l)) {
      case 'saved': return <Tag color="green">مسجل</Tag>;
      case 'valid': return <Tag color="green">سليم</Tag>;
      case 'checking': return <Tag>جارٍ التحقق…</Tag>;
      case 'unknown': return <Tag color="red">غير مصروف من النظام</Tag>;
      case 'received': return <Tag color="orange">مُستلَم من قبل</Tag>;
      case 'wrong_kind':
        return (
          <Tooltip title={l.kinds?.length ? `موجود تحت: ${l.kinds.map(kindLabel).join(' + ')}` : undefined}>
            <Tag color="red">ليس تحت هذه الفئة</Tag>
          </Tooltip>
        );
      case 'ambiguous': return <Tag color="volcano">مصروف تحت أكثر من فئة</Tag>;
      case 'duplicate': return <Tag color="red">مكرر</Tag>;
      case 'empty': return <Tag>أدخل الرقم</Tag>;
      default: return <Tag color="red">تعذر التحقق</Tag>;
    }
  };

  if (failed) {
    return (
      <div className="sale-doc">
        <Alert type="error" showIcon message="تعذر فتح الاستلام"
          action={<Button onClick={onClose}>رجوع</Button>} />
      </div>
    );
  }
  if (!data) return <DocOpening />;

  const r = data.receipt;
  const pickedFromNote = !data.receiver && !!data.receiver_note;

  const columns = [
    { title: 'م', key: 'idx', width: 50, filterable: false,
      render: (_: any, __: EditLine, i: number) => i + 1 },
    {
      title: 'رقم الكوبون', dataIndex: 'serial', key: 'serial', width: 200,
      render: (_: any, l: EditLine) => (
        <Input
          key={`${l.key}:${l.serial}`}
          data-coupon-row={l.key}
          defaultValue={l.serial}
          placeholder="رقم الكوبون"
          status={BAD.includes(statusOf(l)) ? 'error' : undefined}
          onBlur={(e) => commitSerial(l, e.target.value)}
          onPressEnter={(e) => {
            e.preventDefault();
            commitSerial(l, (e.target as HTMLInputElement).value);
            const idx = lines.findIndex((x) => x.key === l.key);
            const next = lines[idx + 1];
            if (next) {
              document.querySelector<HTMLInputElement>(`input[data-coupon-row="${next.key}"]`)?.focus();
            } else {
              addRow();
            }
          }}
        />
      ),
    },
    {
      title: 'الفئة', dataIndex: 'kind', key: 'kind', width: 150,
      render: (_: any, l: EditLine) => (
        <Select
          style={{ width: '100%' }} showSearch placeholder="الفئة"
          value={l.kind || undefined}
          status={!l.kind ? 'warning' : undefined}
          onChange={(v) => changeKind(l, v)}
          options={kindChoices} filterOption={searchFilter} filterSort={searchRank}
        />
      ),
    },
    {
      title: 'صُرف له', dataIndex: 'issuedToName', key: 'issued_to', width: 220, ellipsis: true,
      render: (v: string | null) => (v ? <Tag color="cyan">{v}</Tag>
        : <span style={{ color: '#555b65' }}>-</span>),
    },
    {
      title: 'مستند الصرف', dataIndex: 'documentNumber', key: 'source_doc', width: 160,
      render: (v: string | null, l: EditLine) => {
        if (l.salesInvoiceId) {
          return <DocumentLink kind="invoice" id={l.salesInvoiceId} size="small" label={v || `#${l.salesInvoiceId}`} />;
        }
        return v ? <Tag color="blue">{v}</Tag> : <span style={{ color: '#555b65' }}>-</span>;
      },
    },
    {
      title: 'القيمة', key: 'value', width: 120,
      render: (_: any, l: EditLine) => (l.serial.trim() ? money(unitValue) : '-'),
    },
    {
      title: 'الحالة', key: 'status', width: 150,
      render: (_: any, l: EditLine) => statusChip(l),
    },
    {
      title: '', key: 'remove', width: 50, filterable: false,
      render: (_: any, l: EditLine) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeRow(l.key)} />
      ),
    },
  ];

  return (
    <div className="sale-doc">
      <div className="sale-card sale-head">
        <div className="sale-head-row">
          <Button size="small" icon={<ArrowRightOutlined />} onClick={onClose}>رجوع إلى السجل</Button>
          <span className="sale-title">تعديل استلام كوبونات <b dir="ltr">{r.document_number}</b></span>
          {r.status === 'pending' && <Tag color="warning">بانتظار الاعتماد</Tag>}
          {r.status !== 'pending' && <Tag color="success">تم الاعتماد</Tag>}
          {r.source === 'app' && <Tag color="blue">من التطبيق</Tag>}
          <div className="sale-toolbar-row">
            <Button onClick={onClose}>إلغاء</Button>
            <Button data-shortcut="F9" type="primary" icon={<SaveOutlined />} loading={saving}
              disabled={busy} onClick={save}>
              حفظ التعديل
            </Button>
          </div>
        </div>
      </div>

      <div className="sale-form">
        <div className="sale-card">
          {pickedFromNote && (
            <Alert
              style={{ marginBottom: 10 }} showIcon
              type={data.receiver_suggestion ? 'info' : 'warning'}
              message={data.receiver_suggestion
                ? `المستلم مأخوذ من البيان: «${data.receiver_note}» — حُدد حسابه «${data.receiver_suggestion.name}»`
                : `المستلم مأخوذ من البيان: «${data.receiver_note}» — لا يوجد حساب مطابق، اختر الحساب`}
            />
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ minWidth: 160 }}>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>تاريخ الاستلام</div>
              <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
                value={receivedDate} onChange={(d) => d && setReceivedDate(d)}
                disabledDate={(d) => d.isAfter(dayjs().add(1, 'day'), 'day')} />
            </div>
            <div style={{ minWidth: 220 }}>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>نوع المستلم</div>
              <Segmented
                block value={customerType}
                onChange={(v) => setCustomerType(String(v))}
                options={[
                  { value: 'plumber', label: 'استلام من سباك' },
                  { value: 'merchant', label: 'استلام من تاجر' },
                ]}
              />
            </div>
            <div style={{ flex: '1 1 300px', minWidth: 240 }}>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>المستلم منه</div>
              <Select
                showSearch style={{ width: '100%' }} placeholder="الاستلام من"
                status={!customerId ? 'warning' : undefined}
                value={customerId} onChange={setCustomerId}
                options={receiverOptions}
                notFoundContent="لا يوجد عميل بهذا الاسم"
                filterOption={searchFilter} filterSort={searchRank} />
            </div>
            <div style={{ minWidth: 200 }}>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>المندوب</div>
              <Select
                allowClear showSearch style={{ width: '100%' }} placeholder="المندوب"
                value={repId} onChange={setRepId}
                options={repChoices} filterOption={searchFilter} filterSort={searchRank} />
            </div>
            <div style={{ minWidth: 140 }}>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>قيمة الكوبون</div>
              <InputNumber style={{ width: '100%' }} min={0} placeholder="قيمة الكوبون"
                value={value} onChange={(v) => setValue(v as number | null)} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>ملاحظات</div>
            <Input.TextArea rows={2} value={notes} placeholder="اختياري"
              onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="sale-card">
          <Space wrap style={{ marginBottom: 10 }}>
            <Button icon={<PlusOutlined />} onClick={addRow}>إضافة سطر</Button>
            <Select
              style={{ width: 150 }} showSearch placeholder="فئة الإضافة"
              value={rangeKind} onChange={setRangeKind}
              options={kindChoices} filterOption={searchFilter} filterSort={searchRank} />
            <InputNumber style={{ width: 130 }} placeholder="من رقم" precision={0}
              value={rangeFrom} onChange={(v) => setRangeFrom(v as number | null)}
              onPressEnter={addRange} />
            <InputNumber style={{ width: 150 }} placeholder="إلى رقم (اختياري)" precision={0}
              value={rangeTo} onChange={(v) => setRangeTo(v as number | null)}
              onPressEnter={addRange} />
            <Button onClick={addRange}>إضافة نطاق</Button>
          </Space>

          <Table<EditLine>
            className="sl-table"
            rowKey="key" size="small" dataSource={lines} pagination={false}
            tableLayout="fixed"
            locale={{ emptyText: 'لا توجد كوبونات' }}
            columns={columns}
          />

          {bad.length > 0 && (
            <Alert type="error" showIcon style={{ marginTop: 10 }}
              message={`يوجد ${bad.length} كوبون مرفوض — صحّحه أو احذفه قبل الحفظ`} />
          )}

          <div style={{ marginTop: 12 }}>
            <CouponStatsOverview
              totalCount={filled.length}
              totalValue={unitValue * filled.length}
              kinds={kindChoices.map((k) => ({
                key: k.value,
                label: k.label,
                count: filled.filter((l) => l.kind === k.value).length,
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
