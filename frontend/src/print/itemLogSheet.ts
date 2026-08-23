import { api } from '../api/client';
import { type DocMeta, printDocument } from './brand';
import { reportTableHtml, type PrintColumn } from './reportSheet';
import { type CsvColumn, exportCsv } from '../utils/exportCsv';

/**
 * الصنف **وسجله** — طباعة وتصدير.
 *
 * ورقة الجرد بتقول «الصنف ده رصيده كذا». والسؤال اللي بيتسأل بعدها على طول هو «طب ليه
 * كذا؟»، وإجابته في الحركات. فالورقة اللي بتطلع من غير السجل بتخلّي اللي بيراجع يرجع
 * للشاشة لكل صنف — وهو غالباً قاعد بيراجع ورق مطبوع بعيد عن الشاشة أصلاً.
 *
 * عشان كده الطباعة والتصدير بيجيبوا الحركات مع كل صنف: قسم لكل صنف فيه رصيده وتحته
 * حركاته في الفترة.
 *
 * **والحد الأقصى مقصود.** كل صنف = نداء على السيرفر؛ ورقة بأربعميت صنف معناها أربعميت
 * نداء وانتظار دقايق على حاجة اتطلبت بضغطة. فاللي عايز السجل بيحدّد الأصناف اللي
 * بيراجعها، واللي بيطبع الورقة كلها بياخدها من غير سجل — والفرق بيتقال، مابيحصلش في
 * السكوت.
 */

export const LOG_LIMIT = 60;

export interface ItemLogTarget {
  itemId: number;
  itemName: string;
  locationKind?: string | null;
  locationId?: number | null;
}

export interface LogRow {
  date?: string | null;
  movement_type?: string | null;
  document_number?: string | null;
  party?: string | null;
  location?: string | null;
  quantity_in?: string | number | null;
  quantity_out?: string | number | null;
  balance_before?: string | number | null;
  balance_after?: string | number | null;
}

/** بيجيب حركات صنف واحد في الفترة. بيرجّع فاضي لو النداء وقع — صنف من غير حركات أحسن
 *  من ورقة مابتطلعش. */
export async function fetchLog(
  t: ItemLogTarget,
  from?: string | null,
  to?: string | null,
): Promise<LogRow[]> {
  const params: any = {};
  if (t.locationKind) params.location_kind = t.locationKind;
  if (t.locationId) params.location_id = t.locationId;
  if (from) params.date_from = from;
  if (to) params.date_to = to;
  try {
    const r = await api.get(`/api/v1/items/${t.itemId}/card`, { params });
    return r.data?.rows || [];
  } catch {
    return [];
  }
}

const LOG_COLUMNS: PrintColumn<LogRow>[] = [
  { title: 'التاريخ', value: (r) => (r.date ? String(r.date).slice(0, 10) : '-') },
  { title: 'الحركة', value: (r) => r.movement_type ?? '-' },
  { title: 'المستند', value: (r) => r.document_number ?? '-' },
  { title: 'جهة التعامل', value: (r) => r.party ?? '-' },
  { title: 'داخل', value: (r) => r.quantity_in ?? '', numeric: true },
  { title: 'خارج', value: (r) => r.quantity_out ?? '', numeric: true },
  { title: 'الرصيد بعدها', value: (r) => r.balance_after ?? '', numeric: true },
];

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * بيطبع كل صنف في قسم لوحده: سطره من الورقة، وتحته حركاته.
 *
 * `labels` بتوصف سطر الصنف نفسه بأعمدة الورقة اللي طالع منها، عشان المطبوع يقول نفس
 * اللي الشاشة بتقوله — مش نسخة تانية من نفس الأرقام بأسماء تانية.
 */
export function printItemsWithLogs<T>(
  meta: DocMeta,
  itemColumns: PrintColumn<T>[],
  entries: { row: T; name: string; log: LogRow[] }[],
): void {
  const sections = entries.map(({ row, name, log }) => {
    const head = reportTableHtml(itemColumns, [row]);
    const body = log.length
      ? reportTableHtml(LOG_COLUMNS, log)
      : '<p style="color:#666;margin:4px 0 12px">مفيش حركات في الفترة دي.</p>';
    return `<h3 style="margin:16px 0 6px;font-size:14px">${esc(name)}</h3>${head}${body}`;
  }).join('');

  printDocument(
    { ...meta, meta: [...(meta.meta ?? []), ['عدد الأصناف', String(entries.length)]] },
    sections,
  );
}

/**
 * بيصدّر الصنف وسجله في ملف واحد.
 *
 * عمود «النوع» أول عمود عن قصد: الملف فيه نوعين صفوف، واللي بيفتحه في إكسل لازم يفرّق
 * بينهم من غير ما يعدّ الأعمدة. وبعدين هو اللي بيخلّي الفرز والتصفية شغّالين.
 */
export function exportItemsWithLogs<T>(
  filename: string,
  itemColumns: CsvColumn<T>[],
  entries: { row: T; name: string; log: LogRow[] }[],
): void {
  const flat: any[] = [];
  for (const { row, name, log } of entries) {
    flat.push({ __kind: 'صنف', __name: name, __row: row });
    for (const m of log) flat.push({ __kind: 'حركة', __name: name, __log: m });
  }
  const columns: CsvColumn<any>[] = [
    { title: 'النوع', value: (r) => r.__kind },
    { title: 'الصنف', value: (r) => r.__name },
    ...itemColumns.map((c) => ({
      title: c.title,
      value: (r: any) => (r.__row
        ? (typeof c.value === 'function' ? (c.value as any)(r.__row) : r.__row[c.value as string])
        : ''),
    })),
    { title: 'تاريخ الحركة', value: (r) => (r.__log?.date ? String(r.__log.date).slice(0, 10) : '') },
    { title: 'نوع الحركة', value: (r) => r.__log?.movement_type ?? '' },
    { title: 'مستند الحركة', value: (r) => r.__log?.document_number ?? '' },
    { title: 'جهة التعامل', value: (r) => r.__log?.party ?? '' },
    { title: 'داخل', value: (r) => r.__log?.quantity_in ?? '' },
    { title: 'خارج', value: (r) => r.__log?.quantity_out ?? '' },
    { title: 'الرصيد بعدها', value: (r) => r.__log?.balance_after ?? '' },
  ];
  exportCsv(filename, columns, flat);
}
