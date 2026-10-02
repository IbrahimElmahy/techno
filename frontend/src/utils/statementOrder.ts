/**
 * ترتيب كشف الحساب.
 *
 * الكشف جاي من السيرفر **الأحدث فوق**، بس الفاتورة وسطر «مدفوع نقداً مع الفاتورة» بتوعها
 * كتلة واحدة بترتيبها: الفاتورة فوق والدفعة تحتها (`statement_service._newest_first`).
 * فالقلب البسيط لصفوف الشاشة مابقاش هو الترتيب الزمني — الكتلة لازم ترجع لترتيبها.
 */

interface StatementRow {
  entry_id: number;
  account_id?: number | null;
  cash_on_invoice?: boolean;
  debit?: string | number | null;
  credit?: string | number | null;
}

/** الصفوف بالترتيب الزمني (الأقدم الأول) — الفاتورة قبل نقديها. */
export function chronological<T extends StatementRow>(rows: T[]): T[] {
  const out = [...rows].reverse();
  for (let i = 0; i + 1 < out.length; i += 1) {
    const a = out[i];
    const b = out[i + 1];
    if (a.cash_on_invoice && !b.cash_on_invoice && a.entry_id === b.entry_id
      && (a.account_id ?? null) === (b.account_id ?? null)) {
      out[i] = b;
      out[i + 1] = a;
      i += 1;
    }
  }
  return out;
}

/** «تراكمي المعروض» لكل صف: مجموع (مدين − دائن) لحد الصف ده بالترتيب الزمني. */
export function runningTotals<T extends StatementRow>(
  rows: T[], keyOf: (r: T) => string,
): Map<string, number> {
  const m = new Map<string, number>();
  let acc = 0;
  for (const r of chronological(rows)) {
    acc += Number(r.debit || 0) - Number(r.credit || 0);
    m.set(keyOf(r), acc);
  }
  return m;
}
