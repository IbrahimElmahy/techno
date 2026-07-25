import { BRAND, logoSvg } from '../components/Logo';


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
}

import { COMPANY, companyLines } from '../config/company';

export const printStyles = `
  @page { size: A4; margin: 12mm; }
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
`;

/** The letterhead + document title + meta table, ready to prepend to a document body. */
export function letterhead(meta: DocMeta): string {
  const metaRows = (meta.meta || [])
    .map(([k, v]) => `<tr><td class="k">${k}</td><td>${v ?? '-'}</td></tr>`)
    .join('');
  return `
  <div class="letterhead">
    <div class="who">
      <b>${COMPANY.nameAr}</b>
      ${companyLines().map((l) => `<span>${l}</span>`).join('')}
    </div>
    ${logoSvg(190)}
  </div>
  <div class="accent"></div>
  <div class="doc-title">
    <h1>${meta.title}</h1>
    ${meta.number ? `<div class="doc-no">${meta.number}</div>` : ''}
  </div>
  ${metaRows ? `<table class="meta">${metaRows}</table>` : ''}`;
}

export function footer(note?: string): string {
  return `<div class="foot">
    <span>${note || 'هذا المستند صادر آلياً من نظام تكنو ثيرم.'}</span>
    <span>${COMPANY.address} — ت: ${COMPANY.phones.join(' / ')}</span>
  </div>`;
}

/** Wrap a document body in the branded shell and open the browser's print dialog. */
export function printDocument(meta: DocMeta, bodyHtml: string): void {
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${meta.title}${meta.number ? ` ${meta.number}` : ''}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${printStyles}</style></head>
<body><div class="sheet">${letterhead(meta)}${bodyHtml}${footer(meta.note)}</div>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
  const win = window.open('', '_blank', 'width=1000,height=1000');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
