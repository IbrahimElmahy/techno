import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Spin, Table, Tag, Tooltip } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from './AuthProvider';
import { TabDrawer } from './TabModal';
import { useLookup, labelMap } from '../hooks/useLookup';
import { num } from '../utils/money';
import { entryTypeLabel } from './labels';

const ACTION_LABEL: Record<string, string> = {
  baseline: 'النسخة قبل أول تعديل مسجَّل',
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  reverse: 'تراجع/عكس',
  approve: 'اعتماد',
  'self-approve': 'اعتماد ذاتي',
  reject: 'رفض',
  cancel: 'إلغاء',
  post: 'ترحيل',
  'reset-to-draft': 'إرجاع إلى مسودة',
  lines: 'تعديل السطور',
  execute: 'تنفيذ وإقفال',
  start: 'بدء/صرف خامات',
  confirm: 'تأكيد',
  receive: 'استلام',
  'issue-quality': 'صرف خامات الجودة',
  receipts: 'إلغاء استلام',
  convert: 'تحويل لفاتورة',
  counts: 'تسجيل الجرد',
};

const ACTION_COLOR: Record<string, string> = {
  baseline: 'default', create: 'green', update: 'blue', lines: 'blue', delete: 'red',
  reverse: 'volcano', approve: 'cyan', 'self-approve': 'cyan', reject: 'red', cancel: 'orange',
  post: 'geekblue', 'reset-to-draft': 'gold', receipts: 'orange',
};

const FIELD_LABEL: Record<string, string> = {
  document_number: 'رقم المستند',
  invoice_date: 'التاريخ', purchase_date: 'التاريخ', return_date: 'التاريخ',
  voucher_date: 'التاريخ', transfer_date: 'التاريخ', permit_date: 'التاريخ',
  production_date: 'التاريخ', entry_date: 'التاريخ', order_date: 'التاريخ', count_date: 'التاريخ',
  due_date: 'الاستحقاق',
  customer_id: 'العميل', customer_name: 'العميل', customer_type: 'نوع العميل',
  supplier_id: 'المورد', supplier_name: 'المورد',
  gross: 'الإجمالي', net: 'الصافي', total: 'الإجمالي', amount: 'المبلغ',
  cash_amount: 'نقدي', credit_amount: 'آجل', residual: 'المتبقي',
  cash_refund: 'رد نقدي', credit_reduction: 'تخفيض المديونية',
  notes: 'ملاحظات', description: 'الوصف', reference: 'المرجع',
  statement1: 'البيان', statement2: 'البيان ٢', statement3: 'البيان ٣',
  external_document_number: 'رقم خارجي',
  state: 'الحالة', status: 'الحالة', payment_state: 'حالة السداد', kind: 'النوع', route: 'المسار',
  warehouse_id: 'المخزن', warehouse_name: 'المخزن',
  location_id: 'المخزن', source_location_id: 'من', dest_location_id: 'إلى',
  from_warehouse_id: 'من مخزن', to_warehouse_id: 'إلى مخزن',
  rep_id: 'المندوب', rep_name: 'المندوب', rep_user_id: 'المندوب',
  family: 'الحساب (أبيض/بولي)', other_family: 'الحساب الثاني',
  combined_pct: 'الخصم الكلي %', discount_pct: 'خصم %', fixed_discount_pct: 'خصم ثابت %',
  variable_discount_pct: 'خصم متغيّر %', line_discount: 'خصم السطور', discount: 'الخصم',
  gross_before_line_discount: 'قبل خصم السطور',
  cash_account_id: 'حساب النقدية', revenue_account_id: 'حساب الإيراد', account_id: 'الحساب',
  treasury_id: 'الخزينة', to_treasury_id: 'إلى خزينة',
  cost_center_id: 'مركز التكلفة', cost_center_distribution: 'توزيع مراكز التكلفة',
  branch_id: 'الفرع', payment_method: 'طريقة الدفع',
  approved_by: 'اعتمده', created_by: 'أنشأه', posted_at: 'رُحِّل في',
  reject_reason: 'سبب الرفض', is_reversal: 'عكس؟', is_bonus: 'بونص؟',
  prior_balance: 'الرصيد السابق', other_family_balance: 'رصيد الحساب الثاني',
  expenses_billed: 'مصاريف على العميل', expenses_operating: 'مصاريف تشغيل',
  coupon_serial_from: 'كوبونات من', coupon_serial_to: 'كوبونات إلى', coupon_count: 'عدد الكوبونات',
  bonus_for_number: 'بونص على فاتورة',
  item_id: 'الصنف', item_name: 'الصنف', product_id: 'المنتج', material_id: 'الخامة',
  quantity: 'الكمية', unit_price: 'السعر', line_total: 'الإجمالي', unit: 'الوحدة',
  unit_factor: 'معامل الوحدة', unit_cost: 'التكلفة', price_tier: 'فئة السعر',
  counted_quantity: 'الكمية المجرودة', expected_quantity: 'الرصيد الدفتري', difference: 'الفرق',
  category: 'الفئة', debit: 'مدين', credit: 'دائن',
  lines: 'السطور', materials: 'الخامات', products: 'المنتجات', receipts: 'الاستلامات',
  payments: 'الدفعات', coupons: 'الكوبونات', resources: 'الموارد', outputs: 'المنتجات',
  inputs: 'الخامات', returned_coupons: 'كوبونات مرتجعة', consumptions: 'الخامات',
  date: 'التاريخ', number: 'الرقم', entry_type: 'نوع القيد', journal_name: 'اليومية',
  partner_name: 'الطرف', direction: 'الجهة', statement: 'البيان', total_credit: 'إجمالي الدائن',
  balanced: 'متزن؟', move_type: 'نوع المستند',
  expense_amount: 'مصروفات', total_cost: 'إجمالي التكلفة', line_cost: 'التكلفة',
  product_quantity: 'كمية الإنتاج', material_cost: 'تكلفة الخامات', resource_cost: 'المصروفات',
  work_order_ref: 'رقم الإنتاج', reason: 'السبب', imported_from: 'منقول من', reversed: 'معكوس؟',
  stage: 'المرحلة', planned_quantity: 'الكمية المخططة', reviewed: 'تمت مراجعته؟',
  line_count: 'عدد السطور', counted_count: 'المعدود منها', item_code: 'كود الصنف',
};

const ENUM_KEYS = new Set(['status', 'state', 'kind', 'route', 'payment_method', 'payment_state',
  'price_tier', 'customer_type', 'location_kind', 'direction', 'partner_kind']);
const VALUE_LABEL: Record<string, string> = {
  draft: 'مسودة', posted: 'مرحّل', pending: 'معلّق', approved: 'معتمد', rejected: 'مرفوض',
  cancelled: 'ملغي', canceled: 'ملغي', reversed: 'معكوس', open: 'مفتوح', closed: 'مغلق',
  completed: 'مكتمل', done: 'منفّذ', in_progress: 'جاري', confirmed: 'مؤكد', received: 'مستلم',
  converted: 'محوّل إلى فاتورة', paid: 'مدفوع', partial: 'مدفوع جزئي', unpaid: 'غير مدفوع',
  warehouse: 'مخزن', custody: 'عهدة', cash: 'نقدي', cheque: 'شيك', bank: 'بنك',
  receipt: 'سند قبض', payment: 'سند صرف', issue: 'صرف', opening: 'أول المدة', sale: 'بيع',
  purchase: 'شراء', full: 'كاملة', cycle: 'جزئية',
  commercial: 'تجاري', semi_commercial: 'نصف تجاري', wholesale: 'جملة',
  semi_wholesale: 'نصف جملة', consumer: 'مستهلك', trader: 'تاجر', plumber: 'سباك',
  not_paid: 'غير مدفوع', debit: 'مدين', credit: 'دائن', customer: 'عميل', supplier: 'مورد',
  employee: 'موظف',
};

const NOISY = new Set(['id', 'client_uuid', 'created_at', 'updated_at', 'ledger_entry_id',
  'actor_user_id', 'stock_movement_id', 'entity_id', 'entity_type', 'version']);

type Kind = 'items' | 'warehouses' | 'custodies' | 'accounts' | 'reps' | 'users' | 'suppliers'
  | 'customers' | 'branches' | 'treasuries' | 'costCenters';

const SOURCES: Record<Kind, { url: string; params?: Record<string, unknown> }> = {
  items: { url: '/api/v1/items' },
  warehouses: { url: '/api/v1/warehouses' },
  custodies: { url: '/api/v1/custodies' },
  accounts: { url: '/api/v1/accounts' },
  reps: { url: '/api/v1/reps' },
  users: { url: '/api/v1/users' },
  suppliers: { url: '/api/v1/suppliers' },
  customers: { url: '/api/v1/customers/options', params: { limit: 20000 } },
  branches: { url: '/api/v1/branches' },
  treasuries: { url: '/api/v1/treasuries' },
  costCenters: { url: '/api/v1/cost-centers' },
};

function kindOf(key: string, row: Record<string, any>): Kind | null {
  if (/(^|_)item_id$/.test(key) || key === 'product_id' || key === 'material_id') return 'items';
  if (/warehouse_id$/.test(key)) return 'warehouses';
  const loc = key.match(/^(.*)location_id$/);
  if (loc) {
    const k = row[`${loc[1]}location_kind`];
    return k === 'custody' ? 'custodies' : 'warehouses';
  }
  if (/account_id$/.test(key)) return 'accounts';
  if (key === 'rep_id') return 'reps';
  if (/treasury_id$/.test(key)) return 'treasuries';
  if (key === 'customer_id') return 'customers';
  if (key === 'supplier_id') return 'suppliers';
  if (key === 'branch_id') return 'branches';
  if (key === 'cost_center_id') return 'costCenters';
  if (/(user_id|_by)$/.test(key)) return 'users';
  return null;
}

type Names = Partial<Record<Kind, Record<string, string>>>;

function rowsOf(data: any): any[] {
  if (Array.isArray(data)) return data;
  return data?.items || data?.rows || data?.data || data?.results || [];
}

const nameOf = (r: any): string | undefined =>
  r?.name ?? r?.full_name ?? r?.username ?? r?.label ?? r?.title ?? r?.code;

const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isRowList = (v: unknown): v is Record<string, any>[] =>
  Array.isArray(v) && v.length > 0 && v.every(isObj);

function canon(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return String(Number(v));
  return String(v);
}

function visibleKeys(rows: Record<string, any>[]): string[] {
  const keys: string[] = [];
  const all = new Set<string>();
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => {
    if (!all.has(k)) { all.add(k); keys.push(k); }
  }));
  const sample = Object.assign({}, ...rows.slice().reverse());
  return keys.filter((k) => {
    if (NOISY.has(k) || k.endsWith('_uuid')) return false;
    if (rows.some((r) => isRowList(r?.[k]))
      && rows.every((r) => r?.[k] == null || Array.isArray(r[k]))) return false;
    if (k.endsWith('_id') && all.has(`${k.slice(0, -3)}_name`)) return false;
    if (all.has(`${k}_label`)) return false;
    if (/location_kind$/.test(k) && all.has(k.replace(/kind$/, 'id'))) return false;
    if ((k.endsWith('_id') || k.endsWith('_ids')) && !kindOf(k, sample)) return false;
    return true;
  });
}

function labelOf(key: string): string {
  if (FIELD_LABEL[key]) return FIELD_LABEL[key];
  if (key.endsWith('_label') && FIELD_LABEL[key.slice(0, -6)]) return FIELD_LABEL[key.slice(0, -6)];
  return key;
}

function useFormatter(names: Names) {
  const { options: famOpts } = useLookup('customer_account_family');
  const families = useMemo(() => labelMap(famOpts), [famOpts]);
  return (key: string, v: any, row: Record<string, any>): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    const kind = kindOf(key, row);
    if (kind && (typeof v === 'number' || typeof v === 'string')) {
      return names[kind]?.[String(v)] ?? `#${v}`;
    }
    if (key === 'family' || key === 'other_family') return families[v] || String(v);
    if (key === 'entry_type' && typeof v === 'string') return entryTypeLabel(v);
    if (ENUM_KEYS.has(key) && typeof v === 'string') return VALUE_LABEL[v] || v;
    if (typeof v === 'number') return num(v);
    if (typeof v === 'string') {
      if (/^-?\d+\.\d+$/.test(v)) return num(v);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace('T', ' ');
      return v;
    }
    if (Array.isArray(v)) {
      return v.map((x) => (isObj(x) ? Object.values(x).join(' ') : String(x))).join('، ') || '—';
    }
    if (isObj(v)) {
      return Object.entries(v).map(([k, x]) => `${k}: ${canon(x) || '—'}`).join(' · ') || '—';
    }
    return String(v);
  };
}

type RowStatus = 'same' | 'added' | 'removed' | 'changed';
interface RowDiff { key: string; row: Record<string, any>; old?: Record<string, any>; status: RowStatus }

function lineKeys(rows: Record<string, any>[]): string[] {
  const seen: Record<string, number> = {};
  return rows.map((r, i) => {
    if (r?.id !== undefined && r?.id !== null) return `id:${r.id}`;
    const ref = r?.item_id ?? r?.product_id ?? r?.material_id ?? r?.account_id;
    if (ref === undefined || ref === null) return `ix:${i}`;
    const k = `ref:${ref}`;
    seen[k] = (seen[k] || 0) + 1;
    return `${k}#${seen[k]}`;
  });
}

function diffRows(cur: Record<string, any>[], prev: Record<string, any>[] | null,
  cols: string[]): RowDiff[] {
  const curKeys = lineKeys(cur);
  if (!prev) return cur.map((row, i) => ({ key: curKeys[i], row, status: 'same' }));
  const prevKeys = lineKeys(prev);
  const prevBy = new Map(prevKeys.map((k, i) => [k, prev[i]]));
  const out: RowDiff[] = cur.map((row, i) => {
    const old = prevBy.get(curKeys[i]);
    if (!old) return { key: curKeys[i], row, status: 'added' };
    const changed = cols.some((c) => canon(row[c]) !== canon(old[c]));
    return { key: curKeys[i], row, old, status: changed ? 'changed' : 'same' };
  });
  const curSet = new Set(curKeys);
  prevKeys.forEach((k, i) => {
    if (!curSet.has(k)) out.push({ key: `removed:${k}`, row: prev[i], status: 'removed' });
  });
  return out;
}

const ROW_BG: Record<RowStatus, string | undefined> = {
  same: undefined, added: '#f0fdf4', removed: '#fef2f2', changed: undefined,
};
const CHANGED_BG = '#fff7e6';

interface VersionRow {
  id: number; version_no: number; action: string; actor_user_id: number | null;
  actor_name: string | null; created_at: string; document_number: string | null;
}
interface VersionFull extends VersionRow {
  entity_type: string; entity_id: number; snapshot: any; previous: any;
}

function OldNew({ now, old }: { now: string; old: string }) {
  return (
    <span style={{ background: CHANGED_BG, padding: '0 4px', borderRadius: 4 }}>
      <b>{now}</b>
      <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginInlineStart: 6 }}>
        {old}
      </span>
    </span>
  );
}

function SnapshotView({ version, names }: { version: VersionFull; names: Names }) {
  const fmt = useFormatter(names);
  const wrap = (s: any) => (s == null ? null : isObj(s) ? s : { lines: Array.isArray(s) ? s : [] });
  const snap: Record<string, any> = wrap(version.snapshot) || {};
  const prev: Record<string, any> | null = wrap(version.previous);

  const headKeys = visibleKeys(prev ? [snap, prev] : [snap]);
  const listKeys = [...new Set([...Object.keys(snap), ...Object.keys(prev || {})])]
    .filter((k) => isRowList(snap[k]) || isRowList(prev?.[k]));

  const changedHead = prev ? headKeys.filter((k) => canon(snap[k]) !== canon(prev[k])) : [];

  return (
    <div>
      {version.action === 'delete' && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }}
          message="تم حذف المستند — هذه آخر نسخة قبل الحذف" />
      )}
      {version.action === 'baseline' && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="هذا هو المستند عند بدء التسجيل في السجل — لا توجد نسخ سابقة له." />
      )}
      {prev && !changedHead.length && (
        <div style={{ marginBottom: 8, color: '#64748b', fontSize: 13 }}>
          الرأس مطابق للنسخة السابقة.
        </div>
      )}
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}
        styles={{ label: { whiteSpace: 'nowrap' } }}
        items={headKeys.map((k) => {
          const now = fmt(k, snap[k], snap);
          const changed = changedHead.includes(k);
          return {
            key: k,
            label: labelOf(k),
            children: changed ? <OldNew now={now} old={fmt(k, prev?.[k], prev || {})} /> : now,
          };
        })} />

      {listKeys.map((lk) => {
        const cur: Record<string, any>[] = isRowList(snap[lk]) ? snap[lk] : [];
        const old: Record<string, any>[] | null = prev ? (isRowList(prev[lk]) ? prev[lk] : []) : null;
        const cols = visibleKeys([...cur, ...(old || [])]);
        cols.sort((a, b) => Number(/item_(id|name)$/.test(b)) - Number(/item_(id|name)$/.test(a)));
        const rows = diffRows(cur, old, cols);
        const added = rows.filter((r) => r.status === 'added').length;
        const removed = rows.filter((r) => r.status === 'removed').length;
        const changed = rows.filter((r) => r.status === 'changed').length;
        return (
          <div key={lk} style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {labelOf(lk)} <span style={{ color: '#64748b', fontWeight: 400 }}>({cur.length})</span>
              {added > 0 && <Tag color="green" style={{ marginInlineStart: 8 }}>أُضيف {added}</Tag>}
              {removed > 0 && <Tag color="red">حُذف {removed}</Tag>}
              {changed > 0 && <Tag color="orange">عُدِّل {changed}</Tag>}
            </div>
            <Table<RowDiff>
              size="small" rowKey="key" dataSource={rows} pagination={false}
              scroll={{ x: 'max-content' }}
              onRow={(r) => ({
                style: {
                  background: ROW_BG[r.status],
                  textDecoration: r.status === 'removed' ? 'line-through' : undefined,
                  color: r.status === 'removed' ? '#b91c1c' : undefined,
                },
              })}
              columns={[
                { title: '#', key: '_n', width: 40,
                  render: (_: any, r: RowDiff, i: number) => (r.status === 'removed'
                    ? <Tag color="red" style={{ marginInlineEnd: 0 }}>محذوف</Tag>
                    : r.status === 'added'
                      ? <Tag color="green" style={{ marginInlineEnd: 0 }}>جديد</Tag>
                      : i + 1) },
                ...cols.map((c) => ({
                  title: labelOf(c), key: c,
                  render: (_: any, r: RowDiff) => {
                    const now = fmt(c, r.row[c], r.row);
                    if (r.status === 'changed' && r.old && canon(r.row[c]) !== canon(r.old[c])) {
                      return <OldNew now={now} old={fmt(c, r.old[c], r.old)} />;
                    }
                    return now;
                  },
                })),
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}

function HistoryBody({ entityType, entityId }: { entityType: string; entityId: number }) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [version, setVersion] = useState<VersionFull | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [names, setNames] = useState<Names>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get('/api/v1/document-versions', { params: { entity_type: entityType, entity_id: entityId } })
      .then((r) => {
        if (cancelled) return;
        const rows: VersionRow[] = r.data || [];
        setVersions(rows);
        if (rows.length) setSelected(rows[rows.length - 1].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.status === 403
          ? 'ليست لديك صلاحية عرض سجل المستندات.'
          : (e?.response?.data?.detail?.message || 'تعذّر تحميل السجل'));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  useEffect(() => {
    if (!selected) { setVersion(null); return undefined; }
    let cancelled = false;
    setVersionLoading(true);
    api.get(`/api/v1/document-versions/${selected}`)
      .then((r) => { if (!cancelled) setVersion(r.data); })
      .catch(() => { if (!cancelled) setVersion(null); })
      .finally(() => !cancelled && setVersionLoading(false));
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    if (!version) return;
    const needed = new Set<Kind>();
    const scan = (o: any) => {
      if (Array.isArray(o)) { o.forEach(scan); return; }
      if (!isObj(o)) return;
      Object.entries(o).forEach(([k, v]) => {
        if (Array.isArray(v) || isObj(v)) { scan(v); return; }
        if (v === null || v === undefined) return;
        const kind = kindOf(k, o);
        if (kind && !(k.endsWith('_id') && o[`${k.slice(0, -3)}_name`] != null)) needed.add(kind);
      });
    };
    scan(version.snapshot);
    scan(version.previous);
    needed.forEach((kind) => {
      if (names[kind]) return;
      const src = SOURCES[kind];
      api.get(src.url, src.params ? { params: src.params } : undefined)
        .then((r) => {
          const map: Record<string, string> = {};
          rowsOf(r.data).forEach((x: any) => {
            const n = nameOf(x);
            if (x?.id !== undefined && n) map[String(x.id)] = String(n);
          });
          setNames((prev) => ({ ...prev, [kind]: map }));
        })
        .catch(() => setNames((prev) => ({ ...prev, [kind]: prev[kind] || {} })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  if (error) return <Alert type="warning" showIcon message={error} />;
  if (!versions.length) return <Empty description="لا توجد نسخ مسجّلة لهذا المستند بعد" />;

  const newestFirst = versions.slice().reverse();
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 250px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {newestFirst.map((v) => {
          const active = v.id === selected;
          return (
            <button key={v.id} type="button" onClick={() => setSelected(v.id)}
              style={{
                textAlign: 'start', cursor: 'pointer', font: 'inherit',
                padding: '6px 10px', borderRadius: 8,
                border: `1px solid ${active ? '#16a34a' : '#e2e8f0'}`,
                background: active ? '#f0fdf4' : '#fff',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <Tag color={ACTION_COLOR[v.action] || 'geekblue'} style={{ marginInlineEnd: 0 }}>
                  {ACTION_LABEL[v.action] || v.action}
                </Tag>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>نسخة {v.version_no}</span>
              </div>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{v.actor_name || '—'}</div>
              <div style={{ color: '#64748b', fontSize: 12 }} dir="ltr">
                {v.created_at ? String(v.created_at).slice(0, 16).replace('T', ' ') : '—'}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ flex: '1 1 500px', minWidth: 0 }}>
        {versionLoading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          : version ? (
            <>
              <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Tag color={ACTION_COLOR[version.action] || 'geekblue'}>
                  {ACTION_LABEL[version.action] || version.action}
                </Tag>
                <span>نسخة {version.version_no}</span>
                <span style={{ color: '#64748b' }}>— {version.actor_name || 'غير معروف'}</span>
                <span style={{ color: '#64748b' }} dir="ltr">
                  {String(version.created_at || '').slice(0, 16).replace('T', ' ')}
                </span>
              </div>
              <SnapshotView version={version} names={names} />
            </>
          ) : <Empty description="اختر نسخة من القائمة" />}
      </div>
    </div>
  );
}

export function DocumentHistoryButton({ entityType, entityId, documentNumber, iconOnly }: {
  entityType: string;
  entityId: number | null | undefined;
  documentNumber?: string | null;
  iconOnly?: boolean;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!entityId || !can('audit.read')) return null;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span onClick={stop} onDoubleClick={stop} style={{ display: 'inline-flex' }}>
      {iconOnly ? (
        <Tooltip title="السجل">
          <Button size="small" type="text" icon={<HistoryOutlined />} onClick={() => setOpen(true)} />
        </Tooltip>
      ) : (
        <Button size="small" icon={<HistoryOutlined />} onClick={() => setOpen(true)}
          style={{ fontWeight: 600, fontSize: 14 }}>
          السجل
        </Button>
      )}
      <TabDrawer
        open={open} onClose={() => setOpen(false)} destroyOnHidden
        width="min(1100px, 95vw)"
        title={`السجل${documentNumber ? ` — ${documentNumber}` : ''}`}
      >
        {open && <HistoryBody entityType={entityType} entityId={entityId} />}
      </TabDrawer>
    </span>
  );
}

export default DocumentHistoryButton;
