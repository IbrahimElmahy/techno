import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Col, Empty, Input, Row, Space, Tag
} from 'antd';
import { keepInView } from '../utils/keepInView';
import { normalizeAr } from './ListToolbar';
import { TabModal } from './TabModal';

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
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
const fmtPrice = (v: any) => Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';

export default function ProductPickerModal({
  open, categories, categoryLabels, products, activeCategory, onCategoryChange,
  onPick, onPickMany, onCancel, title = 'اختر الصنف', availableFor, priceFor,
  disableOutOfStock = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [bulk, setBulk] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  // بيبتدي مطفي — والفلتر ده بيخفي أصناف، فاللي بيخفي لازم يكون المستخدم هو اللي طلبه.
  // شغّال بالافتراضي معناه إن الصنف بيختفي من القايمة من غير ما حد يعرف ليه.
  const [onlyAvailableStock, setOnlyAvailableStock] = useState(false);
  const searchRef = useRef<any>(null);

  const visible = useMemo(() => {
    let list = activeCategory ? products.filter((p) => p.category === activeCategory) : products;
    const needle = normalizeAr(query);
    if (needle) {
      list = products.filter((p) => normalizeAr(p.name).includes(needle)
        || normalizeAr(p.code || '').includes(needle));
    }
    if (disableOutOfStock && onlyAvailableStock && availableFor) {
      list = list.filter((p) => {
        const av = availableFor(p.id);
        return av === null || av > 0;
      });
    }
    return list;
  }, [query, activeCategory, products, disableOutOfStock, onlyAvailableStock, availableFor]);

  // Back to the top whenever the list underneath changes, so the highlight is never left pointing
  // at a row that scrolled out from under it.
  useEffect(() => { setCursor(0); }, [query, activeCategory, open, onlyAvailableStock]);
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
            placeholder="ابحث بالاسم أو الكود — أو اختر فئة من جنب"
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
            onClick={() => setOnlyAvailableStock(!onlyAvailableStock)}
          >
            {onlyAvailableStock ? '✓ المتاح في المخزن فقط' : 'عرض كل الأصناف'}
          </Button>
        )}
      </div>

      <Row gutter={12}>
        <Col xs={24} md={7}>
          <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {categories.map((c) => {
              const active = c === activeCategory && !query;
              return (
                <div key={c}
                  onClick={() => { setQuery(''); onCategoryChange(c); }}
                  style={{
                    padding: '8px 10px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                    background: active ? '#6AB42D' : '#f6faf3',
                    color: active ? '#fff' : undefined,
                    border: '1px solid #e6efe3', fontWeight: active ? 700 : 400,
                  }}>
                  {categoryLabels[c] || c}
                </div>
              );
            })}
          </div>
        </Col>

        <Col xs={24} md={17}>
          <div ref={listRef} style={{ maxHeight: '52vh', overflowY: 'auto' }} onKeyDown={onKeyDown}>
            {visible.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={query ? 'لا يوجد صنف بهذا الاسم' : (onlyAvailableStock ? 'لا توجد أصناف برصيد متاح في هذا المخزن' : 'لا توجد أصناف')} />
            ) : visible.map((p, i) => {
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
