import React from 'react';
import ColumnSettings, { orderKeys, useHiddenColumns } from './ColumnSettings';

/**
 * شبكة سطور المستند — بأعمدة بتتخفي وبتتترتّب.
 *
 * شبكات إدخال السطور (فاتورة البيع، الشرا، المرتجعين، التسعير، التحويل) كلها جداول HTML
 * مكتوبة بالإيد: `<thead>` فيه العناوين بترتيبها، والخلايا مكتوبة في نفس الترتيب جوّه
 * `<tr>`. ده أسرع من جدول antd في الإدخال — الخلية فيها `InputNumber` والتركيز بيتنقل
 * بالكيبورد بينهم — بس معناه إن الأعمدة مالهاش وجود كـ**بيانات**، فمافيش حاجة تقدر تخفي
 * عمود أو تحرّكه.
 *
 * الشاشة اللي كانت بتقدّم إخفاء كانت بتعمله بـ`showCol(key)` قبل كل خلية: تشتغل، بس
 * الترتيب مستحيل — الخلية مكانها في الـJSX، مش في قايمة. وده بالظبط اللي فاتورة البيع
 * كانت بتقوله في تعليق: «مافيش أسهم ترتيب هنا لأن الخلايا محطوطة بالإيد».
 *
 * الملف ده بيحوّل الأعمدة لبيانات: كل عمود `{key, title, cell}`، والجدول بيترسم من
 * القايمة بعد ما تتفلتر وتترتّب. الإخفاء والترتيب بقوا بيشتغلوا على أي شبكة بنفس السطر،
 * والتفضيلات بتتخزّن لكل شاشة لوحدها.
 */
export interface EntryColumn<T> {
  key: string;
  title: React.ReactNode;
  /** العنوان في قايمة الإخفاء — لما `title` مايكونش نص (زي عمود الأزرار). */
  label?: string;
  /** العرض الافتراضي بالبكسل — المستخدم يقدر يسحبه، واللي سحبه بيتحفظ. */
  width?: number | string;
  /** أقل عرض يتسحب له العمود (الافتراضي ٥٠ أو العرض الافتراضي لو أصغر). */
  minWidth?: number;
  /** الاسم الكامل كتلميح على العنوان — لما العنوان متختصر. */
  tip?: string;
  /** ستايل الخلية — بيتحط على `<td>`. */
  cellStyle?: React.CSSProperties;
  /** خصائص زيادة على `<td>` — زي `data-` بتاعة التنقل بالكيبورد. */
  cellProps?: (row: T, index: number) => React.HTMLAttributes<HTMLTableCellElement>;
  cell: (row: T, index: number) => React.ReactNode;
  /** عمود مايتخفيش — الصنف والإجمالي عادةً. */
  locked?: boolean;
  /**
   * خلية العمود ده في صف الإجماليات، لو ليه واحدة.
   *
   * صف الإجماليات كان بيتكتب بـ`colSpan` ثابت («أربعة: الرقم والمخزن والصنف والوحدة»)،
   * وده بيتكسر أول ما حد يخفي عمود أو يحرّكه — الإجمالي بيزحلق ويقع تحت عنوان تاني، رقم
   * صح تحت اسم غلط. لما الخلية بتبقى بتاعة العمود نفسه، هي بتتحرك معاه.
   */
  footer?: (rows: T[]) => React.ReactNode;
  /**
   * عرض العمود لما الشبكة متبنية بـ`Row`/`Col` مش `<table>` (شاشة المرتجع).
   *
   * المرتجع بيجمّع سطوره تحت رؤوس فئات، فمينفعش يبقى جدول واحد؛ بس رأسه وخلاياه لسه
   * متقابلين بالموضع بالظبط زي `thead`/`tbody`، فنفس القايمة بترسمهم الاتنين.
   */
  span?: number;
  /** العرض على الموبايل — `xs` بتاعة antd. */
  xs?: number;
  /** محاذاة الخلية والعنوان. */
  align?: 'right' | 'center' | 'left';
}

const MIN_COL = 50;

function loadWidths(key: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function saveWidths(key: string, w: Record<string, number>) {
  try { localStorage.setItem(key, JSON.stringify(w)); } catch { /* من غير تخزين: العرض بيرجع افتراضي */ }
}

export function useEntryGrid<T>(storageKey: string, columns: EntryColumn<T>[]) {
  const prefs = useHiddenColumns(storageKey);
  const allKeys = columns.map((c) => c.key);

  /**
   * عرض الأعمدة — بيتسحب من حد العنوان (طلب العميل ٢٠٢٦-١٠-٠٣).
   *
   * الجدول `table-layout: fixed` بعروض في `<colgroup>`، فالعرض اللي اتقال بيتنفّذ بالظبط.
   * عرضه ١٠٠٪ وأقلّه مجموع الأعمدة: لو الشاشة أوسع الفرق بيتوزّع بالنسبة، ولو أضيق
   * التمرير الأفقي جوّه `.sale-grid-wrap` بس، وعمود الإجراء لازق في آخر السطر.
   * المحفوظ بيتخزّن جنب الإخفاء والترتيب (`cols:<key>:widths`)، ومفاتيح أعمدة اتشالت بتتجاهل.
   */
  const widthsKey = `cols:${storageKey}:widths`;
  const [widths, setWidths] = React.useState<Record<string, number>>(() => loadWidths(widthsKey));
  const defWidth = (c: EntryColumn<T>) => (typeof c.width === 'number' ? c.width : (c.minWidth ?? 100));
  const minOf = (c: EntryColumn<T>) => Math.min(c.minWidth ?? MIN_COL, defWidth(c));
  const widthOf = (c: EntryColumn<T>) => {
    const saved = widths[c.key];
    return Math.max(minOf(c), Math.round(typeof saved === 'number' && saved > 0 ? saved : defWidth(c)));
  };
  const commitWidths = (fn: (prev: Record<string, number>) => Record<string, number>) => {
    setWidths((prev) => {
      const next = fn(prev);
      saveWidths(widthsKey, next);
      return next;
    });
  };
  const resetWidths = () => commitWidths(() => ({}));
  const resetWidth = (key: string) => commitWidths((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });

  // نفس ترتيب جداول antd بالحرف — `orderKeys` هي اللي بتعرف القاعدة: اللي اتحفظ الأول،
  // وأي عمود جديد اتضاف بعد كده بيتحط في آخر القايمة بدل ما يختفي.
  const ordered = React.useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    return orderKeys(allKeys, prefs.order).map((k) => byKey.get(k)!).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, prefs.order]);

  // كل عمود بيتخفي — حتى «المقفول» (طلب العميل ٢٠٢٦-١٠-٠١). شوف `ColumnSettings`.
  const shown = ordered.filter((c) => !prefs.hidden.includes(c.key));

  const control = (
    <ColumnSettings
      choices={columns.map((c) => ({
        key: c.key,
        title: c.label ?? (typeof c.title === 'string' && c.title ? c.title : c.key),
        locked: !!c.locked,
      }))}
      hidden={prefs.hidden}
      onChange={prefs.setHidden}
      order={prefs.order}
      onMove={(k, d) => prefs.move(k, d, allKeys)}
      onResetWidths={resetWidths}
    />
  );

  const total = shown.reduce((n, c) => n + widthOf(c), 0);
  // عمود الإجراء بيلزق في آخر السطر لو فيه تمرير — بس لو هو فعلاً آخر عمود.
  const stickyKey = shown.length && shown[shown.length - 1].key === 'actions' ? 'actions' : null;
  const stickyCls = (key: string) => (key === stickyKey ? 'eg-sticky-end' : undefined);

  /**
   * السحب: بنحرّك الـDOM مباشرةً وإحنا بنسحب (من غير ريندر لكل السطور)، ونحفظ مرة لما الماوس يتساب.
   * في RTL حد العمود اللي بيتسحب هو الشمال، فالسحب لشمال بيوسّع.
   */
  const startResize = (c: EntryColumn<T>) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest('th') as HTMLElement | null;
    const table = th?.closest('table') as HTMLTableElement | null;
    const wrap = table?.parentElement;
    if (!th || !table || !wrap) return;
    const col = table.querySelector<HTMLElement>(`col[data-eg-col="${c.key}"]`);
    const rtl = getComputedStyle(th).direction === 'rtl';
    const startX = e.clientX;
    const startRendered = th.getBoundingClientRect().width;
    const others = total - widthOf(c);
    const room = wrap.clientWidth;
    const min = minOf(c);
    let next = widthOf(c);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      // العرض اللي المفروض يبان. لو الجدول متمدّد لعرض الشاشة، المتصفح بيوزّع الفاضي
      // بالنسبة — فبنحسب العرض المحفوظ اللي يطلّع العرض ده بعد التوزيع.
      const r = Math.max(min, startRendered + (rtl ? -dx : dx));
      const base = r + others >= room ? r : (r * others) / (room - r);
      next = Math.max(min, Math.round(base));
      if (col) col.style.width = `${next}px`;
      th.style.width = `${next}px`;
      table.style.minWidth = `${others + next}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('eg-resizing');
      if (moved) commitWidths((prev) => ({ ...prev, [c.key]: next }));
    };
    document.body.classList.add('eg-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** `<colgroup>` — بيتحط قبل `<thead>`. */
  const cols = (
    <colgroup>
      {shown.map((c) => <col key={c.key} data-eg-col={c.key} style={{ width: widthOf(c) }} />)}
    </colgroup>
  );

  const tableProps = {
    className: 'entry-grid sale-grid eg-sized',
    style: { tableLayout: 'fixed', width: '100%', minWidth: total } as React.CSSProperties,
  };

  const head = (
    <tr>
      {shown.map((c) => (
        <th key={c.key} className={stickyCls(c.key)} style={{ width: widthOf(c) }}
          title={c.tip ?? (typeof c.title === 'string' && c.title ? c.title : undefined)}>
          {c.title}
          <span className="eg-resize" onPointerDown={startResize(c)}
            onDoubleClick={(e) => { e.stopPropagation(); resetWidth(c.key); }}
            title="اسحب لتغيير العرض — دبل كليك يرجّعه" />
        </th>
      ))}
    </tr>
  );

  /**
   * صف الإجماليات — بيتبني من الأعمدة المعروضة.
   *
   * الأعمدة اللي قبل أول عمود له إجمالي بتتلم في خلية واحدة مكتوب فيها «الإجمالي»، وباقي
   * الأعمدة كل واحد بخليته أو فاضي. يعني إخفاء عمود أو تحريكه بيحرّك إجماليه معاه.
   */
  const foot = (rows: T[], label: React.ReactNode = 'الإجمالي') => {
    const first = shown.findIndex((c) => c.footer);
    if (first < 0) return null;
    return (
      <tr>
        {first > 0 && (
          <td colSpan={first} style={{ fontWeight: 700 }}>{label}</td>
        )}
        {shown.slice(first).map((c) => (
          <td key={c.key} className={stickyCls(c.key)} style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            {c.footer ? c.footer(rows) : null}
          </td>
        ))}
      </tr>
    );
  };

  const row = (item: T, index: number) => shown.map((c) => (
    <td key={c.key} className={stickyCls(c.key)} style={c.cellStyle} {...(c.cellProps?.(item, index) ?? {})}>
      {c.cell(item, index)}
    </td>
  ));

  /** رأس شبكة `Row`/`Col` — نفس الأعمدة المعروضة بترتيبها. */
  const colHead = shown.map((c) => ({
    key: c.key, span: c.span ?? 2, xs: c.xs, align: c.align, title: c.title,
  }));

  /** خلايا سطر في شبكة `Row`/`Col`. */
  const colRow = (item: T, index: number) => shown.map((c) => ({
    key: c.key, span: c.span ?? 2, xs: c.xs, align: c.align,
    node: c.cell(item, index),
  }));

  return {
    control, head, row, foot, colHead, colRow, shown, count: shown.length,
    cols, tableProps, resetWidths,
  };
}
