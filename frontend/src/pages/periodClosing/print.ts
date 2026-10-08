import { printDocument } from '../../print/brand';
import { esc, printMoney, printQty } from '../../print/reportSheet';

const SRC: Record<string, string> = { system: 'النظام', manual: 'يدوي', mixed: 'النظام + يدوي', computed: 'محسوب' };

function table(head: string[], rows: (string | number | null | undefined)[][], numericFrom = 1): string {
  const th = head.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => {
    const n = i >= numericFrom && c !== '' && c !== null && c !== undefined && !Number.isNaN(Number(c));
    return `<td${n ? ' style="text-align:left;direction:ltr"' : ''}>${esc(n ? printMoney(c) : c ?? '')}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="grid"><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="${head.length}">—</td></tr>`}</tbody></table>`;
}

const h = (t: string) => `<h3 style="margin:10px 0 6px">${esc(t)}</h3>`;
const total = (label: string, v: unknown) =>
  `<table class="totals"><tr><td>${esc(label)}</td><td>${esc(printMoney(v))}</td></tr></table>`;

function manual(rows: any[] = []) {
  return rows.map((l) => [l.label, l.quantity ? printQty(l.quantity) : '', l.rate ?? '', l.signed, 'يدوي']);
}

export function inventoryHtml(pkg: any, withItems = false): string {
  const inv = pkg.inventory;
  if (!inv) return '';
  let out = h(`قيمة المخازن في ${pkg.as_of}`) + table(
    ['خط الإنتاج', 'المخزن الرئيسي', 'السيارات والمخازن', 'القيمة', 'المصدر'],
    [...inv.lines.map((l: any) => [`${l.name} (${l.basis === 'list' ? 'أصل السعر' : 'التكلفة'} × ${Number(l.factor_pct)}٪)`, l.net_main, l.net_other, l.value, SRC[l.source]]),
      ...(inv.extras || []).map((l: any) => [l.label, '', '', l.signed, 'يدوي'])],
  ) + total('قيمة المخازن', inv.total);
  if (withItems) {
    for (const l of inv.lines) {
      if (!l.items?.length) continue;
      out += `<div style="page-break-before:always"></div>${h(`${l.name} — ${pkg.as_of}`)}${table(
        ['الصنف', 'الرئيسي', 'السيارات', 'سعر الوحدة', 'قيمة الرئيسي', 'قيمة السيارات', 'القيمة'],
        l.items.map((i: any) => [i.name, printQty(i.qty_main), printQty(i.qty_other), i.unit_price, i.value_main, i.value_other, i.value]),
        3,
      )}${total(`الصافي (${Number(l.factor_pct)}٪)`, l.net_system)}`;
    }
  }
  return out;
}

export function balancesHtml(pkg: any): string {
  const b = pkg.balances;
  if (!b) return '';
  const sys = (rows: any[]) => rows.map((r) => [r.name || r.label, '', '', r.amount, 'النظام']);
  const head = ['البند', 'الكمية', 'السعر', 'المبلغ', 'المصدر'];
  let out = h(`عملاء ونقدية وموردين — ${pkg.as_of}`);
  out += h('مديونية العملاء') + table(head, [...sys(b.customers.rows), ...manual(b.customers.adjustments)], 3)
    + total('صافي مديونية العملاء', b.customers.total);
  for (const [key, title] of [['suppliers', 'مستحقات الموردين'], ['accrued', 'مصروفات مستحقة'],
    ['partners', 'جاري الشركاء'], ['cash', 'النقدية']] as const) {
    out += h(title) + table(head, [...sys(b[key].rows), ...manual(b[key].manual)], 3) + total('الإجمالي', b[key].total);
  }
  out += h('مستحقات الفنيين') + table(head, manual(b.technicians.rows), 3) + total('الإجمالي', b.technicians.total);
  out += h('رصيد الهدايا') + table(head, manual(b.gifts.rows), 3) + total('الصافي', b.gifts.total);
  const bo = b.bonuses;
  out += h('بوانص التجار') + table(['السيارة', ...bo.years, 'الإجمالي'],
    [...bo.rows.map((r: any) => [r.label, ...bo.years.map((y: string) => r.years[y] ?? ''), r.total]),
      ['الإجمالي', ...bo.years.map((y: string) => bo.by_year[y]), bo.total]]);
  out += table(['تكلفة البوانص', 'القيمة'], bo.calc.map((c: any) => [c.label, c.value])) + total('قيمة بوانص التجار', bo.net);
  return out;
}

export function balanceSheetHtml(pkg: any): string {
  const bs = pkg.balance_sheet;
  if (!bs) return '';
  const rows = (xs: any[]) => xs.map((x) => [x.label, x.amount, '', SRC[x.source] || '']);
  return h(`الميزانية العمومية في ${pkg.as_of} — ${pkg.branch_name || ''}`)
    + table(['الأصول', 'فرعي', 'رئيسي', 'المصدر'], [
      ['الأصول المتداولة', '', bs.assets.current_total, ''], ...rows(bs.assets.current),
      ['الأصول الثابتة', '', bs.assets.fixed_total, ''], ...rows(bs.assets.fixed),
      ['أرصدة مدينة أخرى', '', bs.assets.other_total, ''], ...rows(bs.assets.other),
    ]) + total('إجمالي الأصول', bs.assets.total)
    + table(['الخصوم وحقوق الملكية', 'فرعي', 'رئيسي', 'المصدر'], [
      ['حقوق الملكية', '', bs.equity.total, ''], ...rows(bs.equity.rows),
      ['الالتزامات', '', bs.liabilities.total, ''], ...rows(bs.liabilities.rows),
    ]) + total('الإجمالي', bs.total);
}

export function settlementHtml(pkg: any): string {
  const st = pkg.settlement;
  if (!st?.areas?.length) return '';
  return st.areas.map((a: any) => h(`تسوية ${a.name} — ${pkg.as_of}`) + table(['البند', 'المبلغ', 'المصدر'], [
    ['المديونية', a.debt, 'النظام'], ...a.deductions.map((d: any) => [d.label, d.signed, 'يدوي']),
  ]) + total('الصافي المستحق على المنطقة', a.net)).join('');
}

export function advancesHtml(pkg: any): string {
  const adv = pkg.advances;
  if (!adv) return '';
  return h('سلف الموظفين') + table(['الموظف / الحساب', ...adv.dates], [
    ...adv.rows.map((r: any) => [r.label, ...adv.dates.map((d: string) => r.values[d] ?? '')]),
    ['الإجمالي', ...adv.dates.map((d: string) => adv.totals[d])],
  ]);
}

const BUILDERS: Record<string, (p: any) => string> = {
  inventory: (p) => inventoryHtml(p, true), balances: balancesHtml, balance_sheet: balanceSheetHtml,
  settlement: settlementHtml, advances: advancesHtml,
};

export function printClosing(pkg: any, blocks: string[], title: string) {
  const parts = blocks.map((b) => BUILDERS[b]?.(pkg)).filter(Boolean);
  const body = parts.map((p, i) => `<section${i < parts.length - 1 ? ' style="page-break-after:always"' : ''}>${p}</section>`).join('');
  const status = pkg.closing ? (pkg.closing.status === 'final' ? 'معتمد' : 'مسودة') : 'غير محفوظ';
  printDocument({
    title, date: pkg.as_of, fileName: `${title} ${pkg.branch_name || ''} ${pkg.as_of}`,
    meta: [['الفرع', pkg.branch_name || ''], ['تاريخ الإقفال', pkg.as_of], ['الحالة', status]],
  }, body);
}
