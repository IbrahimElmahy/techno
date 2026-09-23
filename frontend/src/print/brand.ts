import { BRAND, LOGO_DATA_URI, logoSvg } from '../components/Logo';


/**
 * One branded letterhead for every printed document (invoices, vouchers, certificates,
 * financial statements). Keeping the shell here means a change to the company's look —
 * colours, header, footer, paper size — happens once instead of in six page files.
 */

export interface DocMeta {
  /** e.g. «فاتورة مبيعات» — the big title under the letterhead. */
  title: string;
  /** e.g. «SINV-000123» — printed as the document number chip. */
  number?: string;
  date?: string;
  /** Extra header cells: [label, value] pairs (customer, rep, payment terms…). */
  meta?: [string, string][];
  /** Small note under the footer rule, e.g. terms. */
  note?: string;
  /** Parts of the head to leave OFF this print. Omitted = print everything.
   *
   *  A company printing onto pre-printed letterhead already has its logo and name on the paper;
   *  printing them again puts two of each on the page. The person at the counter is the only one
   *  who knows what is in the printer, so it is their switch to throw. */
  /**
   * **ورقة مضغوطة** — ترويسة سطر واحد، وبيانات في شبكة، وجدول أكثف.
   *
   * الترويسة العادية بتاخد تلت الصفحة: شعار كبير، وعنوان في سطر لوحده، وجدول
   * بيانات بصف لكل حقة (عميل، تليفون، عنوان، فرع، مندوب، تاريخ، سداد — سبع صفوف).
   * والذيل بياخد حتة تانية. فطلب بيع بعشرين صنف كان بيطلع في صفحتين، والصفحة
   * التانية فيها سطرين وإجماليات.
   *
   * المضغوط بيدّي نفس المعلومة بالظبط — مافيش حقل اتشال — في ربع المساحة، والباقي
   * للأصناف. والفواتير بس اللي بتستعمله: التقارير والسندات فاضل ترتيبها زي ما هو.
   */
  compact?: boolean;
  hide?: {
    logo?: boolean;
    companyName?: boolean;
    invoiceNumber?: boolean;
    invoiceTitle?: boolean;
    /** بيانات الشركة في الذيل — العنوان والتليفونات.
     *
     *  كانت بتتطبع دايماً من غير مفتاح، فالورقة اللي شعارها متشال كان اسم الشركة
     *  وعنوانها لسه في رجلها. إخفاء النص وسيبان المصدر مش إخفاء. */
    companyFooter?: boolean;
  };
}

import { COMPANY, companyLines } from '../config/company';

export const printStyles = `
  @page { size: A4; margin: 12mm; }
  /* **الفاتورة الطويلة بتتقسّم على صفحات، وكل صفحة بتفضل مقروءة.**
     المتصفح بيقسّم لوحده، بس من غير القواعد دي بيقطع السطر في نصّه ويسيب الصفحة
     التانية بأرقام من غير عناوين — واللي ماسك الورقة التانية مايعرفش الرقم ده كمية
     ولا سعر. table-header-group بيكرّر رأس الجدول، وbreak-inside بيمنع قطع السطر.
     (من غير علامات باك-تِك هنا: النص ده جوّه template literal وبتقفله.) */
  @media print {
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr, .no-break { break-inside: avoid; page-break-inside: avoid; }
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    margin: 0; color: #16241c; background: #fff;
  }
  .sheet { max-width: 800px; margin: 0 auto; }
  .letterhead {
    display: flex; align-items: center; justify-content: space-between;
    gap: 20px; padding-bottom: 14px; border-bottom: 3px solid ${BRAND.green};
  }
  .letterhead .who { text-align: right; }
  .letterhead .who b { font-size: 21px; color: ${BRAND.green}; display: block; }
  .letterhead .who span { font-size: 12px; color: #5d6f64; display: block; margin-top: 2px; }
  .accent { height: 4px; background: ${BRAND.orange}; margin-top: 3px; }
  .doc-title {
    margin: 18px 0 10px; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; flex-wrap: wrap;
  }
  .doc-title h1 { margin: 0; font-size: 20px; color: ${BRAND.ink}; }
  .doc-no {
    background: ${BRAND.green}; color: #fff; padding: 5px 14px;
    border-radius: 999px; font-weight: 700; font-size: 14px;
  }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.meta td { border: 1px solid #d9e6dc; padding: 7px 10px; font-size: 13px; }
  table.meta td.k { background: #f2f9f3; font-weight: 700; width: 120px; color: #3a4d41; }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th {
    background: ${BRAND.green}; color: #fff; padding: 9px 8px;
    font-size: 13px; border: 1px solid ${BRAND.green};
  }
  table.grid td { border: 1px solid #d9e6dc; padding: 7px 8px; font-size: 13px; text-align: center; }
  table.grid tbody tr:nth-child(even) td { background: #f7fbf8; }
  table.grid tfoot td { font-weight: 800; background: #f2f9f3; }
  .totals { margin-top: 14px; margin-inline-start: auto; width: 320px; }
  .totals tr td { padding: 6px 10px; font-size: 14px; border-bottom: 1px dashed #d9e6dc; }
  .totals tr:last-child td {
    border-bottom: none; border-top: 2px solid ${BRAND.green};
    font-size: 17px; font-weight: 800; color: ${BRAND.green};
  }
  .signatures { display: flex; justify-content: space-between; margin-top: 42px; }
  .sig { width: 190px; text-align: center; border-top: 1px solid #98acb9; padding-top: 6px; font-size: 13px; }
  .foot {
    margin-top: 26px; padding-top: 10px; border-top: 2px solid ${BRAND.green};
    font-size: 11px; color: #5d6f64; display: flex; justify-content: space-between; gap: 12px;
  }
  @media print { .no-print { display: none; } }

  /* ============================ المضغوط — الشرح عند DocMeta.compact */
  body.compact .sheet { max-width: none; }
  .c-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding-bottom: 6px; border-bottom: 2px solid ${BRAND.green}; margin-bottom: 6px;
  }
  .c-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .c-brand img { display: block; }
  .c-brand b { font-size: 14px; color: ${BRAND.green}; display: block; line-height: 1.2; }
  .c-brand span { font-size: 10px; color: #5d6f64; display: block; line-height: 1.35; }
  .c-doc { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .c-doc .t { font-size: 16px; font-weight: 800; color: ${BRAND.ink}; }
  .c-doc .n {
    background: ${BRAND.green}; color: #fff; padding: 2px 10px;
    border-radius: 999px; font-weight: 700; font-size: 12px; direction: ltr;
  }
  /* البيانات في شبكة ٣ أعمدة، مش صف لكل حقل. */
  .c-meta {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 0;
    border: 1px solid #d9e6dc; border-radius: 4px; margin-bottom: 6px;
  }
  .c-meta div {
    padding: 3px 7px; font-size: 11px; border-bottom: 1px solid #eef4ef;
    border-inline-start: 1px solid #eef4ef; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis;
  }
  .c-meta div b { color: #3a4d41; font-weight: 700; margin-inline-end: 4px; }
  body.compact table.grid th { padding: 4px 5px; font-size: 11px; }
  body.compact table.grid td { padding: 3px 5px; font-size: 11px; line-height: 1.3; }
  /* الإجماليات جنب التوقيعات في شريط واحد، مش تحتها. */
  .c-bottom {
    display: flex; gap: 14px; align-items: flex-start; margin-top: 6px;
  }
  .c-bottom .totals { margin: 0; width: 300px; flex-shrink: 0; }
  body.compact .totals tr td { padding: 2px 8px; font-size: 11.5px; }
  body.compact .totals tr:last-child td { font-size: 13px; }
  .c-sigs {
    flex: 1; display: flex; justify-content: space-around; align-self: flex-end;
    gap: 10px; padding-top: 26px;
  }
  .c-sigs .sig {
    width: auto; flex: 1; border-top: 1px solid #98acb9; padding-top: 3px;
    font-size: 10.5px; text-align: center;
  }
  /* الفوتر على أعمدة — زي دفتر الفواتير. الشرح عند footerColumns. */
  .f-cols { display: flex; gap: 10px; margin-top: 8px; align-items: stretch; }
  .f-col {
    flex: 1; border: 1px solid #d9e6dc; border-radius: 4px; padding: 3px 0;
  }
  .f-row {
    display: flex; justify-content: space-between; gap: 8px;
    padding: 3px 8px; font-size: 11.5px; border-bottom: 1px dotted #d9e6dc;
  }
  .f-row:last-child { border-bottom: none; }
  .f-row b { white-space: nowrap; direction: ltr; }
  .f-strong { background: #f2f9f3; font-weight: 800; }
  .f-strong b { color: ${BRAND.green}; font-size: 13px; }
  body.compact .c-sigs { padding-top: 22px; }
  /* الورق اللي لسه بيكتب .signatures و.totals بالشكل القديم (السندات،
     التحويلات، التقارير) بياخد نفس الكثافة من غير ما حد يعيد كتابته. */
  body.compact .signatures { margin-top: 20px; }
  body.compact .signatures .sig { font-size: 10.5px; padding-top: 3px; width: 160px; }
  body.compact table.totals { margin-top: 6px; }
  body.compact table.meta td { padding: 3px 7px; font-size: 11px; }
  body.compact h2, body.compact h3 { margin: 8px 0 4px; font-size: 13px; }
  body.compact .foot {
    margin-top: 8px; padding-top: 4px; border-top: 1px solid #d9e6dc; font-size: 9.5px;
  }
`;

/** The letterhead + document title + meta table, ready to prepend to a document body. */
export function letterhead(meta: DocMeta): string {
  const metaRows = (meta.meta || [])
    .map(([k, v]) => `<tr><td class="k">${k}</td><td>${v ?? '-'}</td></tr>`)
    .join('');
  const h = meta.hide || {};
  // The whole strip goes only when BOTH halves are off — one of the two alone still needs the
  // rule under it to separate the head from the document.
  const head = (h.logo && h.companyName) ? '' : `
  <div class="letterhead">
    ${h.companyName ? '' : `<div class="who">
      <b>${COMPANY.nameAr}</b>
      ${companyLines().map((l) => `<span>${l}</span>`).join('')}
    </div>`}
    ${h.logo ? '' : logoSvg(190)}
  </div>
  <div class="accent"></div>`;
  const title = (h.invoiceTitle && h.invoiceNumber) ? '' : `
  <div class="doc-title">
    ${h.invoiceTitle ? '' : `<h1>${meta.title}</h1>`}
    ${(meta.number && !h.invoiceNumber) ? `<div class="doc-no">${meta.number}</div>` : ''}
  </div>`;
  return `${head}${title}
  ${metaRows ? `<table class="meta">${metaRows}</table>` : ''}`;
}

/**
 * ترويسة المضغوط: سطر واحد — الشركة على اليمين والمستند على الشمال — وتحته
 * البيانات في شبكة ٣ أعمدة. الشرح عند `DocMeta.compact`.
 */
export function compactHead(meta: DocMeta): string {
  const h = meta.hide || {};
  const brand = (h.logo && h.companyName) ? '<div></div>' : `
    <div class="c-brand">
      ${h.logo ? '' : `<img src="${LOGO_DATA_URI}" width="54" alt="">`}
      ${h.companyName ? '' : `<div><b>${COMPANY.nameAr}</b>
        <span>${companyLines().slice(0, 2).join(' · ')}</span></div>`}
    </div>`;
  const doc = (h.invoiceTitle && h.invoiceNumber) ? '' : `
    <div class="c-doc">
      ${h.invoiceTitle ? '' : `<span class="t">${meta.title}</span>`}
      ${(meta.number && !h.invoiceNumber) ? `<span class="n">${meta.number}</span>` : ''}
    </div>`;
  const cells = (meta.meta || [])
    .map(([k, v]) => `<div><b>${k}:</b>${v ?? '-'}</div>`).join('');
  // **سطرين: العنوان ورقمه فوق، والبيانات تحتهم بعرض الصفحة.** اتجرّب شريط واحد
  // (العنوان جنب البيانات) واترفض — الرقم والعنوان لازم يبقوا لوحدهم وواضحين.
  return `<div class="c-head">${brand}${doc}</div>`
    + (cells ? `<div class="c-meta">${cells}</div>` : '');
}

export function footer(note?: string, hideCompany = false): string {
  // الجملة الافتراضية نفسها بتسمّي الشركة، فالورقة اللي بتتشال منها الهوية بتسكت
  // خالص بدل ما تقول «صادر آلياً من نظام تكنو ثيرم».
  const left = note || (hideCompany ? '' : 'هذا المستند صادر آلياً من نظام تكنو ثيرم.');
  const right = hideCompany
    ? '' : `${COMPANY.address} — ت: ${COMPANY.phones.join(' / ')}`;
  if (!left && !right) return '';
  return `<div class="foot"><span>${left}</span><span>${right}</span></div>`;
}

/** Wrap a document body in the branded shell and open the browser's print dialog. */
export function printDocument(meta: DocMeta, bodyHtml: string): void {
  // المضغوط بيصغّر هامش الصفحة كمان: ١٢ مم من كل ناحية = ٢٤ مم من عرض A4
  // (١٤٪) رايحين أبيض.
  // **المضغوط بقى الافتراضي لكل ورقة**، مش الفواتير بس — السندات والتحويلات
  // والأذون وأوامر الشغل والتقارير كلهم كانوا بيبدأوا بترويسة بتاكل تلت الصفحة.
  // `compact: false` بيرجّع الشكل القديم لورقة محتاجاه.
  const compact = meta.compact ?? true;
  const page = compact ? '<style>@page { size: A4; margin: 7mm; }</style>' : '';
  const head = compact ? compactHead(meta) : letterhead(meta);
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${meta.title}${meta.number ? ` ${meta.number}` : ''}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${printStyles}</style>${page}</head>
<body class="${compact ? 'compact' : ''}"><div class="sheet">${head}${bodyHtml}${footer(meta.note, Boolean(meta.hide?.companyFooter))}</div>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
  const win = window.open('', '_blank', 'width=1000,height=1000');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
