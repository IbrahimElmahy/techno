import { BRAND, LOGO_DATA_URI, logoSvg } from '../components/Logo';

export interface DocMeta {
  title: string;
  number?: string;
  fileName?: string;
  date?: string;
  meta?: [string, string][];
  note?: string;
  compact?: boolean;
  hide?: {
    logo?: boolean;
    companyName?: boolean;
    invoiceNumber?: boolean;
    invoiceTitle?: boolean;
    companyFooter?: boolean;
  };
}

import { COMPANY, companyLines } from '../config/company';

export const PRINT_COLORS = {
  text: '#000',
  muted: '#2b2b2b',
  line: '#444',
  strong: '#000',
  soft: '#777',
  fill: '#e6e6e6',
};
const P = PRINT_COLORS;

export const printStyles = `
  @page { size: A4; margin: 12mm; }
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
  .letterhead .who b { font-size: 21px; color: ${P.text}; display: block; }
  .letterhead .who span { font-size: 12.5px; color: ${P.muted}; display: block; margin-top: 2px; }
  .accent { height: 4px; background: ${BRAND.orange}; margin-top: 3px; }
  .doc-title {
    margin: 18px 0 10px; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; flex-wrap: wrap;
  }
  .doc-title h1 { margin: 0; font-size: 20px; color: ${P.text}; }
  .doc-no {
    background: none; color: ${P.text}; border: 1.5px solid ${P.strong}; padding: 4px 14px;
    border-radius: 999px; font-weight: 800; font-size: 14px;
  }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.meta td { border: 1px solid ${P.line}; padding: 7px 10px; font-size: 13.5px; color: ${P.text}; }
  table.meta td.k { background: ${P.fill}; font-weight: 800; width: 120px; color: ${P.text}; }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th {
    background: ${P.fill}; color: ${P.text}; padding: 8px 8px; font-weight: 800;
    font-size: 13.5px; border: 1px solid ${P.line}; border-bottom: 2px solid ${P.strong};
  }
  table.grid td {
    border: 1px solid ${P.line}; padding: 7px 8px; font-size: 13.5px; text-align: center;
    color: ${P.text};
  }
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
  @media print {
    table.grid th, table.grid tfoot td, table.meta td.k, .f-strong {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    table.grid tbody tr:nth-child(even) td { background: none; }
  }

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
  body.compact table.grid th { padding: 4px 5px; font-size: 12.5px; }
  body.compact table.grid td { padding: 3px 5px; font-size: 12.5px; line-height: 1.35; }
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
  .f-strong { background: ${P.fill}; font-weight: 800; border-top: 1.5px solid ${P.strong}; }
  .f-strong b { color: ${P.text}; font-size: 14px; }
  body.compact .c-sigs { padding-top: 22px; }
  body.compact .signatures { margin-top: 20px; }
  body.compact .signatures .sig { font-size: 12px; padding-top: 3px; width: 160px; }
  body.compact table.totals { margin-top: 6px; }
  body.compact table.meta td { padding: 3px 7px; font-size: 12px; }
  body.compact h2, body.compact h3 { margin: 8px 0 4px; font-size: 14px; }
  body.compact .foot {
    margin-top: 8px; padding-top: 4px; border-top: 1px solid ${P.line}; font-size: 10.5px;
  }
`;

export function letterhead(meta: DocMeta): string {
  const metaRows = (meta.meta || [])
    .map(([k, v]) => `<tr><td class="k">${k}</td><td>${v ?? '-'}</td></tr>`)
    .join('');
  const h = meta.hide || {};
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
  return `<div class="c-head">${brand}${doc}</div>`
    + (cells ? `<div class="c-meta">${cells}</div>` : '');
}

export function footer(note?: string, hideCompany = false): string {
  const left = note || (hideCompany ? '' : 'هذا المستند صادر آلياً من نظام تكنو ثيرم.');
  const right = hideCompany
    ? '' : `${COMPANY.address} — ت: ${COMPANY.phones.join(' / ')}`;
  if (!left && !right) return '';
  return `<div class="foot"><span>${left}</span><span>${right}</span></div>`;
}

export function latinDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\u066C/g, ',')
    .replace(/\u066B/g, '.')
    .replace(/\u061C/g, '');
}

export function printDocument(meta: DocMeta, bodyHtml: string): void {
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
  win.document.write(latinDigits(html));
  win.document.close();
}
