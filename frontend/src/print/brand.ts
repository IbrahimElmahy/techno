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
  /** اسم الملف لما الورقة تتحفظ PDF (عنوان الصفحة) — من غيره العنوان والرقم. */
  fileName?: string;
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

/**
 * **ألوان الورق — أبيض وأسود الأول، والأخضر لمسة.**
 *
 * أغلب طابعات المكاتب ليزر أبيض وأسود، والمتصفح بيطبع **من غير خلفيات** افتراضياً.
 * فأي كلام شايله لون الخلفية لوحده بيضيع: الأبيض على الأخضر بيطلع أبيض على أبيض،
 * والخط الأخضر الفاتح بين الخانات بيطلع رمادي باهت أو مابيطلعش خالص — وده بالظبط
 * اللي في الورق اللي العميل بعته (٢٠٢٦-١٠-٠٦): صف العناوين فاضي والشبكة مش باينة.
 *
 * القاعدة: كل كلام أسود (أو قريب جداً منه) على أبيض، وكل حدّ خط غامق مصمت. الخلفية
 * الفاتحة مسموحة كزيادة — لو اتطبعت كويس، ولو ماتطبعتش الخط الغامق اللي حوالين الصف
 * لسه بيقول «ده صف عناوين». والأخضر بتاع الشركة فاضل في خط الترويسة والذيل بس.
 */
export const PRINT_COLORS = {
  text: '#000',
  /** الكلام الثانوي (اسم الحقل، العنوان تحت الشركة) — غامق برضه، مش رمادي باهت. */
  muted: '#2b2b2b',
  /** خطوط الشبكة — غامقة كفاية تطلع على أضعف ليزر. */
  line: '#444',
  /** الخط اللي بيقفل رأس الجدول وإجماليه. */
  strong: '#000',
  /** فواصل جوّه بلوك (منقّطة/متقطّعة) — أفتح من الشبكة بس لسه بتبان. */
  soft: '#777',
  /** خلفية الرأس والإجمالي — رمادي فاتح محايد، مش أخضر: الأخضر الفاتح بيطلع بقع. */
  fill: '#e6e6e6',
};
const P = PRINT_COLORS;

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
    margin: 0; color: ${P.text}; background: #fff;
  }
  .sheet { max-width: 800px; margin: 0 auto; }
  .letterhead {
    display: flex; align-items: center; justify-content: space-between;
    gap: 20px; padding-bottom: 14px; border-bottom: 3px solid ${BRAND.green};
  }
  .letterhead .who { text-align: right; }
  /* اسم الشركة أسود: أخضر ٢١ بيكسل على ليزر بيطلع رمادي متوسط. الخط الأخضر تحته كفاية هوية. */
  .letterhead .who b { font-size: 21px; color: ${P.text}; display: block; }
  .letterhead .who span { font-size: 12.5px; color: ${P.muted}; display: block; margin-top: 2px; }
  .accent { height: 4px; background: ${BRAND.orange}; margin-top: 3px; }
  .doc-title {
    margin: 18px 0 10px; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; flex-wrap: wrap;
  }
  .doc-title h1 { margin: 0; font-size: 20px; color: ${P.text}; }
  /* رقم المستند بإطار مش بكبسولة ملوّنة — الأبيض على الأخضر كان بيختفي على الورق،
     والشاشة دلوقتي بتورّي نفس اللي هيطلع. */
  .doc-no {
    background: none; color: ${P.text}; border: 1.5px solid ${P.strong}; padding: 4px 14px;
    border-radius: 999px; font-weight: 800; font-size: 14px;
  }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.meta td { border: 1px solid ${P.line}; padding: 7px 10px; font-size: 13.5px; color: ${P.text}; }
  table.meta td.k { background: ${P.fill}; font-weight: 800; width: 120px; color: ${P.text}; }
  table.grid { width: 100%; border-collapse: collapse; }
  /* **رأس الجدول: أسود تقيل على رمادي فاتح، ومقفول بخط أسود.** نفس الشكل على الشاشة وعلى
     الورق — اللي بيبص على المعاينة قبل الطباعة بيشوف اللي هيطلع بالظبط. */
  table.grid th {
    background: ${P.fill}; color: ${P.text}; padding: 8px 8px; font-weight: 800;
    font-size: 13.5px; border: 1px solid ${P.line}; border-bottom: 2px solid ${P.strong};
  }
  table.grid td {
    border: 1px solid ${P.line}; padding: 7px 8px; font-size: 13.5px; text-align: center;
    color: ${P.text};
  }
  /* التظليل بالتبادل للشاشة بس — على الورق الشبكة الغامقة هي اللي بتمسك السطر. */
  table.grid tbody tr:nth-child(even) td { background: #f5f5f5; }
  table.grid tfoot td {
    font-weight: 800; background: ${P.fill}; border-top: 2px solid ${P.strong};
  }
  .totals { margin-top: 14px; margin-inline-start: auto; width: 320px; }
  .totals tr td {
    padding: 6px 10px; font-size: 14px; border-bottom: 1px dashed ${P.soft}; color: ${P.text};
  }
  .totals tr:last-child td {
    border-bottom: none; border-top: 2px solid ${P.strong};
    font-size: 17px; font-weight: 800; color: ${P.text};
  }
  .signatures { display: flex; justify-content: space-between; margin-top: 42px; }
  .sig { width: 190px; text-align: center; border-top: 1px solid ${P.strong}; padding-top: 6px; font-size: 13px; }
  .foot {
    margin-top: 26px; padding-top: 10px; border-top: 2px solid ${BRAND.green};
    font-size: 11.5px; color: ${P.muted}; display: flex; justify-content: space-between; gap: 12px;
  }
  @media print { .no-print { display: none; } }
  /* الخلفيات الفاتحة (رأس الجدول والإجمالي واسم الحقل) بتتطلب صراحةً عشان تطلع لو الطابعة
     بتقدر — ولو المستخدم قافلها من نافذة الطباعة، الخط الأسود والكلام التقيل لسه شايلين المعنى. */
  @media print {
    table.grid th, table.grid tfoot td, table.meta td.k, .f-strong {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    table.grid tbody tr:nth-child(even) td { background: none; }
  }

  /* ============================ المضغوط — الشرح عند DocMeta.compact */
  body.compact .sheet { max-width: none; }
  .c-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding-bottom: 6px; border-bottom: 2px solid ${BRAND.green}; margin-bottom: 6px;
  }
  .c-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .c-brand img { display: block; }
  .c-brand b { font-size: 14.5px; color: ${P.text}; display: block; line-height: 1.2; }
  .c-brand span { font-size: 11px; color: ${P.muted}; display: block; line-height: 1.35; }
  .c-doc { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .c-doc .t { font-size: 16px; font-weight: 800; color: ${P.text}; }
  .c-doc .n {
    background: none; color: ${P.text}; border: 1.5px solid ${P.strong}; padding: 1px 10px;
    border-radius: 999px; font-weight: 800; font-size: 13px; direction: ltr;
  }
  /* البيانات في شبكة ٣ أعمدة، مش صف لكل حقل. */
  .c-meta {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 0;
    border: 1px solid ${P.line}; border-radius: 4px; margin-bottom: 6px;
  }
  .c-meta div {
    padding: 3px 7px; font-size: 12px; border-bottom: 1px solid #999;
    border-inline-start: 1px solid #999; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; color: ${P.text};
  }
  .c-meta div b { color: ${P.text}; font-weight: 800; margin-inline-end: 4px; }
  /* **١٢٫٥ أقل حاجة في جسم الجدول.** كان ١١ عشان الفاتورة تلمّ في صفحة — وعلى ليزر
     بيسيّح الحبر شوية، ١١ عربي بقى نقط ملزوقة في بعض. الحشو هو اللي اتقلّ مش الخط. */
  body.compact table.grid th { padding: 4px 5px; font-size: 12.5px; }
  body.compact table.grid td { padding: 3px 5px; font-size: 12.5px; line-height: 1.35; }
  /* الإجماليات جنب التوقيعات في شريط واحد، مش تحتها. */
  .c-bottom {
    display: flex; gap: 14px; align-items: flex-start; margin-top: 6px;
  }
  .c-bottom .totals { margin: 0; width: 300px; flex-shrink: 0; }
  body.compact .totals tr td { padding: 2px 8px; font-size: 12.5px; }
  body.compact .totals tr:last-child td { font-size: 14px; }
  .c-sigs {
    flex: 1; display: flex; justify-content: space-around; align-self: flex-end;
    gap: 10px; padding-top: 26px;
  }
  .c-sigs .sig {
    width: auto; flex: 1; border-top: 1px solid ${P.strong}; padding-top: 3px;
    font-size: 12px; text-align: center;
  }
  /* الفوتر على أعمدة — زي دفتر الفواتير. الشرح عند footerColumns. */
  .f-cols { display: flex; gap: 10px; margin-top: 8px; align-items: stretch; }
  .f-col {
    flex: 1; border: 1px solid ${P.line}; border-radius: 4px; padding: 3px 0;
  }
  .f-row {
    display: flex; justify-content: space-between; gap: 8px;
    padding: 3px 8px; font-size: 12.5px; border-bottom: 1px dotted ${P.soft}; color: ${P.text};
  }
  .f-row:last-child { border-bottom: none; }
  .f-row b { white-space: nowrap; direction: ltr; }
  /* السطر المهم (الصافي/المطلوب) بخط أسود فوقه — الخلفية لوحدها مش ضمان إنها تطلع. */
  .f-strong { background: ${P.fill}; font-weight: 800; border-top: 1.5px solid ${P.strong}; }
  .f-strong b { color: ${P.text}; font-size: 14px; }
  body.compact .c-sigs { padding-top: 22px; }
  /* الورق اللي لسه بيكتب .signatures و.totals بالشكل القديم (السندات،
     التحويلات، التقارير) بياخد نفس الكثافة من غير ما حد يعيد كتابته. */
  body.compact .signatures { margin-top: 20px; }
  body.compact .signatures .sig { font-size: 12px; padding-top: 3px; width: 160px; }
  body.compact table.totals { margin-top: 6px; }
  body.compact table.meta td { padding: 3px 7px; font-size: 12px; }
  body.compact h2, body.compact h3 { margin: 8px 0 4px; font-size: 14px; }
  body.compact .foot {
    margin-top: 8px; padding-top: 4px; border-top: 1px solid ${P.line}; font-size: 10.5px;
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
<title>${meta.fileName ? meta.fileName.replace(/[\/:*?"<>|]/g, ' ').trim() : `${meta.title}${meta.number ? ` ${meta.number}` : ''}`}</title>
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
