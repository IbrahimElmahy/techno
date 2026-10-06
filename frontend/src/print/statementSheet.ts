/**
 * ورقة كشف الحساب — بشكل كشف a5.
 *
 * الكشف كان بيتطبع من `printReport` بالأعمدة الظاهرة على الشاشة: رقم، تاريخ، نوع،
 * نوع الفاتورة، بيان، مندوب، مخزن، الرصيد قبل، مدين، دائن، الرصيد بعد، المستند — اتناشر
 * عمود في عرض ورقة A4. البيان اتحشر في عمود ضيق وبقى ٤–٥ سطور لكل حركة، فالصفحة طلعت
 * جدول طويل محدش بيعرف يقراه، والعميل قارنها بورقة a5 اللي بيستعملها من سنين ورفضها.
 *
 * ورقة a5 فيها سبع أعمدة بس، والبيان آخرها وواخد الباقي من العرض:
 *   م · التاريخ · مدين · دائن · رصيد مدين · رصيد دائن · البيان
 * والرصيد مقسوم على عمودين بدل رقم بإشارة — الرصيد الدائن بيتكتب موجب في «رصيد دائن».
 * علامة السالب أول حاجة بتضيع في التصوير، و«−٤٠٠» لما تتقري «٤٠٠» بتقلب الكشف كله.
 *
 * **الورقة ثابتة، مش بتورث أعمدة الشاشة.** اختيار الأعمدة على الشاشة للشغل (مين المندوب،
 * أنهي مخزن) — الورقة بتروح للعميل، وعمود زيادة فيها بياخد من عرض البيان.
 */
import { printDocument } from './brand';
import { esc, latinDigits, printMoney, printQty } from './reportSheet';
import { chronological } from '../utils/statementOrder';

export interface StatementSheetLine {
  entry_id: number;
  entry_date: string;
  description?: string | null;
  /** «البيان» المكتوب على المستند نفسه — بيتطبع بعد وصف القيد لو مختلف عنه. */
  doc_statement?: string | null;
  debit: string | number | null;
  credit: string | number | null;
  balance_before?: string | number | null;
  balance: string | number | null;
  account_id?: number | null;
  account_name?: string | null;
  cash_on_invoice?: boolean;
}

export interface StatementSheet {
  /** «كشف حساب» / «كشف حساب عميل» / «كشف صنف». */
  title: string;
  account: string;
  /** الحساب الرئيسي اللي الحساب ده تحته — زي سطر a5 «حساب رئيسي · اسم الحساب». */
  mainAccount?: string | null;
  /** طرفين الفترة متنسّقين (YYYY/MM/DD) — فاضيين = من أول الحركة. */
  from?: string | null;
  to?: string | null;
  opening: string | number | null | undefined;
  closing: string | number | null | undefined;
  /** السطور زي ما هي على الشاشة — الورقة بترتّبها هي من الأقدم للأحدث. */
  lines: StatementSheetLine[];
  /** ناحية الحساب الطبيعية. لو مش معروفة بتتستنتج من السطور (شوف `sideOf`). */
  normalSide?: 'debit' | 'credit';
  /** فيه فلتر على الشاشة — الإجماليات بتبقى «المعروض» مش الحساب كله. */
  filtered?: boolean;
  /** الفلاتر اللي اتطبعت بيها الورقة — بتتكتب سطر صغير فوق الجدول. */
  filters?: [string, string][];
  /** سطور زيادة تحت الإجماليات (المستحق، المتأخر، الأعمار). */
  extra?: [string, string][];
  /** كشف صنف: داخل/خارج والرصيد كمية — عمود رصيد واحد، مفيش مدين ودائن. */
  quantity?: boolean;
  /** الكشف فيه أكتر من حساب — اسم الحساب بيتكتب أول البيان. */
  showAccount?: boolean;
}

const n = (v: unknown) => Number(v || 0);

/**
 * ناحية الحساب: السيرفر بيوقّع الرصيد على ناحية الحساب الطبيعية (عميل مدين، مورد دائن)
 * ومابيبعتهاش في الكشف. فبنقراها من أول سطر اتحرك: لو الرصيد زاد بـ(مدين − دائن) يبقى
 * الحساب مديني، ولو زاد بالعكس يبقى دائني. من غيرها الرصيد الدائن كان هيتكتب «مدين».
 */
function sideOf(s: StatementSheet): 'debit' | 'credit' {
  for (const l of s.lines) {
    const move = n(l.debit) - n(l.credit);
    if (!move || l.balance_before === undefined || l.balance_before === null) continue;
    const delta = n(l.balance) - n(l.balance_before);
    if (Math.abs(delta - move) < 0.005) return 'debit';
    if (Math.abs(delta + move) < 0.005) return 'credit';
  }
  return s.normalSide ?? 'debit';
}

/** الأقدم الأول. السيرفر بيبعت الأحدث فوق؛ لو جاي متصاعد أصلاً بيفضل زي ما هو. */
function oldestFirst(rows: StatementSheetLine[]): StatementSheetLine[] {
  if (rows.length < 2) return [...rows];
  const first = String(rows[0].entry_date || '').slice(0, 10);
  const last = String(rows[rows.length - 1].entry_date || '').slice(0, 10);
  return first < last ? [...rows] : chronological(rows);
}

/** البيان سطر واحد: (الحساب) وصف القيد — بيان المستند. من غير أكواد زيادة. */
function bianOf(l: StatementSheetLine, withAccount: boolean): string {
  const desc = String(l.description ?? '').replace(/\s+/g, ' ').trim();
  const doc = String(l.doc_statement ?? '').replace(/\s+/g, ' ').trim();
  const parts = [desc];
  if (doc && doc !== desc && !l.cash_on_invoice) parts.push(doc);
  const text = parts.filter(Boolean).join(' — ');
  return withAccount && l.account_name ? `${l.account_name}: ${text}` : text;
}

/** HTML الورقة من غير ما تتطبع — عشان تتراجع في ملف لوحدها. */
export function statementSheetHtml(s: StatementSheet): string {
  const isQty = !!s.quantity;
  // أرقام إنجليزي في الورقة كلها — الشرح عند `latinDigits`.
  const fmt = (v: number) => (isQty ? printQty(v) : printMoney(v));
  // مدين/دائن الصفر خانة فاضية زي a5 — «٠٫٠٠» في كل سطر بيغرّق الرقم الحقيقي.
  const blankZero = (v: number) => (Math.abs(v) < 0.005 ? '' : fmt(v));
  const sign = sideOf(s) === 'credit' ? -1 : 1;
  /** الرصيد على ناحية المدين: موجب = مدين، سالب = دائن. */
  const asDebit = (v: unknown) => sign * n(v);
  const split = (v: unknown): [string, string] => {
    const d = asDebit(v);
    if (Math.abs(d) < 0.005) return [fmt(0), ''];
    return d > 0 ? [fmt(d), ''] : ['', fmt(-d)];
  };
  /** «١٬٢٣٤٫٠٠ مدين» — الكلمة بدل الإشارة. */
  const worded = (v: unknown) => {
    if (isQty) return fmt(n(v));
    const d = asDebit(v);
    if (Math.abs(d) < 0.005) return fmt(0);
    return `${fmt(Math.abs(d))} ${d > 0 ? 'مدين' : 'دائن'}`;
  };

  const rows = oldestFirst(s.lines);
  const totalDebit = rows.reduce((t, l) => t + n(l.debit), 0);
  const totalCredit = rows.reduce((t, l) => t + n(l.credit), 0);
  const L = isQty
    ? { debit: 'داخل', credit: 'خارج' }
    : { debit: 'مدين', credit: 'دائن' };
  const balanceHeads = isQty
    ? '<th class="n">الرصيد</th>'
    : '<th class="n">رصيد مدين</th><th class="n">رصيد دائن</th>';
  const balanceCells = (v: unknown) => {
    if (isQty) return `<td class="n">${fmt(n(v))}</td>`;
    const [d, c] = split(v);
    return `<td class="n">${d}</td><td class="n">${c}</td>`;
  };
  const cols = isQty ? 6 : 7;

  // سطر رصيد أول المدة — الرصيد الجاري بيبدأ منه، فمن غيره أول سطر في الجدول رقم مالوش أصل.
  const showOpening = !!s.from || Math.abs(n(s.opening)) >= 0.005;
  const openingRow = showOpening
    ? `<tr class="open"><td class="n"></td><td class="d">${esc(s.from ?? '')}</td>`
      + '<td class="n"></td><td class="n"></td>'
      + `${balanceCells(s.opening)}<td class="b">رصيد أول المدة</td></tr>`
    : '';

  const body = rows.map((l, i) => `<tr>`
    + `<td class="n s">${i + 1}</td>`
    + `<td class="d">${esc(String(l.entry_date || '').slice(0, 10))}</td>`
    + `<td class="n">${blankZero(n(l.debit))}</td>`
    + `<td class="n">${blankZero(n(l.credit))}</td>`
    + balanceCells(l.balance)
    + `<td class="b">${esc(bianOf(l, !!s.showAccount))}</td>`
    + '</tr>').join('');

  const empty = rows.length
    ? '' : `<tr><td colspan="${cols}" class="b">مفيش حركة في الفترة دي</td></tr>`;

  // سطر الإجمالي آخر الجدول (مش tfoot — ده بيتكرر تحت كل صفحة، وإجمالي في نص الكشف غلط).
  const suffix = s.filtered ? ' (المعروض)' : '';
  const totalRow = `<tr class="total"><td colspan="2" class="b">الإجمالي${suffix}</td>`
    + `<td class="n">${fmt(totalDebit)}</td><td class="n">${fmt(totalCredit)}</td>`
    + `${balanceCells(s.closing)}<td class="b">الرصيد الختامي: ${esc(worded(s.closing))}</td></tr>`;

  const head = `<div class="st-head">`
    + (s.mainAccount ? `<span><span class="k">حساب رئيسي</span>${esc(s.mainAccount)}</span>` : '')
    + `<span class="acc"><span class="k">${isQty ? 'الصنف' : 'الحساب'}</span>${esc(s.account)}</span>`
    + `<span><span class="k">الفترة</span>${s.from || s.to
      ? `من ${esc(s.from ?? '—')} إلى ${esc(s.to ?? '—')}` : 'كل الحركات'}</span>`
    + `<span><span class="k">رصيد أول المدة</span>${esc(worded(s.opening))}</span>`
    + '</div>'
    + (s.filters?.length
      ? `<div class="st-filters">${s.filters
        .map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join(' · ')}</div>`
      : '');

  const sum = `<div class="st-sum">`
    + `<div><span>رصيد أول المدة</span><b>${esc(worded(s.opening))}</b></div>`
    + `<div><span>إجمالي ${L.debit}${suffix}</span><b>${fmt(totalDebit)}</b></div>`
    + `<div><span>إجمالي ${L.credit}${suffix}</span><b>${fmt(totalCredit)}</b></div>`
    + `<div class="close"><span>الرصيد الختامي</span><b>${esc(worded(s.closing))}</b></div>`
    + '</div>'
    + (s.extra?.length
      ? `<div class="st-extra">${s.extra
        .map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join(' · ')}</div>`
      : '');

  return `<style>${STATEMENT_CSS}</style>${head}`
    + `<table class="grid stmt"><thead><tr><th class="n">م</th><th>التاريخ</th>`
    + `<th class="n">${L.debit}</th><th class="n">${L.credit}</th>${balanceHeads}`
    + `<th class="b">البيان</th></tr></thead>`
    + `<tbody>${openingRow}${body}${empty}${totalRow}</tbody></table>${sum}`;
}

export function printStatement(s: StatementSheet): void {
  const period = s.from || s.to ? ` ${s.from ?? ''} - ${s.to ?? ''}` : '';
  printDocument({
    title: s.title,
    fileName: `${s.title} - ${s.account}${period}`.replace(/\//g, '-'),
  }, latinDigits(statementSheetHtml(s)));
}

/**
 * الأعمدة الصغيرة (م، التاريخ، الأرقام) `nowrap` وعرضها على قد الرقم (`width:1%`)، والبيان
 * من غير عرض فبياخد كل الباقي — جدول تلقائي بيقسّم كده لوحده من غير نسب ثابتة تتكسر
 * مع رقم بالملايين. الأرقام على آخرها (يمين الخانة) بأرقام متساوية العرض، فالعلامة
 * العشرية تحت بعضها في العمود كله.
 */
const STATEMENT_CSS = `
  .st-head {
    display: flex; flex-wrap: wrap; gap: 2px 18px; align-items: baseline;
    margin: 2px 0 6px; font-size: 12.5px;
  }
  .st-head .k { color: #2b2b2b; font-weight: 700; margin-inline-end: 5px; }
  .st-head .acc { font-size: 14.5px; font-weight: 800; }
  .st-filters, .st-extra { font-size: 12px; color: #1a1a1a; margin: 0 0 5px; }
  body.compact table.grid.stmt th { padding: 4px 6px; font-size: 12.5px; white-space: nowrap; }
  body.compact table.grid.stmt td {
    padding: 3px 6px; font-size: 12.5px; line-height: 1.35; vertical-align: top;
  }
  table.grid.stmt td.n, table.grid.stmt th.n, table.grid.stmt td.d {
    white-space: nowrap; width: 1%;
  }
  table.grid.stmt td.n {
    text-align: right; direction: ltr; font-variant-numeric: tabular-nums;
  }
  table.grid.stmt td.s { text-align: center; color: #1a1a1a; }
  table.grid.stmt td.d { text-align: center; direction: ltr; }
  table.grid.stmt td.b, table.grid.stmt th.b {
    text-align: right; white-space: normal; overflow-wrap: anywhere;
  }
  table.grid.stmt tr.open td {
    font-weight: 800; background: #e6e6e6; border-bottom: 1.5px solid #000;
  }
  table.grid.stmt tr.total td {
    font-weight: 800; border-top: 2px solid #000; background: #e6e6e6;
  }
  .st-sum {
    display: flex; gap: 0; margin-top: 8px; border: 1px solid #444; border-radius: 4px;
  }
  .st-sum div {
    flex: 1; padding: 4px 8px; font-size: 12.5px; border-inline-start: 1px solid #444;
    display: flex; flex-direction: column; gap: 1px;
  }
  .st-sum div:first-child { border-inline-start: none; }
  .st-sum span { color: #2b2b2b; }
  .st-sum b { font-size: 13px; white-space: nowrap; }
  .st-sum .close b { font-size: 14px; }
  .st-extra { margin-top: 5px; }
  @media print {
    table.grid.stmt tr.open td, table.grid.stmt tr.total td, .st-sum {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  }
`;
