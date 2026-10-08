import React, { useEffect, useMemo, useRef, useState } from 'react';
import { matchesWords, searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Button, Col, DatePicker, Empty, Form, Input, Row, Select, Space, Spin, Tag, message,
} from 'antd';
import { InputNumber } from './NumberInput';
import {
  CloseOutlined, EllipsisOutlined, PhoneOutlined, PlusOutlined, SearchOutlined, TeamOutlined,
} from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { normalizeAr } from './ListToolbar';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from './TabModal';
import { keepInView } from '../utils/keepInView';
import { money, num, numeralsLocale } from '../utils/money';
import './PartyPickerModal.css';
import { repOptions } from '../utils/reps';
import { activeChoices, activeOptions } from '../utils/active';

export type PartyKind = 'customer' | 'supplier' | 'employee';

export interface Party {
  id: number;
  name: string;
  phone?: string | null;
  address?: string | null;
  branch_id?: number | null;
  balance?: string | null;
}

const KIND_LABEL: Record<PartyKind, string> = { customer: 'العميل', supplier: 'المورد', employee: 'الموظف' };

const PRICE_TIERS = [
  { value: 'commercial', label: 'تجاري' },
  { value: 'semi_commercial', label: 'نصف تجاري' },
  { value: 'wholesale', label: 'جملة' },
  { value: 'semi_wholesale', label: 'نصف جملة' },
  { value: 'consumer', label: 'مستهلك' },
];
const arCollator = new Intl.Collator('ar', { numeric: true });

const KIND_ENDPOINT: Record<PartyKind, string> = {
  customer: '/api/v1/customers',
  supplier: '/api/v1/suppliers',
  employee: '/api/v1/customers',
};

const KIND_CUSTOMER_TYPE: Partial<Record<PartyKind, string>> = { employee: 'employee' };

const KIND_TAB: Record<PartyKind, string> = { customer: 'العملاء', supplier: 'الموردين', employee: 'الموظفين' };
const KIND_UNIT: Record<PartyKind, string> = { customer: 'عميل', supplier: 'مورد', employee: 'موظف' };

type DebtState = 'owes' | 'credit' | 'zero';
const debtState = (k: PartyKind, balance?: string | null): DebtState => {
  const b = Number(balance || 0) * (k === 'supplier' ? -1 : 1);
  if (b > 0) return 'owes';
  if (b < 0) return 'credit';
  return 'zero';
};

export default function PartyPickerModal({
  open, kind, onPick, onCancel, date, onDateChange, kinds, title, excludeTypes,
  variant = 'cards', contextLabel,
}: {
  open: boolean;
  kind: PartyKind;
  onPick: (party: Party) => void;
  onCancel: () => void;
  date?: Dayjs;
  onDateChange?: (d: Dayjs) => void;
   kinds?: PartyKind[];
   title?: string;
   excludeTypes?: string[];
   variant?: 'classic' | 'cards';
   contextLabel?: string;
 }) {
  const cards = variant === 'cards';
  const navigate = useNavigate();
  const [activeKind, setActiveKind] = useState<PartyKind>(kind);
  useEffect(() => { if (open) setActiveKind(kind); }, [open, kind]);
  const [parties, setParties] = useState<Party[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const { options: customerTypes } = useLookup('customer_type');
  const typeLabels = useMemo(() => labelMap(customerTypes), [customerTypes]);
  const pickerTypes = useMemo(
    () => customerTypes.filter((o: any) => o.value !== 'owner'),
    [customerTypes],
  );
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState<number | undefined>();
  const [debt, setDebt] = useState<'all' | DebtState>('all');
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, bRes, uRes, tRes] = await Promise.all([
        api.get(KIND_ENDPOINT[activeKind]),
        api.get('/api/v1/branches').catch(() => ({ data: [] })),
        activeKind === 'customer' ? api.get('/api/v1/users').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        activeKind !== 'supplier' ? api.get('/api/v1/territories').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);
      setParties(activeChoices(pRes.data || []));
      const byName = (r: any) => r.full_name || r.username || r.name;
      setBranches(sortByName(bRes.data || [], byName));
      setReps(sortByName((uRes.data || []).filter((u: any) => u.role === 'sales_rep'), byName));
      setTerritories(sortByName(tRes.data || [], byName));
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { if (open) { load(); setQuery(''); setCreating(false); } }, [open, activeKind]);
  useEffect(() => { if (open) setDebt('all'); }, [open]);

  const bareNames = useMemo(
    () => new Map(parties.map((p) => [p.id, normalizeAr(p.name)])), [parties]);

  const visible = useMemo(() => {
    const needle = normalizeAr(query);
    const onlyType = KIND_CUSTOMER_TYPE[activeKind];
    const bare = (p: Party) => bareNames.get(p.id) ?? normalizeAr(p.name);
    const rank = (p: Party) => {
      if (!needle) return 0;
      const t = bare(p);
      if (t.startsWith(needle)) return 0;
      if (t.includes(` ${needle}`)) return 1;
      if (t.includes(needle)) return 2;
      return matchesWords(t, needle) ? 2.5 : 3;
    };
    return parties.filter((p) => {
      if (onlyType && (p as any).customer_type !== onlyType) return false;
      if (excludeTypes?.includes((p as any).customer_type)) return false;
      if (branchId && p.branch_id !== branchId) return false;
      if (debt !== 'all' && debtState(activeKind, p.balance) !== debt) return false;
      if (!needle) return true;
      return matchesWords(bare(p), needle) || normalizeAr(p.phone).includes(needle);
    }).sort((a, b) => (rank(a) - rank(b)) || arCollator.compare(bare(a), bare(b)));
  }, [parties, bareNames, query, branchId, activeKind, debt]);

  const kindCounts = useMemo(() => {
    const base = parties.filter((p) => !excludeTypes?.includes((p as any).customer_type)
      && (!branchId || p.branch_id === branchId));
    const out: Partial<Record<PartyKind, number>> = {};
    (kinds ?? [kind]).forEach((k) => {
      if (KIND_ENDPOINT[k] !== KIND_ENDPOINT[activeKind]) return;
      const t = KIND_CUSTOMER_TYPE[k];
      out[k] = t ? base.filter((p) => (p as any).customer_type === t).length : base.length;
    });
    return out;
  }, [parties, excludeTypes, branchId, kinds, kind, activeKind]);

  const PAGE = 150;
  const [renderLimit, setRenderLimit] = useState(PAGE);
  useEffect(() => { setRenderLimit(PAGE); }, [visible]);

  const cursorByMouse = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { setCursor(0); }, [query, branchId, open, debt]);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!cards) return;
    cursorByMouse.current = false;
    setCursor(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [cards, query, branchId, debt, activeKind]);
  useEffect(() => {
    if (cards && cursor >= renderLimit - 10 && renderLimit < visible.length) {
      setRenderLimit((n) => n + PAGE);
    }
  }, [cursor, renderLimit, cards, visible.length]);
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(visible.length - 1, 0)));
  }, [visible.length]);
  useEffect(() => {
    if (cards && cursorByMouse.current) return;
    keepInView(rowRefs.current[cursor], listRef.current);
  }, [cursor, visible.length]);

  const onCardPointer = (i: number) => (e: React.MouseEvent) => {
    const p = lastPointer.current;
    if (p && p.x === e.clientX && p.y === e.clientY) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    if (i === cursor) return;
    cursorByMouse.current = true;
    setCursor(i);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') cursorByMouse.current = false;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setCursor((c) => Math.min(c + 1, visible.length - 1));
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && visible[cursor]) { e.preventDefault(); onPick(visible[cursor]); }
  };

  const handleCreate = async (values: any) => {
    setSaving(true);
    try {
      const payload: any = {
        name: values.name,
        phone: values.phone || undefined,
        branch_id: values.branch_id ?? undefined,
        email: values.email || undefined,
        tax_number: values.tax_number || undefined,
        commercial_register: values.commercial_register || undefined,
        address: values.address || undefined,
      };
      if (activeKind === 'customer') {
        payload.customer_type = values.customer_type
          || KIND_CUSTOMER_TYPE[activeKind] || 'تاجر';
        payload.rep_id = values.rep_id;
        payload.territory_id = values.territory_id;
        payload.default_price_tier = values.default_price_tier || undefined;
        payload.discount_pct = values.discount_pct ?? undefined;
        payload.vat_pct = values.vat_pct ?? undefined;
      }
      const res = await api.post(KIND_ENDPOINT[activeKind], payload);
      message.success(`تم إنشاء ${KIND_LABEL[activeKind]} بنجاح`);
      onPick({ id: res.data.id, name: res.data.name, phone: res.data.phone ?? null,
               address: res.data.address ?? null, balance: '0' });
      createForm.resetFields();
      setCreating(false);
    } catch (err) {
      console.error(err);
    } finally { setSaving(false); }
  };

  const creatable = (kinds ?? [kind]).filter((k) => k !== 'employee');
  const kindTotal = kindCounts[activeKind] ?? parties.length;
  const branchName = (id?: number | null) =>
    (id ? branches.find((b: any) => b.id === id)?.name : null) ?? '—';
  const territoryName = (id?: number | null) =>
    (id ? territories.find((t: any) => t.id === id)?.name : null) ?? null;
  const shown = cards ? visible.slice(0, renderLimit) : visible;
  const onCardsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (renderLimit < visible.length
      && el.scrollTop + el.clientHeight > el.scrollHeight - 400) {
      setRenderLimit((n) => n + PAGE);
    }
  };
  const openCard = (p: Party) => navigate(
    activeKind === 'supplier' ? `/suppliers/${p.id}` : `/customers/${p.id}`);

  const balanceView = (p: Party) => {
    const raw = Number(p.balance || 0);
    const st = debtState(activeKind, p.balance);
    const abs = Math.abs(raw);
    const small = abs > 0 && abs < 1;
    const tone = small ? 'warn' : st;
    const pill = small ? 'حساب منتظم (خالص)'
      : st === 'owes' ? 'مديونية مستحقة'
        : st === 'credit'
          ? (activeKind === 'supplier' ? 'رصيد لصالحنا' : `رصيد لصالح ${KIND_LABEL[activeKind]}`)
          : 'خالص (مسدد)';
    return (
      <div className={`pp-bal pp-bal--${tone}`}>
        <div className="pp-bal-amount">{money(abs)}</div>
        <span className="pp-bal-pill">{pill}</span>
      </div>
    );
  };

  const DEBT_CHIPS = [
    ['all', 'الكل'], ['owes', 'عليهم مديونية'], ['credit', 'لهم رصيد دائن'], ['zero', 'رصيد صفري'],
  ] as const;

  const cardsView = (
    <TabModal
      open={open} onCancel={onCancel} width="min(1100px, 92vw)" centered destroyOnHidden
      className="pp-cards" closable={false}
      title={(
        <div className="pp-head">
          <div className="pp-head-main">
            <div className="pp-head-icon"><TeamOutlined /></div>
            <div>
              <div className="pp-head-title">
                <span>{title ?? `اختيار جهة التعامل / ${KIND_LABEL[activeKind]}`}</span>
                {contextLabel && <span className="pp-context">{contextLabel}</span>}
              </div>
              <div className="pp-head-sub">
                اختر {KIND_LABEL[activeKind]} بالضغط المباشر أو الضغط على Enter للانتقال الفوري
                إلى الفاتورة
              </div>
            </div>
          </div>
          <div className="pp-head-actions">
            {!creating && creatable.map((k) => (
              <button key={k} type="button" className="pp-btn pp-btn--primary"
                onClick={() => { setActiveKind(k); setCreating(true); }}>
                <PlusOutlined /> {k === 'customer' ? 'إضافة عميل جديد' : 'إضافة مورد جديد'}
              </button>
            ))}
            <button type="button" className="pp-close" aria-label="إغلاق" onClick={onCancel}>
              <CloseOutlined />
            </button>
          </div>
        </div>
      )}
      footer={(
        <div className="pp-foot">
          <div className="pp-foot-count">
            عرض <b>{num(visible.length)}</b> من أصل <b>{num(kindTotal)}</b>
            {' '}{KIND_UNIT[activeKind]} مسجل
          </div>
          <div className="pp-foot-hint">
            اضغط على أي {KIND_UNIT[activeKind]} أو اضغط <kbd className="pp-kbd">Enter</kbd>
            {' '}للاختيار الفوري والانتقال المباشر للفاتورة
          </div>
          <button type="button" className="pp-btn pp-btn--ghost" onClick={onCancel}>
            إلغاء وإغلاق النافذة <kbd className="pp-kbd">Esc</kbd>
          </button>
        </div>
      )}
    >
      <div className="pp-search-row">
        <Input allowClear autoFocus size="large" className="pp-search"
          prefix={<SearchOutlined />}
          suffix={<kbd className="pp-kbd">Enter للاختيار</kbd>}
          placeholder="ابحث بالاسم، الكود أو الهاتف…"
          value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onListKey} />
        <div className="pp-field">
          <span>الفرع:</span>
          <Select allowClear size="large" style={{ minWidth: 230 }}
            placeholder="كل الفروع النشطة (الافتراضي)"
            value={branchId} onChange={(v) => setBranchId(v)}
            options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
        </div>
        {date && onDateChange && (
          <div className="pp-field">
            <span>تاريخ القيد:</span>
            <DatePicker allowClear={false} size="large" format="YYYY-MM-DD"
              value={date} onChange={(v) => v && onDateChange(v)} />
          </div>
        )}
      </div>

      <div className="pp-filter-row">
        <div className="pp-seg">
          {(kinds ?? [kind]).map((k) => (
            <button key={k} type="button"
              className={`pp-seg-item${k === activeKind ? ' is-active' : ''}`}
              onClick={() => setActiveKind(k)}>
              {KIND_TAB[k]}
              {kindCounts[k] != null && (
                <span className="pp-seg-count">{num(kindCounts[k])}</span>)}
            </button>
          ))}
        </div>
        <div className="pp-debt">
          <span className="pp-debt-label">حالة المديونية:</span>
          {DEBT_CHIPS.map(([v, l]) => (
            <button key={v} type="button"
              className={`pp-chip pp-chip--${v}${debt === v ? ' is-active' : ''}`}
              onClick={() => setDebt(v)}>
              {(v === 'owes' || v === 'credit') && <i className="pp-dot" />}{l}
            </button>
          ))}
        </div>
      </div>

      <div className="pp-cols">
        <div>اسم {KIND_LABEL[activeKind]} / التصنيف</div>
        <div>الهاتف والاتصال</div>
        <div>الفرع / المنطقة</div>
        <div>الرصيد المالي الحالي</div>
        <div>الإجراء</div>
      </div>

      <div ref={listRef} className="pp-list" onKeyDown={onListKey} onScroll={onCardsScroll}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : visible.length === 0 ? (
          <Empty description="لا توجد نتائج — استخدم زر الإضافة بالأعلى"
            style={{ margin: '32px 0' }} />
        ) : shown.map((party, i) => {
          const p = party as any;
          const active = i === cursor;
          const st = debtState(activeKind, party.balance);
          const area = [territoryName(p.territory_id), p.markaz].filter(Boolean).join(' • ');
          const typeLabel = p.customer_type
            ? (typeLabels[p.customer_type] ?? p.customer_type) : null;
          return (
            <div key={party.id} className={`pp-card${active ? ' is-active' : ''}`}
              onClick={() => onPick(party)}
              ref={(el) => { rowRefs.current[i] = el; }}
              onMouseMove={onCardPointer(i)}>
              <div className="pp-c-name">
                <div className="pp-avatar">{(party.name || '?').trim().charAt(0)}</div>
                <div className="pp-name-text">
                  <div className="pp-name-line">
                    <b>{party.name}</b>
                    {st === 'credit' && activeKind !== 'supplier' && (
                      <span className="pp-tag pp-tag--credit">دائن</span>)}
                    {p.is_cash && <span className="pp-tag">نقدي</span>}
                    {p.active === false && <span className="pp-tag pp-tag--off">غير نشط</span>}
                  </div>
                  {typeLabel && <div className="pp-sub">{typeLabel}</div>}
                </div>
              </div>
              <div className="pp-c-phone">
                {party.phone
                  ? <><PhoneOutlined /> <span dir="ltr">{party.phone}</span></>
                  : <span className="pp-muted">—</span>}
              </div>
              <div className="pp-c-branch">
                <b>{branchName(party.branch_id)}</b>
                {area && <div className="pp-sub">{area}</div>}
              </div>
              <div className="pp-c-bal">{balanceView(party)}</div>
              <div className="pp-c-act">
                <button type="button" className="pp-btn pp-btn--primary pp-btn--sm"
                  onClick={(e) => { e.stopPropagation(); onPick(party); }}>
                  اختيار ومتابعة الفاتورة
                </button>
                <button type="button" className="pp-icon-btn"
                  title={`كارت ${KIND_LABEL[activeKind]}`}
                  onClick={(e) => { e.stopPropagation(); openCard(party); }}>
                  <EllipsisOutlined />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </TabModal>
  );

  return (
    <>
    {cards ? cardsView : (
    <TabModal
      open={open} onCancel={onCancel} width={780} centered destroyOnHidden
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{title ?? 'انشاء'}</span>
          {!creating && (kinds ?? [kind]).filter((k) => k !== 'employee').map((k) => (
            <Button key={k} size="small" icon={<PlusOutlined />}
              onClick={() => { setActiveKind(k); setCreating(true); }}>
              {k === 'customer' ? 'عميل جديد' : 'مورد جديد'}
            </Button>
          ))}
        </div>
      )}
      footer={<Button onClick={onCancel}>إغلاق</Button>}
    >
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 2 }}>الفرع</div>
              <Select allowClear style={{ width: '100%' }} placeholder="كل الفروع"
                value={branchId} onChange={(v) => setBranchId(v)}
                options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
            </div>

            {date && onDateChange && (
              <div>
                <div style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 2 }}>التاريخ</div>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  value={date} onChange={(v) => v && onDateChange(v)} />
              </div>
            )}

            <div>
              <div style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 2 }}>البحث</div>
              <Input allowClear autoFocus prefix={<SearchOutlined />}
                placeholder="بالاسم أو الهاتف"
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey} />
            </div>

            {(kinds?.length ?? 0) > 1 && (
              <div>
                <div style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 2 }}>تصنيف</div>
                <div style={{ border: '1px solid #f0f0f0', borderRadius: 8,
                              overflow: 'hidden' }}>
                  {(kinds ?? []).map((k) => (
                    <div key={k} onClick={() => setActiveKind(k)}
                      style={{
                        padding: '8px 12px', cursor: 'pointer', textAlign: 'center',
                        borderTop: '1px solid #f5f5f5',
                        background: k === activeKind ? '#eaf5e2' : '#fff',
                        fontWeight: k === activeKind ? 700 : 400,
                      }}>
                      {k === 'customer' ? 'العملاء'
                        : k === 'employee' ? 'الموظفين' : 'الموردين'}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {date && (
              <div style={{ color: '#6b6b6b', fontSize: 14 }}>
                التاريخ ده بيتسجّل على الفاتورة وعلى قيدها المحاسبي — يعني الفاتورة والدفاتر
                بيقعوا في نفس اليوم.
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} md={16}>
          <div ref={listRef} style={{ height: 420, overflowY: 'auto', border: '1px solid #f0f0f0',
                        borderRadius: 8 }} onKeyDown={onListKey}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
            ) : visible.length === 0 ? (
              <Empty description="لا توجد نتائج — استخدم زر الإنشاء بالأعلى"
                style={{ margin: '32px 0' }} />
            ) : visible.map((party, i) => (
              <div key={party.id} onClick={() => onPick(party)}
                ref={(el) => { rowRefs.current[i] = el; }}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 8, padding: '10px 14px', cursor: 'pointer',
                  borderTop: '1px solid #f5f5f5',
                  background: i === cursor ? '#eaf5e2' : undefined,
                  boxShadow: i === cursor ? 'inset 2px 0 0 #6AB42D' : undefined,
                }}>
                <Space size={12}>
                  {party.phone && (
                    <span style={{ color: '#6b6b6b', fontSize: 14 }}>{party.phone}</span>)}
                  {party.balance != null && Number(party.balance) !== 0 && (
                    <Tag color={Number(party.balance) > 0 ? 'red' : 'green'}>
                      {Number(Math.abs(Number(party.balance))).toLocaleString(numeralsLocale(),
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Tag>
                  )}
                </Space>
                <b>{party.name}</b>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, color: '#6b6b6b', fontSize: 14 }}>
            {visible.length} من {parties.length} · ↑↓ للتنقل · Enter للاختيار
          </div>
        </Col>
      </Row>
    </TabModal>
    )}

    <TabModal
      open={creating} onCancel={() => setCreating(false)} width={860} centered destroyOnHidden
      title={activeKind === 'customer' ? 'عميل جديد' : 'مورد جديد'}
      footer={(
        <Space>
          <Button type="primary" loading={saving}
            onClick={() => createForm.submit()}>حفظ واختيار</Button>
          <Button onClick={() => setCreating(false)}>تراجع</Button>
        </Space>
      )}
    >
      <Form form={createForm} layout="vertical" onFinish={handleCreate}
        requiredMark={false}>
        <Row gutter={12}>
          {activeKind === 'customer' ? (
            <>
              <Col xs={24} md={8}>
                <Form.Item name="branch_id" label="الفرع" style={{ marginBottom: 10 }}>
                  <Select allowClear placeholder="الفرع"
                    options={activeOptions(branches)} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="rep_id" label="مندوب"
                  rules={[{ required: true, message: 'المندوب مطلوب' }]}
                  style={{ marginBottom: 10 }}>
                  <Select showSearch placeholder="اختر المندوب"
                    options={repOptions(reps)} filterOption={searchFilter} filterSort={searchRank}/>
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="default_price_tier" label="السعر الافتراضي"
                  style={{ marginBottom: 10 }}>
                  <Select allowClear placeholder="مستهلك" options={PRICE_TIERS} />
                </Form.Item>
              </Col>
            </>
          ) : (
            <Col xs={24} md={8}>
              <Form.Item name="branch_id" label="الفرع" style={{ marginBottom: 10 }}>
                <Select allowClear placeholder="الفرع"
                  options={activeOptions(branches)} />
              </Form.Item>
            </Col>
          )}

          <Col xs={24} md={8}>
            <Form.Item name="name" label="الاسم"
              rules={[{ required: true, message: 'الاسم مطلوب' }]}
              style={{ marginBottom: 10 }}>
              <Input autoFocus placeholder={`اسم ${KIND_LABEL[activeKind]}`} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="email" label="البريد الالكترونى" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="tax_number" label="الرقم الضريبي" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="commercial_register" label="السجل التجاري"
              style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="address" label="العنوان" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="phone" label="الهاتف" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>

          {activeKind === 'customer' && (
            <>
              <Col xs={24} md={8}>
                <Form.Item name="discount_pct" label="خصم %" style={{ marginBottom: 10 }}>
                  <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.5}
                    placeholder="—" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="vat_pct" label="ض.م %" style={{ marginBottom: 10 }}>
                  <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.5}
                    placeholder="—" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="territory_id" label="المنطقة"
                  rules={[{ required: true, message: 'المنطقة مطلوبة' }]}
                  style={{ marginBottom: 10 }}>
                  <Select showSearch placeholder="اختر المنطقة"
                    options={activeOptions(territories)} filterOption={searchFilter} filterSort={searchRank}/>
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="customer_type" label="التصنيف" style={{ marginBottom: 10 }}>
                  <Select allowClear placeholder="تاجر"
                    options={pickerTypes.filter((o: any) => !excludeTypes?.includes(o.value))} />
                </Form.Item>
              </Col>
            </>
          )}
        </Row>
      </Form>
    </TabModal>
    </>
  );
}
