import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compareArabic, searchByName, sortByName } from '../utils/arabicSort';
import {
  Button, Checkbox, Col, Empty, Input, InputNumber, Row, Select, Space, Tag
} from 'antd';
import { AppstoreOutlined, CheckOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { keepInView } from '../utils/keepInView';
import { normalizeAr } from './ListToolbar';
import { TabModal } from './TabModal';
import { qty, money, numeralsLocale } from '../utils/money';
import { dualQty, lengthUnits } from '../utils/units';
import { useCategoryTree, withChildren } from '../hooks/useCategoryTree';
import { activeChoices } from '../utils/active';
import './ProductPickerModal.css';

interface Props {
  open: boolean;
  categories: string[];
  categoryLabels: Record<string, string>;
  products: any[];
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  hideCategories?: boolean;
  onPick: (itemId: number, qty?: number | null) => void;
  onPickMany?: (itemIds: number[], qtys?: Record<number, number>) => void;
  onCancel: () => void;
  title?: string;
  availableFor?: (itemId: number) => number | null;
  priceFor?: (itemId: number) => number | string | null;
  disableOutOfStock?: boolean;
  availabilityVersion?: string | number;
  hidePurchasePrice?: boolean;
  variant?: 'classic' | 'cards';
  warehouseName?: string | null;
  priceTier?: string | null;
  priceTierLabel?: string | null;
}

const LOW_STOCK = 5;
const CAT_PREVIEW = 14;
type SortKey = 'name' | 'avail' | 'price_desc' | 'price_asc';

const fmtPrice = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '';

type PickerMemory = { query: string; scrollTop: number; cursor: number; lastPicked?: number | null };
const memories: Record<string, PickerMemory> = {};

export default function ProductPickerModal({
  open, categories, categoryLabels, products: allProducts, activeCategory, onCategoryChange, hideCategories,
  onPick, onPickMany, onCancel, title = 'اختر الصنف', availableFor, priceFor,
  disableOutOfStock = false, availabilityVersion, hidePurchasePrice = false,
  variant = 'cards', warehouseName, priceTier, priceTierLabel,
}: Props) {
  const cards = variant === 'cards';
  const products = useMemo(() => activeChoices(allProducts), [allProducts]);
  const memory = (memories[title] ??= { query: '', scrollTop: 0, cursor: 0 });
  const [query, setQuery] = useState(() => memory.query);
  const [cursor, setCursor] = useState(() => memory.cursor);
  const { tree } = useCategoryTree();
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [onlyAvailableStockPref, setOnlyAvailableStock] = useState(() => {
    try {
      const v = localStorage.getItem('picker.onlyAvailable');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  const onlyAvailableStock = variant === 'cards' && disableOutOfStock ? true : onlyAvailableStockPref;
  const searchRef = useRef<any>(null);

  const availableRef = useRef(availableFor);
  availableRef.current = availableFor;

  useEffect(() => {
    if (!activeCategory) return;
    setActiveRoot(tree.parentOf[activeCategory] || null);
  }, [activeCategory, tree]);

  const accepted = useMemo(() => {
    if (activeCategory) return new Set([activeCategory]);
    if (activeRoot) return new Set(withChildren(tree, activeRoot));
    return null;
  }, [activeCategory, activeRoot, tree]);

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

  const countOf = (c: string, children: string[] = []) => (stockCounts
    ? [c, ...children].reduce((n, x) => n + (stockCounts.get(x) || 0), 0) : null);

  useEffect(() => {
    if (!stockCounts) return;
    if (activeCategory && !stockCounts.get(activeCategory)) onCategoryChange(null);
    if (activeRoot && !groups.some((g) => g.value === activeRoot)) setActiveRoot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockCounts, groups]);

  const catLabel = (c: string) => categoryLabels[c] || tree.labels[c] || c;
  const activeLabel = activeCategory ? catLabel(activeCategory)
    : (activeRoot ? catLabel(activeRoot) : null);

  const visible = useMemo(() => {
    let list = accepted ? products.filter((p) => accepted.has(p.category)) : products;
    const needle = normalizeAr(query);
    if (needle) {
      list = searchByName(list, needle, (p) => p.name, (p) => p.code);
    }
    const avail = availableRef.current;
    if (disableOutOfStock && onlyAvailableStock && avail) {
      const inStock = list.filter((p) => {
        const av = avail(p.id);
        return av === null || av > 0;
      });
      const unknown = list.length > 0 && list.every((p) => avail(p.id) === null);
      list = unknown && cards ? [] : (inStock.length || cards ? inStock : list);
    }
    return needle ? list : sortByName(list, (p) => p.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, accepted, products, disableOutOfStock, onlyAvailableStock,
      availabilityVersion]);

  const [sortKey, setSortKey] = useState<SortKey>('name');
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

  const allCounts = useMemo(() => {
    if (!cards) return null;
    const counts = new Map<string, number>();
    products.forEach((p) => counts.set(p.category, (counts.get(p.category) || 0) + 1));
    return counts;
  }, [cards, products]);

  const PAGE = 120;
  const FIRST = 30;
  const [shown, setShown] = useState(() => Math.max(FIRST, memory.cursor + FIRST));
  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => setShown((n) => Math.max(n, PAGE)), 60);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { setShown((n) => Math.max(PAGE, Math.min(n, memory.cursor + PAGE))); }, [query, activeCategory, activeRoot, onlyAvailableStock, sortKey]);
  const rendered = useMemo(() => ordered.slice(0, shown), [ordered, shown]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setCursor(0);
  }, [query, activeCategory, activeRoot, onlyAvailableStock, sortKey]);
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(ordered.length - 1, 0)));
  }, [ordered.length]);

  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const mouseCursor = useRef(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
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
    setQtys({});
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
      if (!cards && jumpTo == null && listRef.current) listRef.current.scrollTop = memory.scrollTop;
    }, 60);
  }, [open]);
  useEffect(() => {
    if (!open || memory.lastPicked == null || query) return;
    const idx = ordered.findIndex((p) => p.id === memory.lastPicked);
    memory.lastPicked = null;
    if (idx < 0) return;
    setShown((n) => Math.max(n, idx + PAGE));
    setCursor(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ordered, query]);
  const pick = (id: number) => {
    if (memory.query) { memory.query = ''; memory.lastPicked = id; }
    onPick(id, qtys[id] ?? null);
  };
  useEffect(() => { memory.query = query; }, [query]);
  useEffect(() => { memory.cursor = cursor; }, [cursor]);
  const rememberScroll = () => { if (listRef.current) memory.scrollTop = listRef.current.scrollTop; };

  const [rowMode, setRowMode] = useState(false);
  const qtyDraft = useRef<{ id: number; text: string } | null>(null);
  useEffect(() => { if (!open) { setRowMode(false); qtyDraft.current = null; } }, [open]);

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = ordered[cursor];
    if (cards && rowMode && at) {
      const ch = e.key.length === 1
        ? e.key.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.')
        : e.key;
      const draft = qtyDraft.current;
      const prevText = draft && draft.id === at.id
        ? draft.text : (qtys[at.id] != null ? String(qtys[at.id]) : '');
      if (/^[0-9.]$/.test(ch)) {
        e.preventDefault();
        const text = (draft && draft.id === at.id ? prevText : '') + ch;
        qtyDraft.current = { id: at.id, text };
        const n = Number(text);
        setQtyOf(at.id, Number.isNaN(n) ? null : n);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        const text = prevText.slice(0, -1);
        qtyDraft.current = { id: at.id, text };
        setQtyOf(at.id, text === '' ? null : Number(text));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const av = availableFor ? availableFor(at.id) : null;
        if (disableOutOfStock && av !== null && av <= 0) return;
        if (!onPickMany) { addOne(at.id); return; }
        setPicked((prev) => (prev.includes(at.id) ? prev : [...prev, at.id]));
        qtyDraft.current = null;
        setRowMode(false);
        setQuery('');
        searchRef.current?.focus?.({ preventScroll: true });
        return;
      }
      if (e.key.length === 1) { setRowMode(false); qtyDraft.current = null; }
    }
    if (cards && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setRowMode(true);
      qtyDraft.current = null;
      mouseCursor.current = false;
      pendingScroll.current = null;
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

  const commitMany = (ids: number[]) => {
    if (!onPickMany || !ids.length) return;
    if (memory.query) { memory.query = ''; memory.lastPicked = ids[ids.length - 1] ?? null; }
    const typed: Record<number, number> = {};
    ids.forEach((id) => { if (qtys[id] > 0) typed[id] = qtys[id]; });
    onPickMany(ids, typed);
    setPicked([]);
    setQtys({});
  };
  const addOne = (id: number) => {
    if (onPickMany && picked.length) commitMany([...picked.filter((x) => x !== id), id]);
    else pick(id);
  };

  const setQtyOf = (id: number, v: number | null) => {
    setQtys((prev) => {
      const next = { ...prev };
      if (v != null && v > 0) next[id] = v; else delete next[id];
      return next;
    });
    if (v != null && v > 0 && onPickMany) {
      setPicked((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
  };

  const [catsExpanded, setCatsExpanded] = useState(false);

  if (cards) {
    const allActive = activeCategory === null && activeRoot === null;
    const cardCount = (c: string, children: string[] = []) => [c, ...children].reduce(
      (n, x) => n + ((stockCounts ? stockCounts.get(x) : allCounts?.get(x)) || 0), 0);
    const totalCount = stockCounts
      ? Array.from(stockCounts.values()).reduce((a, b) => a + b, 0) : products.length;
    const catTotal = groups.reduce((n, g) => n + 1 + g.children.length, 0);
    const shownGroups = catsExpanded ? groups : groups.filter((g, i) => i < CAT_PREVIEW
      || g.value === activeRoot || g.value === activeCategory
      || (activeCategory != null && g.children.includes(activeCategory)));
    const heading = title === 'اختر الصنف' ? 'اختيار صنف من المخزن / الكتالوج' : title;
    const forDoc = hidePurchasePrice ? 'للفاتورة' : 'للمستند';
    const showStockToggle = false;
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
      catch {}
      searchRef.current?.focus?.({ preventScroll: true });
    };
    const selectable = rendered.filter((p) => {
      const av = availableFor ? availableFor(p.id) : null;
      return !(disableOutOfStock && av !== null && av <= 0);
    }).map((p) => p.id);
    const allSelected = selectable.length > 0 && selectable.every((id) => picked.includes(id));
    const showCost = !priceFor && !hidePurchasePrice;
    const catItem = (key: string, label: string, count: number | null, active: boolean,
      onClick: () => void, child = false) => (
      <div key={key} className={`ppk-cat${active ? ' is-active' : ''}${child ? ' is-child' : ''}`}
        onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
        <span className="ppk-cat-label">{label}</span>
        {count != null && <span className="ppk-cat-count">{qty(count)}</span>}
      </div>
    );

    return (
      <TabModal open={open} onCancel={onCancel} footer={null} width={1000}
        rootClassName="ppk-cards ppk-compact" focusTriggerAfterClose={false} destroyOnHidden
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
            {!hideCategories && <aside className="ppk-side-cats">
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
            </aside>}

            <section className="ppk-main">
              <div className="ppk-main-head">
                <div>
                  <b>{hidePurchasePrice ? 'الأصناف المتاحة للبيع' : 'الأصناف'}</b>
                  <span className="ppk-found"> (تم العثور على {qty(ordered.length)} صنف مطابق)</span>
                  {onPickMany && selectable.length > 0 && (
                    <button type="button" className="ppk-select-all"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setPicked((prev) => (allSelected
                        ? prev.filter((id) => !selectable.includes(id))
                        : [...prev, ...selectable.filter((id) => !prev.includes(id))]))}>
                      {allSelected ? 'إلغاء التحديد' : 'تحديد الكل المعروض'}
                    </button>
                  )}
                </div>
                {availableFor && (
                  <div className="ppk-legend">
                    <span><i className="ppk-lg ok" />رصيد متاح</span>
                    <span><i className="ppk-lg low" />رصيد حرج (&lt;{qty(LOW_STOCK)})</span>
                  </div>
                )}
              </div>
              <div className="ppk-cols">
                {onPickMany && <span className="c-check" />}
                <span className="c-name">الصنف</span>
                {availableFor && <span className="c-avail">المتاح</span>}
                <span className="c-price">{priceFor ? 'السعر' : 'سعر البيع'}</span>
                {showCost && <span className="c-cost">الشراء</span>}
                <span className="c-qty">الكمية</span>
                <span className="c-add" />
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
                  const mpp = Number(p.meters_per_piece || 0);
                  const both = mpp > 0 && level !== null
                    ? dualQty(available as number, lengthUnits(p.unit_of_measure, mpp)) : null;
                  return (
                    <div key={p.id}
                      ref={(el) => { rowRefs.current[i] = el; }}
                      className={['ppk-card', isCursor && 'is-cursor', checked && 'is-checked',
                        out && 'is-out'].filter(Boolean).join(' ')}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (out) return;
                        if (onPickMany) toggle(p.id); else pick(p.id);
                      }}
                      onMouseMove={(e) => {
                        const last = pointerRef.current;
                        if (e.movementX === 0 && e.movementY === 0) return;
                        if (last && last.x === e.clientX && last.y === e.clientY) return;
                        pointerRef.current = { x: e.clientX, y: e.clientY };
                        if (i !== cursor) { mouseCursor.current = true; setCursor(i); }
                      }}>
                      {onPickMany && (
                        <span className={`ppk-check-lite${checked ? ' is-on' : ''}`} aria-hidden="true">
                          {checked ? <CheckOutlined /> : null}
                        </span>
                      )}
                      <div className="ppk-info">
                        <div className="ppk-name-row">
                          <b className="ppk-name">{p.name}</b>
                          {p.unit_of_measure && <span className="ppk-unit">{p.unit_of_measure}</span>}
                          {pack && <span className="ppk-unit">التعبئة: {pack}</span>}
                          {mpp > 0 && <span className="ppk-unit">القطعة = {qty(mpp)} متر</span>}
                          {level === 'low' && <span className="ppk-tag low">رصيد محدود</span>}
                          {level === 'zero' && <span className="ppk-tag zero">غير متاح في المخزن</span>}
                          {p.is_serialized && <span className="ppk-tag info">بسيريال</span>}
                        </div>
                      </div>
                      <div className="ppk-figs">
                        {availableFor && (
                          <div className={`ppk-box avail ${level ?? ''}`} title={both ?? undefined}>
                            <span>المتاح</span><b>{level === null ? '—' : qty(available)}</b>
                            {both && <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{both}</span>}
                          </div>
                        )}
                        <div className="ppk-box price" title={priceLabel}>
                          <span>{priceLabel}</span>
                          <b>{price != null && price !== '' ? (typeof price === 'number' ? money(price) : price) : '—'}</b>
                        </div>
                        {showCost && (
                          <div className="ppk-box cost"><span>سعر الشراء</span><b>{cost != null ? money(cost) : '—'}</b></div>
                        )}
                        <span className="ppk-qty-wrap"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}>
                          <input
                            className={`ppk-qty-lite${isCursor && rowMode ? ' is-active' : ''}`}
                            inputMode="decimal" tabIndex={-1} disabled={out}
                            placeholder="الكمية" value={qtys[p.id] ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value
                                .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
                                .replace(/[٫,]/g, '.').replace(/[^0-9.]/g, '');
                              setQtyOf(p.id, raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') return;
                              e.stopPropagation();
                              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                searchRef.current?.focus?.({ preventScroll: true });
                                onKeyDown(e as any);
                                return;
                              }
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              if (onPickMany) setPicked((prev) => (prev.includes(p.id) ? prev : [...prev, p.id]));
                              searchRef.current?.focus?.({ preventScroll: true });
                            }} />
                        </span>
                        <button type="button" className="ppk-add-lite" disabled={out} tabIndex={-1}
                          aria-label="إضافة"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => { e.stopPropagation(); if (!out) addOne(p.id); }}>
                          {isCursor ? '↵' : <PlusOutlined />}
                        </button>
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
              <span><span className="ppk-key">↑↓</span> ثم الرقم = الكمية · <span className="ppk-key">Enter</span> يعلّمه ويرجّعك للبحث</span>
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
        {availableFor && disableOutOfStock && (
          <Button
            type={onlyAvailableStock ? 'primary' : 'default'}
            ghost={onlyAvailableStock}
            onClick={() => {
              const next = !onlyAvailableStock;
              setOnlyAvailableStock(next);
              try { localStorage.setItem('picker.onlyAvailable', next ? '1' : '0'); }
              catch {}
            }}
          >
            {onlyAvailableStock ? '✓ المتاح في المخزن فقط' : 'عرض كل الأصناف'}
          </Button>
        )}
      </div>

      <Row gutter={12}>
        <Col xs={24} md={7}>
          <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
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
              const rootActive = activeRoot === g.value && !activeCategory;
              return (
                <React.Fragment key={g.value}>
                  <div
                    onClick={() => {
                      if (g.children.length) {
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
                      <span style={{ fontSize: 14, opacity: 0.75, marginInlineStart: 6 }}>
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
                          marginInlineStart: 14, cursor: 'pointer', fontSize: 15,
                          background: active ? '#6AB42D' : '#fbfdfa',
                          color: active ? '#fff' : undefined,
                          border: '1px solid #eef4ec', fontWeight: active ? 700 : 400,
                        }}>
                        {catLabel(c)}
                        {stockCounts && (
                          <span style={{ fontSize: 14, opacity: 0.75, marginInlineStart: 6 }}>
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
              const out = Boolean(disableOutOfStock && available !== null && available <= 0);
              return (
                <div key={p.id}
                  ref={(el) => { rowRefs.current[i] = el; }}
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
                    <b style={{ color: out ? '#555b65' : undefined }}>{p.name}</b>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {priceFor && priceFor(p.id) != null && (
                      <Tag color="blue" style={{ fontWeight: 600, fontSize: 14, padding: '2px 8px', borderRadius: 6 }}>
                        السعر: {typeof priceFor(p.id) === 'number' ? fmtPrice(priceFor(p.id)) : priceFor(p.id)}
                      </Tag>
                    )}
                    {!priceFor && !hidePurchasePrice && p.purchase_price != null && Number(p.purchase_price) > 0 && (
                      <Tag color="blue" style={{ fontWeight: 600, fontSize: 14, padding: '2px 8px', borderRadius: 6 }}>
                        شراء: {fmtPrice(p.purchase_price)}
                      </Tag>
                    )}
                    {!priceFor && (p.sale_price != null || p.consumer_price != null) && Number(p.sale_price || p.consumer_price) > 0 && (
                      <Tag color="cyan" style={{ fontWeight: 600, fontSize: 14, padding: '2px 8px', borderRadius: 6 }}>
                        بيع: {fmtPrice(p.sale_price || p.consumer_price)}
                      </Tag>
                    )}
                    {available !== null && (
                      <Tag
                        color={available > 0 ? 'success' : 'error'}
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}
                      >
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
        <span style={{ fontSize: 14, color: '#6b6b6b' }}>
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
