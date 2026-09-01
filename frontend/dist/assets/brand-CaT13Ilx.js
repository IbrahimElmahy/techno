import{bZ as o,c0 as p}from"./index-I1zAeTE5.js";const n={nameAr:"تكنو ثيرم",nameEn:"TechnoTherm — German Technology",activity:"أنظمة السباكة والتغذية",address:"قطعة 676 امتداد المنطقة الصناعية السادسة — مدينة السادس من أكتوبر",phones:["01062240047","01020275910"],email:""};function l(){return[n.nameEn,n.activity,n.address,`ت: ${n.phones.join(" - ")}`,"","",n.email].filter(Boolean)}const c=`
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    margin: 0; color: #16241c; background: #fff;
  }
  .sheet { max-width: 800px; margin: 0 auto; }
  .letterhead {
    display: flex; align-items: center; justify-content: space-between;
    gap: 20px; padding-bottom: 14px; border-bottom: 3px solid ${o.green};
  }
  .letterhead .who { text-align: right; }
  .letterhead .who b { font-size: 21px; color: ${o.green}; display: block; }
  .letterhead .who span { font-size: 12px; color: #5d6f64; display: block; margin-top: 2px; }
  .accent { height: 4px; background: ${o.orange}; margin-top: 3px; }
  .doc-title {
    margin: 18px 0 10px; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; flex-wrap: wrap;
  }
  .doc-title h1 { margin: 0; font-size: 20px; color: ${o.ink}; }
  .doc-no {
    background: ${o.green}; color: #fff; padding: 5px 14px;
    border-radius: 999px; font-weight: 700; font-size: 14px;
  }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.meta td { border: 1px solid #d9e6dc; padding: 7px 10px; font-size: 13px; }
  table.meta td.k { background: #f2f9f3; font-weight: 700; width: 120px; color: #3a4d41; }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th {
    background: ${o.green}; color: #fff; padding: 9px 8px;
    font-size: 13px; border: 1px solid ${o.green};
  }
  table.grid td { border: 1px solid #d9e6dc; padding: 7px 8px; font-size: 13px; text-align: center; }
  table.grid tbody tr:nth-child(even) td { background: #f7fbf8; }
  table.grid tfoot td { font-weight: 800; background: #f2f9f3; }
  .totals { margin-top: 14px; margin-inline-start: auto; width: 320px; }
  .totals tr td { padding: 6px 10px; font-size: 14px; border-bottom: 1px dashed #d9e6dc; }
  .totals tr:last-child td {
    border-bottom: none; border-top: 2px solid ${o.green};
    font-size: 17px; font-weight: 800; color: ${o.green};
  }
  .signatures { display: flex; justify-content: space-between; margin-top: 42px; }
  .sig { width: 190px; text-align: center; border-top: 1px solid #98acb9; padding-top: 6px; font-size: 13px; }
  .foot {
    margin-top: 26px; padding-top: 10px; border-top: 2px solid ${o.green};
    font-size: 11px; color: #5d6f64; display: flex; justify-content: space-between; gap: 12px;
  }
  @media print { .no-print { display: none; } }
`;function g(t){const a=(t.meta||[]).map(([d,s])=>`<tr><td class="k">${d}</td><td>${s??"-"}</td></tr>`).join(""),e=t.hide||{},i=e.logo&&e.companyName?"":`
  <div class="letterhead">
    ${e.companyName?"":`<div class="who">
      <b>${n.nameAr}</b>
      ${l().map(d=>`<span>${d}</span>`).join("")}
    </div>`}
    ${e.logo?"":p(190)}
  </div>
  <div class="accent"></div>`,r=e.invoiceTitle&&e.invoiceNumber?"":`
  <div class="doc-title">
    ${e.invoiceTitle?"":`<h1>${t.title}</h1>`}
    ${t.number&&!e.invoiceNumber?`<div class="doc-no">${t.number}</div>`:""}
  </div>`;return`${i}${r}
  ${a?`<table class="meta">${a}</table>`:""}`}function f(t){return`<div class="foot">
    <span>${t||"هذا المستند صادر آلياً من نظام تكنو ثيرم."}</span>
    <span>${n.address} — ت: ${n.phones.join(" / ")}</span>
  </div>`}function b(t,a){const e=`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${t.title}${t.number?` ${t.number}`:""}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${c}</style></head>
<body><div class="sheet">${g(t)}${a}${f(t.note)}</div>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`,i=window.open("","_blank","width=1000,height=1000");i&&(i.document.write(e),i.document.close())}export{n as C,l as c,b as p};
