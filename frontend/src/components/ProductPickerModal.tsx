import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Col, Empty, Input, Row, Space, Tag
} from 'antd';
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
  /**
   * يمنع اختيار الصنف اللي مافيش منه حاجة في المكان المختار.
   *
   * البيع بيرفض السطر ده على أي حال — المخزون مابينزلش تحت الصفر — فالسماح باختياره
   * معناه إن الواحد يضيفه ويكتب كمية ويتقاله «الكمية غير متاحة» بعد تلات خطوات. المنع
   * من الأول بيقول نفس الحاجة قبل ما يتعب فيها.
   *
   * الشرا مابيمنعش: هو بيدخّل بضاعة مش بيطلّعها، والصفر عنده حالة عادية.
   */
  blockUnavailable?: boolean;
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function ProductPickerModal({
  open, categories, categoryLabels, products, activeCategory, onCategoryChange,
  onPick, onPickMany, onCancel, title = 'اختر الصنف', availableFor,
  blockUnavailable = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  // اضافة مجمعة: for the storekeeper entering twenty lines off a paper list, one at a time is
  // twenty round trips through this window. Ticking them and adding once is the same work in one.
  const [bulk, setBulk] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const searchRef = useRef<any>(null);

  // A search that spans categories is the fastest path when the user already knows the name, so
  // typing overrides the category filter rather than narrowing inside it.
  //
  // With neither a search nor a category, EVERY product is listed. It used to show nothing and
  // wait to be told where to look — which meant opening the window put you in front of an empty
  // box with nothing highlighted, so the arrows had nothing to move between and Enter had nothing
  // to add. A full list costs a scroll; an empty one costs a decision before you can start.
  const visible = useMemo(() => {
    const needle = normalizeAr(query);
    if (needle) {
      return products.filter((p) => normalizeAr(p.name).includes(needle)
        || normalizeAr(p.code || '').includes(needle));
    }
    return activeCategory ? products.filter((p) => p.category === activeCategory) : products;
  }, [query, activeCategory, products]);

  // Back to the top whenever the list underneath changes, so the highlight is never left pointing
  // at a row that scrolled out from under it.
  useEffect(() => { setCursor(0); }, [query, activeCategory, open]);
  // …and never past the end when a search narrows the list.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(visible.length - 1, 0)));
  }, [visible.length]);

  // Keep the highlighted row on screen — arrowing past the fold is how a keyboard user loses
  // track of what Enter is about to add.
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
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
      if (bulk) toggle(visible[cursor].id);
      else onPick(visible[cursor].id);
    }
  };

  return (
    <TabModal open={open} onCancel={onCancel} footer={null} width={860} title={title}
      // Do NOT hand focus back to whatever opened this. In the entry loop the opener is the
      // PREVIOUS line's quantity box, and restoring to it stole the caret back from the new
      // line the pick had just created — which is why the first product landed on its quantity
      // and every one after it did not. The screen decides where the caret goes next.
      focusTriggerAfterClose={false}
      destroyOnHidden styles={{ body: { paddingTop: 8 } }}>
      <Input
        ref={searchRef} size="large" allowClear value={query}
        placeholder="ابحث بالاسم أو الكود — أو اختر فئة من جنب"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        style={{ marginBottom: 12 }}
      />

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
          <div style={{ maxHeight: '52vh', overflowY: 'auto' }} onKeyDown={onKeyDown}>
            {visible.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={query ? 'مافيش صنف بالاسم ده' : 'مافيش أصناف'} />
            ) : visible.map((p, i) => {
              const available = availableFor ? availableFor(p.id) : null;
              // مقفول بس لما المتاح **معروف** إنه صفر. `null` معناها «مش عارفين» — ودي
              // مش نفس «مافيش»، والقفل عليها كان هيمنع بيع بضاعة موجودة.
              const out = blockUnavailable && available !== null && available <= 0;
              return (
                <div key={p.id}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  onClick={() => {
                    if (out) return;
                    return bulk ? toggle(p.id) : onPick(p.id);
                  }}
                  onMouseEnter={() => setCursor(i)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 12px', borderRadius: 6, marginBottom: 4,
                    cursor: out ? 'not-allowed' : 'pointer',
                    opacity: out ? 0.55 : 1,
                    background: out ? '#fafafa' : (i === cursor ? '#eaf5e2' : '#fff'),
                    border: `1px solid ${out ? '#eee' : (i === cursor ? '#6AB42D' : '#f0f0f0')}`,
                  }}>
                  <span>
                    {bulk && (
                      <span style={{ marginInlineEnd: 8 }}>
                        {picked.includes(p.id) ? '☑' : '☐'}
                      </span>
                    )}
                    <b>{p.name}</b>
                    {p.code && <Tag style={{ marginInlineStart: 8 }}>{p.code}</Tag>}
                  </span>
                  {available !== null && (
                    <span style={{ color: available > 0 ? '#6AB42D' : '#cf1322', fontSize: 13 }}>
                      {out ? 'مش موجود في المخزن ده' : `المتاح: ${qty(available)}`}
                    </span>
                  )}
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
