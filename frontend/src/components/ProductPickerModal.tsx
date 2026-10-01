import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compareArabic, matchesWords, sortByName } from '../utils/arabicSort';
import {
  Button, Checkbox, Col, Empty, Input, Row, Select, Space, Tag
} from 'antd';
import { AppstoreOutlined, CheckOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { keepInView } from '../utils/keepInView';
import { normalizeAr } from './ListToolbar';
import { TabModal } from './TabModal';
import { qty, money, numeralsLocale } from '../utils/money';
import { useCategoryTree, withChildren } from '../hooks/useCategoryTree';
import './ProductPickerModal.css';

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
  /**
   * بيخفي «شراء: …» من جنب الصنف. سعر الشراء تكلفة الشركة — مالوش مكان قدام اللي بيبيع
   * أو بيرجّع من عميل (فاتورة البيع ومردودها وطلب البيع). الشرا ومردوده بيفضل ظاهر فيهم.
   */
  hidePurchasePrice?: boolean;
  /**
   * شكل الشباك. `classic` هو اللي كان (الافتراضي)، و`cards` التصميم الجديد بكروت —
   * شغّال في فاتورة البيع بس لحد ما يتراجع، وبعدها الافتراضي بيتقلب. نفس البيانات
   * ونفس الفلترة ونفس الكيبورد؛ الفرق في الرسم بس.
   */
  variant?: 'classic' | 'cards';
  /** اسم المخزن اللي `availableFor` بتقيس عليه — بيتكتب في رأس شكل الكروت. */
  warehouseName?: string | null;
  /** شريحة سعر المستند (`tier_prices` في الصنف) — السعر على الكارت بيبقى سعرها لو موجود. */
  priceTier?: string | null;
  /** اسمها المعروض («مستهلك»، «جملة»…). */
  priceTierLabel?: string | null;
}

/** الرصيد اللي تحته بيتعلّم «حرج» في شكل الكروت. */
const LOW_STOCK = 5;
const CAT_PREVIEW = 14;
type SortKey = 'name' | 'avail' | 'price_desc' | 'price_asc';

const fmtPrice = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '';

/**
 * **الشباك بيرجع مكانه.** اللي بيختار صنف وبيرجع يختار التاني كان بيلاقي البحث اتمسح
 * والقايمة رجعت لأولها — يكتب تاني ويلفّ تاني لنفس المكان. البحث ومكان التمرير بيتفكروا
 * بين فتحة والتانية، وبيتنسوا لما المستند يتقفل (`open` بيبقى false والفئة بتترجّع null
 * من الشاشة اللي بتنده).
 */
/**
 * **والبحث بيتفضّى بعد الاختيار** (طلب العميل ٢٠٢٦-٠٩-٣٠): اللي اختار الصنف اللي كان بيدوّر
 * عليه خلص من الكلمة دي، والصنف الجاي اسمه غيره. فالفتحة الجاية بتبتدي بخانة فاضية،
 * والقايمة واقفة على الصنف اللي لسه اتاخد (`lastPicked`) — مش أولها.
 */
type PickerMemory = { query: string; scrollTop: number; cursor: number; lastPicked?: number | null };
// ذاكرة لكل شباك باسمه: منتقي الفاتورة غير منتقي المرتجع غير الشرا — كل واحد بقايمته.
const memories: Record<string, PickerMemory> = {};

export default function ProductPickerModal({
  open, categories, categoryLabels, products, activeCategory, onCategoryChange,
  onPick, onPickMany, onCancel, title = 'اختر الصنف', availableFor, priceFor,
  disableOutOfStock = false, availabilityVersion, hidePurchasePrice = false,
  variant = 'cards', warehouseName, priceTier, priceTierLabel,
}: Props) {
  const cards = variant === 'cards';
  const memory = (memories[title] ??= { query: '', scrollTop: 0, cursor: 0 });
  const [query, setQuery] = useState(() => memory.query);
  const [cursor, setCursor] = useState(() => memory.cursor);
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
  /**
   * **عدد الأصناف المتاحة في كل فئة — والفئة اللي مافيهاش حاجة في المخزن مابتظهرش.**
   *
   * فلتر «المتاح في المخزن فقط» كان بيخفي الأصناف بس، والفئات فاضلة كلها على الجنب: المندوب
   * اللي بيبيع من عربيته يدوس فئة يلاقيها مافيهاش ولا صنف عنده. زي التطبيق بالظبط: الفئات
   * اللي فيها أصناف متاحة فعلاً، ومعاها عددها.
   *
   * `null` = الفلتر مش شغّال، أو الأرصدة لسه ماوصلتش / المخزن فاضي — ساعتها كل الفئات
   * بتظهر، لنفس سبب «الفلتر اللي بيخفي كل حاجة مش فلتر» تحت.
   */
  const stockCounts = useMemo(() => {
    const avail = availableRef.current;
    if (!(disableOutOfStock && onlyAvailableStock && avail)) return null;
    const counts = new Map<string, number>();
    products.forEach((p) => {
      const av = avail(p.id);
      if (av === null || av > 0) counts.set(p.category, (counts.get(p.category) || 0) + 1);
    });
    return counts.size ? counts : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, disableOutOfStock, onlyAvailableStock, availabilityVersion]);

  const groups = useMemo(() => {
    const kids = new Map<string, string[]>();
    const roots: string[] = [];
    categories.forEach((c) => {
      if (stockCounts && !stockCounts.get(c)) return;
      const root = tree.parentOf[c] || c;
      if (!kids.has(root)) { kids.set(root, []); roots.push(root); }
      if (root !== c) kids.get(root)!.push(c);
    });
    roots.sort(compareArabic);
    return roots.map((root) => ({
      value: root,
      children: (kids.get(root) || []).sort(compareArabic),
    }));
  }, [categories, tree, stockCounts]);

  /** عدد الأصناف المتاحة تحت فئة (هي وفروعها) — `null` لما الفلتر مش شغّال. */
  const countOf = (c: string, children: string[] = []) => (stockCounts
    ? [c, ...children].reduce((n, x) => n + (stockCounts.get(x) || 0), 0) : null);

  /** الفئة المختارة اختفت (المخزن اتغيّر ومافيهاش حاجة فيه) ⇒ رجوع لـ«كل الفئات»،
   *  بدل ما القايمة تفضل محبوسة في فئة مش ظاهرة على الجنب. */
  useEffect(() => {
    if (!stockCounts) return;
    if (activeCategory && !stockCounts.get(activeCategory)) onCategoryChange(null);
    if (activeRoot && !groups.some((g) => g.value === activeRoot)) setActiveRoot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockCounts, groups]);

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
      //
      // وكل كلمة لوحدها: «كو نح» بتلاقي «كوع ١/٢ نحاس» (`matchesWords`).
      list = list.filter((p) => matchesWords(normalizeAr(p.name), needle)
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

  /**
   * الترتيب في شكل الكروت (اختيار المستخدم). الافتراضي `name` هو نفس `visible` بالحرف —
   * والشكل القديم مابيغيّرهوش أبداً، فالقايمة فيه هي هي.
   */
  const [sortKey, setSortKey] = useState<SortKey>('name');
  /** سعر البيع اللي بيتعرض على الكارت: شريحة المستند لو ليها سعر، وإلا سعر الصنف. */
  const salePriceOf = (p: any): number | null => {
    const t = priceTier && p.tier_prices ? p.tier_prices[priceTier] : null;
    const v = t != null ? t : (p.sale_price ?? p.consumer_price);
    return v != null && v !== '' ? Number(v) : null;
  };
  const ordered = useMemo(() => {
    if (sortKey === 'name') return visible;
    const list = [...visible];
    if (sortKey === 'avail') {
      const avail = availableRef.current;
      if (!avail) return visible;
      const val = (p: any) => { const v = avail(p.id); return v === null ? -Infinity : v; };
      return list.sort((a, b) => val(b) - val(a));
    }
    const dir = sortKey === 'price_desc' ? -1 : 1;
    const val = (p: any) => {
      const v = priceFor ? priceFor(p.id) : salePriceOf(p);
      return typeof v === 'number' ? v : Number(v) || 0;
    };
    return list.sort((a, b) => dir * (val(a) - val(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sortKey, priceTier, availabilityVersion]);

  /** عدد أصناف كل فئة لشكل الكروت لما الفلتر مش شغّال (`stockCounts` = null). */
  const allCounts = useMemo(() => {
    if (!cards) return null;
    const counts = new Map<string, number>();
    products.forEach((p) => counts.set(p.category, (counts.get(p.category) || 0) + 1));
    return counts;
  }, [cards, products]);

  /** بيترسم من القايمة قد إيه.
   *
   *  الكتالوج آلاف الأصناف، وكلهم كانوا بيتحطوا في الـDOM مرة واحدة — الشباك بيتجمّد
   *  ثواني قبل ما يبان. المعروض بيتقصّ، وبيزيد لما اللي بيدوّر يوصل لآخر القايمة. */
  const PAGE = 120;
  // الصفحة الأولى لازم تشمل الصف اللي كان مختار — وإلا Enter بيضيف صف مش ظاهر.
  const [shown, setShown] = useState(() => Math.max(PAGE, memory.cursor + PAGE));
  // مش على `open`: الفتحة الجديدة بترجع لنفس المكان (شوف `memory` فوق).
  useEffect(() => { setShown((n) => Math.max(PAGE, Math.min(n, memory.cursor + PAGE))); }, [query, activeCategory, activeRoot, onlyAvailableStock, sortKey]);
  const rendered = useMemo(() => ordered.slice(0, shown), [ordered, shown]);

  // Back to the top whenever the list underneath changes, so the highlight is never left pointing
  // at a row that scrolled out from under it.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setCursor(0);
  }, [query, activeCategory, activeRoot, onlyAvailableStock, sortKey]);
  // …and never past the end when a search narrows the list.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(ordered.length - 1, 0)));
  }, [ordered.length]);

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
  /**
   * شكل الكروت: المؤشر اللي اتحرّك بالماوس مابيحرّكش القايمة.
   *
   * الصف اللي تحت الماوس ظاهر أصلاً — ولو نصّه بس ظاهر على الحافة، `keepInView` كان
   * هيمرّر القايمة تحت الإيد. والعلَم ده بيتصفّر مع أول سهم.
   */
  const mouseCursor = useRef(false);
  /** آخر مكان حقيقي للماوس — عشان حركة «وهمية» بعد التمرير ماتتحسبش (شوف الكارت). */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * مكان التمرير المتفتكر بيترجّع **مرة واحدة** أول ما القايمة تتركّب، قبل أي سهم —
   * مش بمؤقّت بعد ٦٠ms ممكن يوصل بعد ما المستخدم اتحرك ويرجّع القايمة لورا.
   */
  const pendingScroll = useRef<number | null>(null);
  useEffect(() => {
    if (mouseCursor.current) { mouseCursor.current = false; return; }
    keepInView(rowRefs.current[cursor], listRef.current);
  }, [cursor, ordered.length]);
  useEffect(() => {
    if (!open) return;
    setQuery(memory.query);
    setCursor(memory.cursor);
    setPicked([]);
    setBulk(false);
    const jumpTo = memory.lastPicked;
    if (cards) {
      mouseCursor.current = false;
      pendingScroll.current = jumpTo == null ? memory.scrollTop : null;
      if (pendingScroll.current != null && listRef.current) {
        listRef.current.scrollTop = pendingScroll.current;
        pendingScroll.current = null;
      }
    }
    setTimeout(() => {
      searchRef.current?.focus?.(cards ? { preventScroll: true } : undefined);
      // اتختار صنف بالبحث ⇒ القايمة كلها رجعت، فمكان التمرير القديم كان على قايمة تانية.
      // المؤشر بيروح على الصنف نفسه و`keepInView` بيجيبه قدام العين.
      if (!cards && jumpTo == null && listRef.current) listRef.current.scrollTop = memory.scrollTop;
    }, 60);
  }, [open]);
  useEffect(() => {
    // بيستنى البحث يتفضّى الأول: الشباك بيفضل متركّب بين الفتحات، فأول رندر بعد الفتح
    // لسه شايل القايمة المتفلترة بالكلمة القديمة — والمكان فيها مش مكانه في القايمة كلها.
    if (!open || memory.lastPicked == null || query) return;
    const idx = ordered.findIndex((p) => p.id === memory.lastPicked);
    memory.lastPicked = null;
    if (idx < 0) return;
    setShown((n) => Math.max(n, idx + PAGE));
    setCursor(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ordered, query]);
  /** اختيار صنف — بيفضّي البحث للفتحة الجاية (شوف `PickerMemory`). */
  const pick = (id: number) => {
    if (memory.query) { memory.query = ''; memory.lastPicked = id; }
    onPick(id);
  };
  useEffect(() => { memory.query = query; }, [query]);
  useEffect(() => { memory.cursor = cursor; }, [cursor]);
  const rememberScroll = () => { if (listRef.current) memory.scrollTop = listRef.current.scrollTop; };

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (cards && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      mouseCursor.current = false;
      pendingScroll.current = null;
      // الصف الجاي لسه مش مترسوم ⇒ الصفحة الجاية بتتضاف تحت في نفس الرندر، فالمؤشر
      // مابيقعش على صف مش موجود، والإضافة تحت مابتحرّكش اللي فوق.
      if (e.key === 'ArrowDown' && cursor + 1 >= shown && shown < ordered.length) {
        setShown((n) => n + PAGE);
      }
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, ordered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && ordered[cursor]) {
      e.preventDefault();
      const p = ordered[cursor];
      const av = availableFor ? availableFor(p.id) : null;
      if (disableOutOfStock && av !== null && av <= 0) return;
      if (cards) addOne(p.id);
      else if (bulk) toggle(p.id);
      else pick(p.id);
    }
  };

  /** إضافة المحدّدين مرة واحدة — نفس زرار «أضف N صنف» في الشكل القديم. */
  const commitMany = (ids: number[]) => {
    if (!onPickMany || !ids.length) return;
    if (memory.query) { memory.query = ''; memory.lastPicked = ids[ids.length - 1] ?? null; }
    onPickMany(ids);
    setPicked([]);
  };
  /**
   * إضافة صنف واحد من شكل الكروت (Enter أو «+ إضافة»). لو فيه أصناف متعلّمة، بتتضاف
   * معاه — الشباك بيتقفل بعد الإضافة، والتحديد اللي كان متعمل مايضيعش من غير ما يتقال.
   */
  const addOne = (id: number) => {
    if (onPickMany && picked.length) commitMany([...picked.filter((x) => x !== id), id]);
    else pick(id);
  };

  const [catsExpanded, setCatsExpanded] = useState(false);

  if (cards) {
    const allActive = activeCategory === null && activeRoot === null;
    const cardCount = (c: string, children: string[] = []) => [c, ...children].reduce(
      (n, x) => n + ((stockCounts ? stockCounts.get(x) : allCounts?.get(x)) || 0), 0);
    const totalCount = stockCounts
      ? Array.from(stockCounts.values()).reduce((a, b) => a + b, 0) : products.length;
    const catTotal = groups.reduce((n, g) => n + 1 + g.children.length, 0);
    // المطويّة بتفضل شايلة الفئة المختارة، عشان الاختيار مايختفيش من على الجنب.
    const shownGroups = catsExpanded ? groups : groups.filter((g, i) => i < CAT_PREVIEW
      || g.value === activeRoot || g.value === activeCategory
      || (activeCategory != null && g.children.includes(activeCategory)));
    const heading = title === 'اختر الصنف' ? 'اختيار صنف من المخزن / الكتالوج' : title;
    const forDoc = hidePurchasePrice ? 'للفاتورة' : 'للمستند';
    const showStockToggle = Boolean(availableFor && disableOutOfStock);
    const sortOptions = [
      { value: 'name', label: 'الاسم (أبجدي)' },
      ...(availableFor ? [{ value: 'avail', label: 'الأكثر رصيداً' }] : []),
      { value: 'price_desc', label: 'السعر: الأعلى أولاً' },
      { value: 'price_asc', label: 'السعر: الأقل أولاً' },
    ];
    const toggleStock = () => {
      const next = !onlyAvailableStock;
      setOnlyAvailableStock(next);
      try { localStorage.setItem('picker.onlyAvailable', next ? '1' : '0'); }
      catch { /* متصفح مقفّل التخزين — الاختيار بيعيش للجلسة دي */ }
      searchRef.current?.focus?.({ preventScroll: true });
    };
    const catItem = (key: string, label: string, count: number | null, active: boolean,
      onClick: () => void, child = false) => (
      <div key={key} className={`ppk-cat${active ? ' is-active' : ''}${child ? ' is-child' : ''}`}
        onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
        <span className="ppk-cat-label">{label}</span>
        {count != null && <span className="ppk-cat-count">{qty(count)}</span>}
      </div>
    );

    return (
      <TabModal open={open} onCancel={onCancel} footer={null} width={1150}
        rootClassName="ppk-cards" focusTriggerAfterClose={false} destroyOnHidden
        title={(
          <div className="ppk-head">
            <div className="ppk-head-icon"><AppstoreOutlined /></div>
            <div className="ppk-head-text">
              <div className="ppk-title">
                {heading}
                <span className="ppk-pill">بحث فوري</span>
              </div>
              <div className="ppk-sub">
                {warehouseName && (
                  <span><span className="ppk-dot" />المخزن النشط: <b>{warehouseName}</b></span>
                )}
                {availableFor && <span>رصيد متاح لحظي</span>}
                {priceTierLabel && <span>سعر البيع الافتراضي: <b>{priceTierLabel}</b></span>}
              </div>
            </div>
          </div>
        )}>
        <div className="ppk-body">
          <div className="ppk-search-row">
            <Input
              ref={searchRef} size="large" allowClear value={query} className="ppk-search"
              prefix={<SearchOutlined className="ppk-search-icon" />}
              suffix={<span className="ppk-key">Enter</span>}
              placeholder={activeLabel
                ? `ابحث في «${activeLabel}» بالاسم أو كود الصنف…`
                : 'ابحث بالاسم، كود الصنف (SKU)، المقاس…'}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {showStockToggle && (
              <button type="button"
                className={`ppk-chip${onlyAvailableStock ? ' is-on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={toggleStock}>
                {onlyAvailableStock && <CheckOutlined />} المتاح في المخزن فقط
              </button>
            )}
            <Select
              className="ppk-sort" size="large" value={sortKey} options={sortOptions}
              popupMatchSelectWidth={false}
              onChange={(v) => { setSortKey(v as SortKey); setTimeout(() => searchRef.current?.focus?.({ preventScroll: true }), 0); }}
            />
          </div>

          <div className="ppk-split">
            <aside className="ppk-side-cats">
              <div className="ppk-cats-head">
                <span>التصنيفات والمجموعات</span>
                <span className="ppk-cats-badge">{qty(catTotal)}</span>
              </div>
              <div className="ppk-cats-list">
                {catItem('__all', 'كل الفئات', totalCount, allActive,
                  () => { setActiveRoot(null); onCategoryChange(null); })}
                {shownGroups.map((g) => {
                  const rootActive = activeRoot === g.value && !activeCategory;
                  return (
                    <React.Fragment key={g.value}>
                      {catItem(g.value, catLabel(g.value), cardCount(g.value, g.children),
                        rootActive || activeCategory === g.value,
                        () => {
                          if (g.children.length) { setActiveRoot(g.value); onCategoryChange(null); }
                          else { setActiveRoot(null); onCategoryChange(g.value); }
                        })}
                      {g.children.map((c) => catItem(c, catLabel(c), cardCount(c),
                        c === activeCategory,
                        () => { setActiveRoot(g.value); onCategoryChange(c); }, true))}
                    </React.Fragment>
                  );
                })}
                {groups.length > CAT_PREVIEW && (
                  <button type="button" className="ppk-more-cats"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setCatsExpanded((x) => !x)}>
                    {catsExpanded ? 'عرض أقل' : `عرض المزيد (${qty(groups.length - shownGroups.length)})`}
                  </button>
                )}
              </div>
            </aside>

            <section className="ppk-main">
              <div className="ppk-main-head">
                <div>
                  <b>{hidePurchasePrice ? 'الأصناف المتاحة للبيع' : 'الأصناف'}</b>
                  <span className="ppk-found"> (تم العثور على {qty(ordered.length)} صنف مطابق)</span>
                </div>
                {availableFor && (
                  <div className="ppk-legend">
                    <span><i className="ppk-lg ok" />رصيد متاح</span>
                    <span><i className="ppk-lg low" />رصيد حرج (&lt;{qty(LOW_STOCK)})</span>
                  </div>
                )}
              </div>
              <div className="ppk-list" onKeyDown={onKeyDown} onScroll={rememberScroll}
                ref={(el) => {
                  listRef.current = el;
                  if (el && pendingScroll.current != null) {
                    el.scrollTop = pendingScroll.current;
                    pendingScroll.current = null;
                  }
                }}>
                {ordered.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={query
                      ? (activeLabel
                        ? `لا يوجد صنف بهذا الاسم في «${activeLabel}» — جرّب «كل الفئات»`
                        : 'لا يوجد صنف بهذا الاسم')
                      : (onlyAvailableStock ? 'لا توجد أصناف برصيد متاح في هذا المخزن' : 'لا توجد أصناف')} />
                ) : rendered.map((p, i) => {
                  const available = availableFor ? availableFor(p.id) : null;
                  const out = Boolean(disableOutOfStock && available !== null && available <= 0);
                  const checked = picked.includes(p.id);
                  const isCursor = i === cursor;
                  const level = available === null ? null
                    : (available <= 0 ? 'zero' : (available < LOW_STOCK ? 'low' : 'ok'));
                  const price = priceFor ? priceFor(p.id) : salePriceOf(p);
                  const priceLabel = priceFor ? 'السعر'
                    : (priceTierLabel && priceTier && p.tier_prices?.[priceTier] != null
                      ? `سعر ${priceTierLabel}` : 'سعر البيع');
                  const cost = !priceFor && !hidePurchasePrice && p.purchase_price != null
                    && Number(p.purchase_price) > 0 ? Number(p.purchase_price) : null;
                  const pack = p.pieces_per_unit && Number(p.pieces_per_unit) > 0
                    ? `${qty(p.pieces_per_unit)} ${p.piece_name || 'قطعة'}` : null;
                  return (
                    <div key={p.id}
                      ref={(el) => { rowRefs.current[i] = el; }}
                      className={['ppk-card', isCursor && 'is-cursor', checked && 'is-checked',
                        out && 'is-out'].filter(Boolean).join(' ')}
                      // الضغط على الكارت مايسحبش التركيز من خانة البحث (شوف الشكل القديم تحت).
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (out) return;
                        if (onPickMany) toggle(p.id); else pick(p.id);
                      }}
                      // `mousemove` مش `mouseenter`: لما القايمة بتتمرّر بالأسهم، الصف اللي
                      // بيعدّي تحت ماوس واقف بياخد `mouseenter` — والمؤشر كان بيقفز لنص الشاشة.
                      // الحركة اللي مالهاش إزاحة (المتصفح بيبعتها بعد التمرير) بتتساب.
                      onMouseMove={(e) => {
                        const last = pointerRef.current;
                        if (e.movementX === 0 && e.movementY === 0) return;
                        if (last && last.x === e.clientX && last.y === e.clientY) return;
                        pointerRef.current = { x: e.clientX, y: e.clientY };
                        if (i !== cursor) { mouseCursor.current = true; setCursor(i); }
                      }}>
                      {onPickMany && (
                        <Checkbox className="ppk-check" checked={checked} disabled={out} tabIndex={-1} />
                      )}
                      <div className="ppk-info">
                        <div className="ppk-name-row">
                          <b className="ppk-name">{p.name}</b>
                          {p.code && <span className="ppk-code">{p.code}</span>}
                          {level === 'low' && <span className="ppk-tag low">رصيد محدود</span>}
                          {level === 'zero' && <span className="ppk-tag zero">غير متاح في المخزن</span>}
                          {p.is_serialized && <span className="ppk-tag info">بسيريال</span>}
                        </div>
                        <div className="ppk-meta">
                          {p.category && <span>الفئة: {catLabel(p.category)}</span>}
                          {p.unit_of_measure && <span>الوحدة: {p.unit_of_measure}</span>}
                          {pack && <span>التعبئة: {pack}</span>}
                        </div>
                      </div>
                      <div className="ppk-figs">
                        {level !== null && (
                          <div className={`ppk-box avail ${level}`}>
                            <span>المتاح</span><b>{qty(available)}</b>
                          </div>
                        )}
                        {price != null && price !== '' && (
                          <div className="ppk-box price">
                            <span>{priceLabel}</span>
                            <b>{typeof price === 'number' ? money(price) : price}</b>
                          </div>
                        )}
                        {cost != null && (
                          <div className="ppk-box cost"><span>سعر الشراء</span><b>{money(cost)}</b></div>
                        )}
                        <Button type="primary" className="ppk-add" disabled={out} tabIndex={-1}
                          icon={isCursor ? undefined : <PlusOutlined />}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => { e.stopPropagation(); if (!out) addOne(p.id); }}>
                          {isCursor ? 'إضافة ↵' : 'إضافة'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {rendered.length < ordered.length && (
                  <button type="button" className="ppk-more-items"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShown((n) => n + PAGE)}>
                    عرض المزيد ({qty(ordered.length - rendered.length)} صنف كمان)
                  </button>
                )}
              </div>
            </section>
          </div>

          <div className="ppk-foot">
            <div className="ppk-foot-actions">
              {onPickMany && (
                <Button disabled={!picked.length} onClick={() => commitMany(picked)}>
                  إضافة مجمعة ({qty(picked.length)} محدد)
                </Button>
              )}
            </div>
            <div className="ppk-hints">
              <span><span className="ppk-key">اكتب</span> للبحث الفوري</span>
              <span><span className="ppk-key">↑↓</span> للتنقل بين السطور</span>
              <span><span className="ppk-key">Enter</span> للإضافة السريعة {forDoc}</span>
              <span><span className="ppk-key">Esc</span> للإغلاق</span>
            </div>
            <div className="ppk-foot-actions">
              <Button onClick={onCancel}>إغلاق (Esc)</Button>
              <Button type="primary" className="ppk-done" icon={<CheckOutlined />}
                onClick={() => { if (onPickMany && picked.length) commitMany(picked); else onCancel(); }}>
                تم واعتماد الأصناف {forDoc}
              </Button>
            </div>
          </div>
        </div>
      </TabModal>
    );
  }

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
                    {(stockCounts || g.children.length > 0) && (
                      <span style={{ fontSize: 11, opacity: 0.75, marginInlineStart: 6 }}>
                        ({stockCounts ? countOf(g.value, g.children) : g.children.length})
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
                        {stockCounts && (
                          <span style={{ fontSize: 11, opacity: 0.75, marginInlineStart: 6 }}>
                            ({countOf(c)})
                          </span>
                        )}
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
          <div ref={listRef} style={{ maxHeight: '52vh', overflowY: 'auto' }} onKeyDown={onKeyDown}
            onScroll={rememberScroll}>
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
                  onClick={() => { if (out) return; return bulk ? toggle(p.id) : pick(p.id); }}
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
                    {/* الكود مابيتعرضش (قرار العميل) — البحث بيه لسه شغّال فوق. */}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {priceFor && priceFor(p.id) != null && (
                      <Tag color="blue" style={{ fontWeight: 600, fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>
                        السعر: {typeof priceFor(p.id) === 'number' ? fmtPrice(priceFor(p.id)) : priceFor(p.id)}
                      </Tag>
                    )}
                    {!priceFor && !hidePurchasePrice && p.purchase_price != null && Number(p.purchase_price) > 0 && (
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
                onClick={() => {
                  if (memory.query) { memory.query = ''; memory.lastPicked = picked[picked.length - 1] ?? null; }
                  onPickMany(picked); setPicked([]);
                }}
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
