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

/**
 * اختيار الطرف — the first step of every sale/purchase document.
 *
 * Two things this solves that a plain dropdown could not: the list is long enough to need real
 * search and a branch filter, and a party that does not exist yet can be created **without
 * leaving the half-filled document** — walking away to the customers screen used to lose the
 * lines already entered.
 *
 * It also carries the document DATE when asked to (`date` + `onDateChange`), because that is how
 * the system this client is migrating from opens a document: one step that asks who it is for and
 * when, and then the invoice is on screen. We used to ask the date in a modal of its own and the
 * party in another — two dialogs to answer two questions that are the same decision, and two
 * things to dismiss before typing the first line.
 */

/**
 * تصنيف الطرف في المنتقي — **زي a5 بالظبط**.
 *
 * a5 بيحطّ على كل حساب فرعي خانة «يظهر في» (`showsin` في الـAPI بتاعه)، وهي اللي
 * بتقرّر الحساب ده يبان في أنهي منتقي. فمنتقي الطرف عنده فيه أكتر من تصنيف —
 * والموظف واحد منهم: الشركة بتبيع لموظفيها وبتستلم منهم مرتجع، والمستند ده حقيقي
 * وله دفتره.
 *
 * `employee` مش دفتر تالت — هو **نفس دفتر العملاء مفلتر على `customer_type`**.
 * الموظف اللي بيشتري كارته كارت عميل (وده منطق a5: حساب تحت «العملاء» لدين
 * البضاعة، وحساب تحت «اجور ومرتبات» للمرتب — حسابين لنفس الراجل بغرضين). فالتصنيف
 * هنا **عدسة على نفس الكشف**، مش جدول تاني — ولو بقى جدول تاني كان الموظف اللي
 * بيشتري هيبقى ليه كارتين ورصيدين.
 */
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

/** شرايح السعر — نفس القايمة اللي في `useLookup` عشان الأسماء ما تتفرّقش. */
const PRICE_TIERS = [
  { value: 'commercial', label: 'تجاري' },
  { value: 'semi_commercial', label: 'نصف تجاري' },
  { value: 'wholesale', label: 'جملة' },
  { value: 'semi_wholesale', label: 'نصف جملة' },
  { value: 'consumer', label: 'مستهلك' },
];
/** نفس مقارنة `compareArabic` بالظبط، على أسماء موحَّدة من قبل — أسرع بكتير على آلاف الأسماء. */
const arCollator = new Intl.Collator('ar', { numeric: true });

const KIND_ENDPOINT: Record<PartyKind, string> = {
  customer: '/api/v1/customers',
  supplier: '/api/v1/suppliers',
  // الموظف من نفس دفتر العملاء — الفلترة تحت على `customer_type`.
  employee: '/api/v1/customers',
};

/** التصنيف اللي التبويب ده بيفلتر بيه كشف العملاء. `null` = من غير فلترة. */
const KIND_CUSTOMER_TYPE: Partial<Record<PartyKind, string>> = { employee: 'employee' };

/** أسماء التبويبات والوحدة اللي بتتعدّ بيها — لشكل الكروت. */
const KIND_TAB: Record<PartyKind, string> = { customer: 'العملاء', supplier: 'الموردين', employee: 'الموظفين' };
const KIND_UNIT: Record<PartyKind, string> = { customer: 'عميل', supplier: 'مورد', employee: 'موظف' };

/**
 * حالة المديونية — **من ناحيتنا**: «عليهم» يعني الطرف مديون لنا.
 *
 * رصيد العميل (والموظف، نفس الدفتر) مدين: موجب = عليه لنا، سالب = له عندنا — نفس
 * `filter_by_balance` في السيرفر (debtors > 0، credit < 0). رصيد المورد دائن: موجب =
 * مستحق له، فالإشارة بتتقلب عشان «عليهم» تفضل معناها واحد في كل تبويب.
 */
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
  /** التصنيف اللي البوباب بيفتح عليه. */
  kind: PartyKind;
  onPick: (party: Party) => void;
  onCancel: () => void;
  /** Pass both to show the document date here. Omit them and the picker is just a picker — which
   *  is what it still is when a document that already has a date changes its party. */
  date?: Dayjs;
  onDateChange?: (d: Dayjs) => void;
  /**
   * التصنيفات اللي ينفع تتنقّل بينها جوّه البوباب — «العملاء» و«الموردين».
   *
   * The system this client is migrating from opens a document with one dialog carrying a تصنيف
   * list, so the person can look in the other book without closing what they started. Omit it and
   * the picker stays fixed on `kind`, which is right for a screen that only ever has one answer.
   */
   kinds?: PartyKind[];
   title?: string;
   /** تصنيفات عملاء مستبعدة من القايمة — شاشات البيع بتبعت `['plumber']`
    *  (السباك مالوش بيع). شاشات الكوبونات مابتبعتش حاجة. */
   excludeTypes?: string[];
   /**
    * الشكل بس — المنطق واحد. `classic` القايمة القديمة، `cards` كروت بعواميد وفلتر مديونية.
    * اتعمّم على كل المستندات (٢٠٢٦-١٠-٠١) — `classic` لسه موجود لو شاشة احتاجته.
    */
   variant?: 'classic' | 'cards';
   /** شارة جنب العنوان في شكل الكروت — «طلب بيع مباشر» / «فاتورة بونص». */
   contextLabel?: string;
 }) {
  const cards = variant === 'cards';
  const navigate = useNavigate();
  // التصنيف الحالي — بيبدأ من اللي الشاشة فتحت بيه وبيرجعله كل مرة تتفتح.
  const [activeKind, setActiveKind] = useState<PartyKind>(kind);
  useEffect(() => { if (open) setActiveKind(kind); }, [open, kind]);
  const [parties, setParties] = useState<Party[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  // A customer must be assigned to a rep and a territory — they are asked for inline so the
  // quick-create stays a genuine shortcut rather than a form that fails on submit.
  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  /** تصنيفات العملاء من قايمة الإعدادات — كانت حالة معرّفة ومفيش حاجة بتملاها، فالقايمة
   *  كانت بتفضل فاضية والفورم بيقع على قايمة مكتوبة في الكود. */
  const { options: customerTypes } = useLookup('customer_type');
  const typeLabels = useMemo(() => labelMap(customerTypes), [customerTypes]);
  // الملّاك ليهم شاشتهم — مايتخلقوش من منتقي الطرف.
  const pickerTypes = useMemo(
    () => customerTypes.filter((o: any) => o.value !== 'owner'),
    [customerTypes],
  );
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState<number | undefined>();
  /** فلتر «حالة المديونية» — بيظهر في شكل الكروت بس؛ في القديم بيفضل `all` فمابيفلترش. */
  const [debt, setDebt] = useState<'all' | DebtState>('all');
  // The highlighted row. The list opens with the first one lit so Enter has something to answer
  // and the arrows have somewhere to move from — the same as «اختر الصنف» a step later.
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
        // المنطقة بتتعرض على الكارت كمان، فبتتجاب لتبويب الموظفين (نفس دفتر العملاء).
        activeKind !== 'supplier' ? api.get('/api/v1/territories').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);
      setParties(pRes.data);
      // قوايم فورم الإنشاء أبجدي — بتتعرض بترتيبها قبل ما حد يكتب.
      const byName = (r: any) => r.full_name || r.username || r.name;
      setBranches(sortByName(bRes.data || [], byName));
      setReps(sortByName((uRes.data || []).filter((u: any) => u.role === 'sales_rep'), byName));
      setTerritories(sortByName(tRes.data || [], byName));
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { if (open) { load(); setQuery(''); setCreating(false); } }, [open, activeKind]);
  useEffect(() => { if (open) setDebt('all'); }, [open]);

  // الاسم موحَّد مرة واحدة للكشف كله — الترتيب تحت بيقارن آلاف الأسماء مع كل حرف.
  const bareNames = useMemo(
    () => new Map(parties.map((p) => [p.id, normalizeAr(p.name)])), [parties]);

  const visible = useMemo(() => {
    const needle = normalizeAr(query);
    const onlyType = KIND_CUSTOMER_TYPE[activeKind];
    const bare = (p: Party) => bareNames.get(p.id) ?? normalizeAr(p.name);
    /**
     * **الأقرب فوق، وجوّه كل مرتبة أبجدي** — نفس قاعدة `searchRank` في القوايم المقفولة:
     *
     *     ٠  الاسم بيبدأ بالحروف         «محمد حسن»
     *     ١  كلمة جوّاه بتبدأ بيها        «احمد محمد»
     *     ٢  جوّه كلمة                    «المحمدي»
     *     ٣  لقيناه بالتليفون مش بالاسم
     *
     * كانت بتطلع بترتيب الكشف (الأحدث الأول)، فاللي بيكتب «محمد» يلاقي «احمد محمد» فوق
     * «محمد حسن». ومن غير كتابة: أبجدي، عشان اللي بيدوّر بعينه يلاقي الاسم في مكانه.
     */
    const rank = (p: Party) => {
      if (!needle) return 0;
      const t = bare(p);
      if (t.startsWith(needle)) return 0;
      if (t.includes(` ${needle}`)) return 1;
      if (t.includes(needle)) return 2;
      return matchesWords(t, needle) ? 2.5 : 3;   // «مح حس» — كلمات متفرّقة
    };
    return parties.filter((p) => {
      // تبويب «الموظفين» بيفرز نفس الكشف — مش بيجيب دفتر تاني. الموظف اللي بيشتري
      // كارته كارت عميل، ولو كان له كارت لوحده كان هيبقى ليه رصيدين لنفس الراجل.
      if (onlyType && (p as any).customer_type !== onlyType) return false;
      if (excludeTypes?.includes((p as any).customer_type)) return false;
      if (branchId && p.branch_id !== branchId) return false;
      if (debt !== 'all' && debtState(activeKind, p.balance) !== debt) return false;
      if (!needle) return true;
      return matchesWords(bare(p), needle) || normalizeAr(p.phone).includes(needle);
    }).sort((a, b) => (rank(a) - rank(b)) || arCollator.compare(bare(a), bare(b)));
  }, [parties, bareNames, query, branchId, activeKind, debt]);

  /** عدد كل تبويب بعد فلتر الفرع — للي كشفه متحمّل بس (العملاء والموظفين نفس الكشف). */
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

  /**
   * الكروت بتترسم على دفعات — الكشف ممكن يبقى ٣٠٠٠ طرف، والكارت أتقل من سطر القايمة
   * القديمة. الدفعة اللي بعدها بتنزل لما التمرير يقرّب من الآخر أو المؤشر يوصل لها.
   */
  const PAGE = 150;
  const [renderLimit, setRenderLimit] = useState(PAGE);
  useEffect(() => { setRenderLimit(PAGE); }, [visible]);

  /**
   * مين اللي حرّك المؤشر — الكيبورد ولا الماوس.
   *
   * في شكل الكروت الماوس بيلوّن الكارت اللي تحته **من غير ما القايمة تتحرك**: لو المؤشر
   * اللي جه من الماوس اتعمله `keepInView`، كارت نصّه باين تحت الماوس بيشدّ القايمة، والكارت
   * اللي بعده يدخل تحت الماوس فيشدّها تاني — وده «النطّ لنص الشاشة».
   */
  const cursorByMouse = useRef(false);
  /** آخر مكان حقيقي للماوس — المتصفح بيبعت حركة ماوس وهمية بعد التمرير من غير ما الإيد تتحرك. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // Back to the top when the list changes, and never past its end.
  useEffect(() => { setCursor(0); }, [query, branchId, open, debt]);
  const listRef = useRef<HTMLDivElement | null>(null);
  // الكروت: تغيير التبويب فلتر زي أي فلتر — المؤشر والتمرير يرجعوا لأول القايمة.
  useEffect(() => {
    if (!cards) return;
    cursorByMouse.current = false;
    setCursor(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [cards, query, branchId, debt, activeKind]);
  // الدفعة اللي جاية بتترسم **قبل** ما المؤشر يوصل لآخر كارت مترسوم، فالكارت اللي المؤشر
  // عليه موجود دايماً وقت `keepInView`. والزيادة بتتحط تحت، فالتمرير مابيتحركش.
  useEffect(() => {
    if (cards && cursor >= renderLimit - 10 && renderLimit < visible.length) {
      setRenderLimit((n) => n + PAGE);
    }
  }, [cursor, renderLimit, cards, visible.length]);
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(visible.length - 1, 0)));
  }, [visible.length]);
  // القايمة بس هي اللي بتتحرك — شوف `keepInView`.
  useEffect(() => {
    if (cards && cursorByMouse.current) return;
    keepInView(rowRefs.current[cursor], listRef.current);
  }, [cursor, visible.length]);

  /** الماوس في الكروت: حركة حقيقية بس هي اللي بتنقل المؤشر، ومن غير تمرير. */
  const onCardPointer = (i: number) => (e: React.MouseEvent) => {
    const p = lastPointer.current;
    if (p && p.x === e.clientX && p.y === e.clientY) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    if (i === cursor) return;
    cursorByMouse.current = true;
    setCursor(i);
  };

  /** ↑↓ to move, Enter to take the highlighted one — the same keys as «اختر الصنف», so the two
   *  steps of opening a document are driven identically. */
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') cursorByMouse.current = false;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setCursor((c) => Math.min(c + 1, visible.length - 1));
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && visible[cursor]) { e.preventDefault(); onPick(visible[cursor]); }
  };

  /** Create the party inline and hand it straight back — the document keeps everything it had. */
  const handleCreate = async (values: any) => {
    setSaving(true);
    try {
      // كل الحقول اللي في الفورم بتتبعت. الفاضي بيتبعت `undefined` مش `''` — الفرق إن
      // «مااتكتبش» بيفضل NULL في الداتا بدل نص فاضي، وده اللي بيخلّي التقارير تعرف تفرّق.
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
        // الإنشاء من تبويب «الموظفين» بيتولد موظف على طول — اللي فتح التبويب ده
        // عارف هو بيضيف مين، وإجباره يختار التصنيف تاني سؤال إجابته قدامه.
        payload.customer_type = values.customer_type
          || KIND_CUSTOMER_TYPE[activeKind] || 'تاجر';
        payload.rep_id = values.rep_id;
        payload.territory_id = values.territory_id;
        payload.default_price_tier = values.default_price_tier || undefined;
        // فاضي معناه «مافيش اتفاق»، وصفر معناه «فيه اتفاق وهو صفر». التفرقة دي هي سبب إن
        // العمودين دول بيقبلوا NULL أصلاً.
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

  /* ---------------------------------------------------------------- شكل الكروت
   * نفس الحالة والفلترة والكيبورد والإنشاء — الرسم بس اللي مختلف. */
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
  /** كارت الطرف — في شاشته. العملاء والموظفين نفس الكارت. الفاتورة بتفضل مفتوحة ورا. */
  const openCard = (p: Party) => navigate(
    activeKind === 'supplier' ? `/suppliers/${p.id}` : `/customers/${p.id}`);

  const balanceView = (p: Party) => {
    const raw = Number(p.balance || 0);
    const st = debtState(activeKind, p.balance);
    const abs = Math.abs(raw);
    // «صغير» = فكّة أقل من جنيه — بواقي تقريب مش مديونية حقيقية.
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
        <div>اسم {KIND_LABEL[activeKind]} / الكود / التصنيف</div>
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
                  <div className="pp-sub">
                    {p.code && <>كود: <span dir="ltr">{p.code}</span></>}
                    {p.code && typeLabel && ' • '}
                    {typeLabel}
                  </div>
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
          {/* زرار إنشاء لكل تصنيف — في الترويسة زي الشاشة اللي العميل شغّال عليها، مش في
              الفوتر. الضغط بيفتح الفورم على التصنيف بتاعه على طول. */}
          {/* الموظف مالوش زرار هنا: بيتعمل من شاشة الموظفين. وكان بيتكتب عليه «مورد جديد»
              لأن أي تصنيف غير العميل كان بيتسمّى مورد — فشاشة البيع كانت بتعرض إنشاء مورد. */}
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
        {/*
          * عمود الفلاتر يمين والنتايج شمال — نفس تقسيم الشاشة اللي العميل شغّال عليها.
          *
          * كان الفلاتر شريط فوق والقايمة تحته، فالقايمة بتاخد عرض الشاشة كله وارتفاع أقل.
          * القايمة هنا هي الشغل، فبتاخد المساحة الطولية، والفلاتر بتقعد جنبها ثابتة بدل ما
          * تاكل من ارتفاعها.
          */}
        <Col xs={24} md={8}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12.5, color: '#6b6b6b', marginBottom: 2 }}>الفرع</div>
              <Select allowClear style={{ width: '100%' }} placeholder="كل الفروع"
                value={branchId} onChange={(v) => setBranchId(v)}
                options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
            </div>

            {date && onDateChange && (
              <div>
                <div style={{ fontSize: 12.5, color: '#6b6b6b', marginBottom: 2 }}>التاريخ</div>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  value={date} onChange={(v) => v && onDateChange(v)} />
              </div>
            )}

            <div>
              <div style={{ fontSize: 12.5, color: '#6b6b6b', marginBottom: 2 }}>البحث</div>
              <Input allowClear autoFocus prefix={<SearchOutlined />}
                placeholder="بالاسم أو الهاتف"
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey} />
            </div>

            {/* تصنيف — بيتنقّل بين دفتر العملاء ودفتر الموردين من غير ما البوباب يتقفل. */}
            {(kinds?.length ?? 0) > 1 && (
              <div>
                <div style={{ fontSize: 12.5, color: '#6b6b6b', marginBottom: 2 }}>تصنيف</div>
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
              <div style={{ color: '#6b6b6b', fontSize: 12.5 }}>
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
                    <span style={{ color: '#6b6b6b', fontSize: 12.5 }}>{party.phone}</span>)}
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
          <div style={{ marginTop: 6, color: '#6b6b6b', fontSize: 12.5 }}>
            {visible.length} من {parties.length} · ↑↓ للتنقل · Enter للاختيار
          </div>
        </Col>
      </Row>
    </TabModal>
    )}

    {/*
      * «عميل جديد» بوباب فوق البوباب — مش بديل عنه.
      *
      * كان بيحل محل القايمة جوّه نفس النافذة: تدوس «عميل جديد» فالقايمة تختفي، وترجع تلاقي
      * البحث اللي كنت كاتبه اتمسح. النافذة اللي فوق بتسيب اللي تحتها زي ما هو، فالرجوع بيرجّعك
      * لنفس المكان بالظبط.
      *
      * والفوتر فيه «حفظ واختيار»: الطرف الجديد بيتحفظ وبيترد على المستند على طول، من غير ما
      * تدوّر عليه في القايمة بعد ما تحفظه.
      */}
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
        {/*
          * فورم الإنشاء بنفس حقول وترتيب الشاشة اللي العميل شغّال عليها.
          *
          * كان فيه الاسم والهاتف والمندوب وبس. وباقي الحقول — الفرع، الإيميل، الرقم الضريبي،
          * السجل التجاري، العنوان، السعر الافتراضي، الخصم، ض.م — كانت **موجودة في السيرفر من
          * زمان** ومفيش طريق يوصلها من هنا: تعمل العميل من جوّه الفاتورة، وبعدين تسيب شغلك
          * وتفتح شاشة العملاء عشان تكمّل بياناته.
          *
          * العميل تلات حقول في الصف والمورد تلاتة كمان — نفس التقسيم اللي في شاشته.
          */}
        <Row gutter={12}>
          {activeKind === 'customer' ? (
            <>
              <Col xs={24} md={8}>
                <Form.Item name="branch_id" label="الفرع" style={{ marginBottom: 10 }}>
                  <Select allowClear placeholder="الفرع"
                    options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="rep_id" label="مندوب"
                  rules={[{ required: true, message: 'المندوب مطلوب' }]}
                  style={{ marginBottom: 10 }}>
                  <Select showSearch placeholder="اختر المندوب"
                    options={reps.map((r: any) => ({
                      value: r.id, label: r.full_name || r.username }))} filterOption={searchFilter} filterSort={searchRank}/>
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
                  options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
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
                {/* فاضي = مافيش اتفاق؛ صفر = فيه اتفاق وهو صفر. */}
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
                {/* المنطقة مش في شاشته، بس السيرفر عندنا بيطلبها على العميل — من غيرها
                    الحفظ بيترفض، فبتتسأل هنا بدل ما الفورم يقع عند الحفظ. */}
                <Form.Item name="territory_id" label="المنطقة"
                  rules={[{ required: true, message: 'المنطقة مطلوبة' }]}
                  style={{ marginBottom: 10 }}>
                  <Select showSearch placeholder="اختر المنطقة"
                    options={territories.map((t: any) => ({ value: t.id, label: t.name }))} filterOption={searchFilter} filterSort={searchRank}/>
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
