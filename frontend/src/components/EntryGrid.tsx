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
  width?: number | string;
  minWidth?: number;
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

export function useEntryGrid<T>(storageKey: string, columns: EntryColumn<T>[]) {
  const prefs = useHiddenColumns(storageKey);
  const allKeys = columns.map((c) => c.key);

  // نفس ترتيب جداول antd بالحرف — `orderKeys` هي اللي بتعرف القاعدة: اللي اتحفظ الأول،
  // وأي عمود جديد اتضاف بعد كده بيتحط في آخر القايمة بدل ما يختفي.
  const ordered = React.useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    return orderKeys(allKeys, prefs.order).map((k) => byKey.get(k)!).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, prefs.order]);

  const shown = ordered.filter((c) => c.locked || !prefs.hidden.includes(c.key));

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
    />
  );

  const head = (
    <tr>
      {shown.map((c) => (
        <th key={c.key} style={{ width: c.width, minWidth: c.minWidth }}>{c.title}</th>
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
          <td key={c.key} style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            {c.footer ? c.footer(rows) : null}
          </td>
        ))}
      </tr>
    );
  };

  const row = (item: T, index: number) => shown.map((c) => (
    <td key={c.key} style={c.cellStyle} {...(c.cellProps?.(item, index) ?? {})}>
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

  return { control, head, row, foot, colHead, colRow, shown, count: shown.length };
}
