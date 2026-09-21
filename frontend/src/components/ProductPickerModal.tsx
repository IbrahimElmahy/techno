import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compareArabic, sortByName } from '../utils/arabicSort';
import {
  Button, Col, Empty, Input, Row, Space, Tag
} from 'antd';
import { keepInView } from '../utils/keepInView';
import { normalizeAr } from './ListToolbar';
import { TabModal } from './TabModal';
import { qty, numeralsLocale } from '../utils/money';
import { useCategoryTree, withChildren } from '../hooks/useCategoryTree';

/**
 * اختيار الصنف — categories on one side, their products on the other, in a window of its own.
 *
 * As two inline dropdowns this cost a click to open, a scroll to find, a click to choose, twice
 * per line. In a modal the whole catalogue is visible at once and the keyboard alone gets through
 * it: type to filter, arrows to move, Enter to add. The counter is the place where a saved second
 * per line is the difference between a queue that moves and one that does not.
 *
 * It closes on every pick rather than staying open, because the quantity is the next thing the
 * user has to say — and the caller sends them straight back here when that quantity is entered.
 */

interface Props {
  open: boolean;
  categories: string[];
  categoryLabels: Record<string, string>;
  products: any[];
  /** Category currently in focus; lifted so the caller's stock panel can follow it. */
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  onPick: (itemId: number) => void;
  /** Add several at once. When given, the modal offers a اضافة مجمعة mode. */
  onPickMany?: (itemIds: number[]) => void;
  onCancel: () => void;
  title?: string;
  /** Quantity available for an item, when the caller knows it — shown beside the name. */
  availableFor?: (itemId: number) => number | null;
  /** Optional custom price resolver or label */
  priceFor?: (itemId: number) => number | string | null;
  /** بيمنع اختيار صنف رصيده صفر في المكان اللي `availableFor` بتقيس عليه. */
  disableOutOfStock?: boolean;
  /**
   * بيتغيّر لما الرصيد اللي `availableFor` بتقرا منه يتغيّر — المخزن اتبدّل، أو
   * أرصدته وصلت بعد ما الشباك اتفتح.
   *
   * `availableFor` نفسها دالة جديدة كل رندر، فمينفعش تدخل في اعتمادات الميمو (الفلترة
   * على آلاف الصنف كانت هتتعاد كل رندر والشباك ياخد ثواني يفتح). والنتيجة إن القايمة
   * كانت بتتحسب مرة وتفضل على رصيد المخزن القديم لحد ما اللي قدامها يكتب حرف. النص ده
   * بيدي الميمو حاجة يتعلّق بيها من غير التكلفة دي.
   */
  availabilityVersion?: string | number;
}

const fmtPrice = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';

export default function ProductPickerModal({
  open, categories, categoryLabels, products, activeCategory, onCategoryChange,
  onPick, onPickMany, onCancel, title = 'اختر الصنف', availableFor, priceFor,
  disableOutOfStock = false, availabilityVersion,
}: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  /**
   * **الشجرة: فئة رئيسية ← فئة فرعية ← أصناف.** (031)
   *
   * الرئيسية المختارة **محلية هنا**، والفئة اللي بتطلع برّه (`onCategoryChange`) بتفضل
   * **فرعية زي ما كانت بالحرف**. الشاشات اللي بتنده الشباك بتستعمل الفئة دي في لوحة
   * أرصدتها بمقارنة `s.category === activeCategory` — فلو بعتنا لها قيمة رئيسية،
   * وهي فئة مافيش صنف متعلّق بيها مباشرةً في الغالب، لوحتهم كانت هتفضى من غير سبب
   * ظاهر. اختيار الرئيسية بيبعت لهم `null` يعني «كل الفئات» — حالة هما عارفينها
   * وشغّالين عليها من الأول.
   *
   * ومن غير شجرة (`hasTree === false`) مافيش رئيسية تتختار أصلاً، والشريط بيرسم نفس
   * القايمة المسطّحة بنفس الترتيب — الفرع اللي ما عملش شجرة شاشته زي ما هي.
   */
  const { tree } = useCategoryTree();
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  /**
   * **بيبتدي شغّال: الصنف اللي مافيش منه حاجة في المخزن مابيظهرش.**
   *
   * كان بيبتدي مطفي، بحجّة إن الفلتر بيخفي أصناف فلازم المستخدم هو اللي يطلبه. والحجّة
   * دي صح في المطلق وغلط هنا: اللي فاتح الشباك بيبيع من مخزن بعينه، والصنف اللي رصيده
   * صفر فيه **مايتباعش**. فالقايمة الكاملة بتحطّ قدامه مية صنف يقدر يختار منهم تلاتين،
   * وبتخلّيه يلاقي اللي بيدوّر عليه وسط أصناف مالهاش لازمة في اللحظة دي.
   *
   * والإخفاء **مش صامت**: الزرار فوق مكتوب عليه «✓ المتاح في المخزن فقط» وهو مفعّل،
   * وضغطة واحدة بترجّع الكتالوج كله. اللي بيدوّر على صنف مش لاقيه بيشوف السبب قدامه.
   *
   * والاختيار بيتفتكر في المتصفح: اللي فتح الكتالوج كله عشان يشوف صنف ناقص، مش عايز
   * يعيد الضغطة مع كل فاتورة.
   */
  const [onlyAvailableStock, setOnlyAvailableStock] = useState(() => {
    try {
      const v = localStorage.getItem('picker.onlyAvailable');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  const searchRef = useRef<any>(null);

  /** `availableFor` بتوصل دالة جديدة كل رندر من الشاشة اللي بتنده الشباك، ولو دخلت
   *  في اعتمادات الميمو تحت بتلغيه: الفلترة على آلاف الأصناف (ومعاها `normalizeAr`
   *  على كل اسم) بتتعاد كل رندر، والشباك بياخد ثواني يفتح. الـref بيدّي أحدث نسخة
   *  من غير ما يبقى اعتماد. */
  const availableRef = useRef(availableFor);
  availableRef.current = availableFor;

  /** الفئة اللي جاية من برّه بتفتح مجموعتها، عشان الفرعية تبان تحت رئيسيتها. */
  useEffect(() => {
    if (!activeCategory) return;   // «كل الفئات» أو رئيسية مختارة — القرار محلي
    setActiveRoot(tree.parentOf[activeCategory] || null);
  }, [activeCategory, tree]);

  /**
   * الفئات المقبولة دلوقتي — `null` يعني الكل.
   *
   * فرعية مختارة ⇒ هي وحدها. رئيسية مختارة ⇒ هي وفروعها. القيمة `Set` محسوبة مرة
   * ومحطوطة في اعتمادات الفلترة تحت، عشان الفلترة على آلاف الصنف تفضل بتتعاد لما
   * الاختيار يتغيّر بس — مش كل رندر.
   */
  const accepted = useMemo(() => {
    if (activeCategory) return new Set([activeCategory]);
    if (activeRoot) return new Set(withChildren(tree, activeRoot));
    return null;
  }, [activeCategory, activeRoot, tree]);

  /**
   * الشريط: رئيسية ومعاها فروعها.
   *
   * الفئات النازلة من الشاشة هي فئات **الأصناف** — يعني الفرعيات — والرئيسية ممكن
   * مايبقاش عليها ولا صنف مباشر فماتنزلش فيهم خالص. فالشجرة بتتبني من جذر كل فئة:
   * `rootOf(c)`، واللي مالوش أب جذره هو نفسه. من غير شجرة النتيجة بتبقى نفس القايمة
   * المرتّبة اللي كانت بالحرف — كل فئة مجموعة لوحدها من غير فروع.
   */
  const groups = useMemo(() => {
    const kids = new Map<string, string[]>();
    const roots: string[] = [];
    categories.forEach((c) => {
      const root = tree.parentOf[c] || c;
      if (!kids.has(root)) { kids.set(root, []); roots.push(root); }
      if (root !== c) kids.get(root)!.push(c);
    });
    roots.sort(compareArabic);
    return roots.map((root) => ({
      value: root,
      children: (kids.get(root) || []).sort(compareArabic),
    }));
  }, [categories, tree]);

  const catLabel = (c: string) => categoryLabels[c] || tree.labels[c] || c;
  /** اسم اللي متفلتر عليه دلوقتي — للبحث ولرسالة «مافيش نتيجة». */
  const activeLabel = activeCategory ? catLabel(activeCategory)
    : (activeRoot ? catLabel(activeRoot) : null);

  const visible = useMemo(() => {
    let list = accepted ? products.filter((p) => accepted.has(p.category)) : products;
    const needle = normalizeAr(query);
    if (needle) {
      // البحث جوّه الفئة المختارة، مش في الكتالوج كله.
      //
      // كان بيبتدي من `products` تاني، فالفئة اللي المستخدم دوسها بتتلغي أول ما يكتب حرف —
      // يدوّر على «كوع» وهو واقف على فئة واحدة فيرجع له كل كوع في الشركة. اللي بيختار فئة
      // قال بيدوّر فين؛ الكتابة بعدها تضييق للنطاق ده مش إلغاء له.
      //
      // والبحث في الكتالوج كله لسه موجود — بـ«كل الفئات» فوق قايمة الفئات.
      list = list.filter((p) => normalizeAr(p.name).includes(needle)
        || normalizeAr(p.code || '').includes(needle));
    }
    const avail = availableRef.current;
    if (disableOutOfStock && onlyAvailableStock && avail) {
      const inStock = list.filter((p) => {
        const av = avail(p.id);
        return av === null || av > 0;
      });
      // **الفلتر اللي بيخفي كل حاجة مش فلتر.**
      //
      // `availableFor` بترجّع صفر لما أرصدة المخزن لسه ما وصلتش — «مش معروف» و«مافيش»
      // بيطلعوا نفس الرقم. فأول ما المخزن يتغيّر والأرصدة في السكة، كل صنف بيجاوب صفر
      // والقايمة بتتفضّى بالكامل: اللي قدامه بيدوّر على صنف موجود في المخزن ومش لاقي
      // ولا سطر، ومافيش حاجة بتقول له ليه.
      //
      // القاعدة هنا بتمسك ده وأي سبب تاني يعمله (النداء وقع، المخزن فاضي فعلاً):
      // النتيجة الفاضية معناها إن القياس مش موثوق، والكتالوج الكامل أنفع من شاشة فاضية.
      list = inStock.length ? inStock : list;
    }
    // **الترتيب أبجدي عربي، آخر خطوة قبل العرض.**
    //
    // القايمة جاية من الكتالوج بترتيب السيرفر، وبعد الفلترة بتفضل على ترتيبه — بس اللي
    // بيدوّر بعينه في شباك فيه آلاف الصنف محتاج الاسم يكون في مكانه. والتوحيد في
    // `normalizeAr` عشان الهمزة والتاء المربوطة مايفرّقوش الاسم الواحد، وفي `numeric`
    // عشان «ماسورة 2» تيجي قبل «ماسورة 10» مش بعدها.
    return sortByName(list, (p) => p.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, accepted, products, disableOutOfStock, onlyAvailableStock,
      availabilityVersion]);

  /** بيترسم من القايمة قد إيه.
   *
   *  الكتالوج آلاف الأصناف، وكلهم كانوا بيتحطوا في الـDOM مرة واحدة — الشباك بيتجمّد
   *  ثواني قبل ما يبان. المعروض بيتقصّ، وبيزيد لما اللي بيدوّر يوصل لآخر القايمة. */
  const PAGE = 120;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setShown(PAGE); }, [query, activeCategory, activeRoot, open, onlyAvailableStock]);
  const rendered = useMemo(() => visible.slice(0, shown), [visible, shown]);

  // Back to the top whenever the list underneath changes, so the highlight is never left pointing
  // at a row that scrolled out from under it.
  useEffect(() => { setCursor(0); }, [query, activeCategory, activeRoot, open, onlyAvailableStock]);
  // …and never past the end when a search narrows the list.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(visible.length - 1, 0)));
  }, [visible.length]);

  // Keep the highlighted row on screen — arrowing past the fold is how a keyboard user loses
  // track of what Enter is about to add.
  //
  // القايمة هي اللي بتتحرك، مش الشاشة.
  //
  // كان `scrollIntoView({block:'nearest'})`، وده بيلف على **كل** أب بيعمل scroll فوق الصف:
  // القايمة، وجسم النافذة، والصفحة ورا النافذة. فالسهم لتحت لحد آخر صنف ظاهر كان بيحرّك
  // التلاتة مع بعض — والنافذة بتنطّ، ويبقى شكلها إنها رجعت لفوق.
  //
  // الحساب هنا بالفرق بين حدود الصف وحدود الصندوق، فمافيش حاجة برّا الصندوق بتتلمس. ولو
  // الصف طالع من فوق بيتظبط من فوق، ولو طالع من تحت بيتظبط من تحت — بأقل حركة تخلّيه ظاهر
  // بالكامل، من غير ما القايمة تتحرك من تحت الإيد.
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    keepInView(rowRefs.current[cursor], listRef.current);
  }, [cursor, visible.length]);
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPicked([]);
    setBulk(false);
    setTimeout(() => searchRef.current?.focus?.(), 60);
  }, [open]);

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, visible.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && visible[cursor]) {
      e.preventDefault();
      const p = visible[cursor];
      const av = availableFor ? availableFor(p.id) : null;
      if (disableOutOfStock && av !== null && av <= 0) return;
      if (bulk) toggle(p.id);
      else onPick(p.id);
    }
  };

  return (
    <TabModal open={open} onCancel={onCancel} footer={null} width={860} title={title}
      focusTriggerAfterClose={false}
      destroyOnHidden styles={{ body: { paddingTop: 8 } }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Input
            ref={searchRef} size="large" allowClear value={query}
            placeholder={activeLabel
              ? `ابحث في «${activeLabel}» بالاسم أو الكود`
              : 'ابحث بالاسم أو الكود — أو اختر فئة من جنب'}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {/* الزرار بيتعرض لما يكون بيفلتر فعلاً. كان بيظهر على أي شاشة بتمرّر `availableFor`،
            يعني الشرا والمردودات كمان — مكتوب عليه «المتاح في المخزن فقط» وهو مفعّل ومش
            بيعمل حاجة، والشرا أصلاً بيدخّل بضاعة مش بيصرفها. */}
        {availableFor && disableOutOfStock && (
          <Button
            type={onlyAvailableStock ? 'primary' : 'default'}
            ghost={onlyAvailableStock}
            onClick={() => {
              const next = !onlyAvailableStock;
              setOnlyAvailableStock(next);
              try { localStorage.setItem('picker.onlyAvailable', next ? '1' : '0'); }
              catch { /* متصفح مقفّل التخزين — الاختيار بيعيش للجلسة دي */ }
            }}
          >
            {onlyAvailableStock ? '✓ المتاح في المخزن فقط' : 'عرض كل الأصناف'}
          </Button>
        )}
      </div>

      <Row gutter={12}>
        <Col xs={24} md={7}>
          <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {/* من غيرها الفئة بتبقى طريق في اتجاه واحد: تدوسها ومافيش حاجة تشيلها، والبحث
                يفضل محبوس فيها. */}
            <div
              onClick={() => { setActiveRoot(null); onCategoryChange(null); }}
              style={{
                padding: '8px 10px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                background: activeCategory === null && activeRoot === null ? '#6AB42D' : '#f6faf3',
                color: activeCategory === null && activeRoot === null ? '#fff' : undefined,
                border: '1px solid #e6efe3',
                fontWeight: activeCategory === null && activeRoot === null ? 700 : 400,
              }}>
              كل الفئات
            </div>
            {groups.map((g) => {
              // الرئيسية مختارة = واقفين عليها هي وفروعها، يعني مافيش فرعية مختارة.
              const rootActive = activeRoot === g.value && !activeCategory;
              // الرئيسية اللي عليها أصناف مباشرةً بتفضل قابلة للاختيار زي ما كانت —
              // والفئة المسطّحة (من غير فروع) هي نفس الصف القديم بالحرف.
              return (
                <React.Fragment key={g.value}>
                  <div
                    onClick={() => {
                      if (g.children.length) {
                        // رئيسية: بتتفلتر محلياً على فروعها، وبتبعت «كل الفئات» لبرّه —
                        // شوف تعليق `activeRoot` فوق.
                        setActiveRoot(g.value);
                        onCategoryChange(null);
                      } else {
                        setActiveRoot(null);
                        onCategoryChange(g.value);
                      }
                    }}
                    style={{
                      padding: '8px 10px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                      background: (rootActive || activeCategory === g.value) ? '#6AB42D' : '#f6faf3',
                      color: (rootActive || activeCategory === g.value) ? '#fff' : undefined,
                      border: '1px solid #e6efe3',
                      fontWeight: (rootActive || activeCategory === g.value || g.children.length)
                        ? 700 : 400,
                    }}>
                    {catLabel(g.value)}
                    {g.children.length > 0 && (
                      <span style={{ fontSize: 11, opacity: 0.75, marginInlineStart: 6 }}>
                        ({g.children.length})
                      </span>
                    )}
                  </div>
                  {g.children.map((c) => {
                    const active = c === activeCategory;
                    return (
                      <div key={c}
                        onClick={() => { setActiveRoot(g.value); onCategoryChange(c); }}
                        style={{
                          padding: '6px 10px', borderRadius: 6, marginBottom: 4,
                          marginInlineStart: 14, cursor: 'pointer', fontSize: 13,
                          background: active ? '#6AB42D' : '#fbfdfa',
                          color: active ? '#fff' : undefined,
                          border: '1px solid #eef4ec', fontWeight: active ? 700 : 400,
                        }}>
                        {catLabel(c)}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
            {rendered.length < visible.length && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <a onClick={() => setShown((n) => n + PAGE)}>
                  عرض المزيد ({visible.length - rendered.length} صنف كمان)
                </a>
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} md={17}>
          <div ref={listRef} style={{ maxHeight: '52vh', overflowY: 'auto' }} onKeyDown={onKeyDown}>
            {visible.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={query
                  ? (activeLabel
                    ? `لا يوجد صنف بهذا الاسم في «${activeLabel}» — جرّب «كل الفئات»`
                    : 'لا يوجد صنف بهذا الاسم')
                  : (onlyAvailableStock ? 'لا توجد أصناف برصيد متاح في هذا المخزن' : 'لا توجد أصناف')} />
            ) : rendered.map((p, i) => {
              const available = availableFor ? availableFor(p.id) : null;
              // الصفر بيتقال، مابيمنعش. الصنف اللي مش في المكان ده بيبقى غالباً في مكان
              // تاني — والمخزن على السطر مش على المستند (030)، فمنعه من القايمة بيمنع بيع
              // ممكن. الشاشة اللي بتنده الشباك هي اللي بتقرّر تعمل بيه إيه، والسيرفر بيتأكد.
              // الصنف اللي مفيش منه في المخزن ده بيتعرض ومابيتاخدش.
              //
              // إخفاؤه أسهل، بس بيسيب اللي بيدوّر عليه بيبص على قايمة ناقصة من غير سبب.
              // ظاهر ومطفي ومكتوب جنبه «غير متوفر» بيقول الحاجتين: إنه موجود في النظام،
              // وإنه مش هيتباع من هنا.
              const out = Boolean(disableOutOfStock && available !== null && available <= 0);
              return (
                <div key={p.id}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  // الضغط على الصف مايسحبش التركيز من خانة البحث.
                  //
                  // الأسهم بتتقري من الخانة، والصف مش عنصر بياخد تركيز — فالضغطة كانت
                  // بتودّي التركيز للصفحة نفسها والأسهم تبطّل تشتغل. ده بيبان في الاختيار
                  // المجمّع بالذات: تعلّم صنف بالماوس وتحاول تكمّل بالكيبورد فمافيش حاجة
                  // بتتحرك. `preventDefault` على `mousedown` هي اللي بتخلّي التركيز مكانه.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { if (out) return; return bulk ? toggle(p.id) : onPick(p.id); }}
                  onMouseEnter={() => setCursor(i)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 12px', borderRadius: 6, marginBottom: 4,
                    cursor: out ? 'not-allowed' : 'pointer',
                    opacity: out ? 0.45 : 1,
                    background: out ? '#fafafa' : (i === cursor ? '#eaf5e2' : '#fff'),
                    border: `1px solid ${out ? '#eee' : (i === cursor ? '#6AB42D' : '#f0f0f0')}`,
                  }}>
                  <span>
                    {bulk && (
                      <span style={{ marginInlineEnd: 8 }}>
                        {picked.includes(p.id) ? '☑' : '☐'}
                      </span>
                    )}
                    <b style={{ color: out ? '#999' : undefined }}>{p.name}</b>
                    {p.code && <Tag style={{ marginInlineStart: 8 }}>{p.code}</Tag>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {priceFor && priceFor(p.id) != null && (
                      <Tag color="blue" style={{ fontWeight: 600, fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>
                        السعر: {typeof priceFor(p.id) === 'number' ? fmtPrice(priceFor(p.id)) : priceFor(p.id)}
                      </Tag>
                    )}
                    {!priceFor && p.purchase_price != null && Number(p.purchase_price) > 0 && (
                      <Tag color="blue" style={{ fontWeight: 600, fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>
                        شراء: {fmtPrice(p.purchase_price)}
                      </Tag>
                    )}
                    {!priceFor && (p.sale_price != null || p.consumer_price != null) && Number(p.sale_price || p.consumer_price) > 0 && (
                      <Tag color="cyan" style={{ fontWeight: 600, fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>
                        بيع: {fmtPrice(p.sale_price || p.consumer_price)}
                      </Tag>
                    )}
                    {available !== null && (
                      <Tag
                        color={available > 0 ? 'success' : 'error'}
                        style={{
                          fontWeight: 700,
                          fontSize: 12,
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}
                      >
                        {/* «غير متوفر» بتقول حاجة أكبر من اللي النظام يعرفها: الرقم ده
                            مخزن واحد، والصنف ممكن يبقى على رف تاني. الصفر بيتقال كصفر. */}
                        {`المتاح: ${qty(available)}`}
                      </Tag>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Col>
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#6b6b6b' }}>
          اكتب للبحث · ↑↓ للتنقل · Enter {bulk ? 'للتحديد' : 'للإضافة'}
        </span>
        {onPickMany && (
          <Space>
            <Button size="small" onClick={() => { setBulk(!bulk); setPicked([]); }}>
              {bulk ? 'اختيار فردي' : 'اضافة مجمعة'}
            </Button>
            {bulk && (
              <Button
                type="primary" size="small" disabled={!picked.length}
                onClick={() => { onPickMany(picked); setPicked([]); }}
              >
                أضف {picked.length || ''} صنف
              </Button>
            )}
          </Space>
        )}
      </div>
    </TabModal>
  );
}
