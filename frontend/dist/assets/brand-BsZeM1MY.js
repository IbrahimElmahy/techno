import{b$ as o,c2 as p}from"./index-D68iTLTO.js";const i={nameAr:"تكنو ثيرم",nameEn:"TechnoTherm — German Technology",activity:"أنظمة السباكة والتغذية",address:"قطعة 676 امتداد المنطقة الصناعية السادسة — مدينة السادس من أكتوبر",phones:["01062240047","01020275910"],email:""};function l(){return[i.nameEn,i.activity,i.address,`ت: ${i.phones.join(" - ")}`,"","",i.email].filter(Boolean)}const c=`
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
`;function g(e){const a=(e.meta||[]).map(([d,s])=>`<tr><td class="k">${d}</td><td>${s??"-"}</td></tr>`).join(""),t=e.hide||{},n=t.logo&&t.companyName?"":`
  <div class="letterhead">
    ${t.companyName?"":`<div class="who">
      <b>${i.nameAr}</b>
      ${l().map(d=>`<span>${d}</span>`).join("")}
    </div>`}
    ${t.logo?"":p(190)}
  </div>
  <div class="accent"></div>`,r=t.invoiceTitle&&t.invoiceNumber?"":`
  <div class="doc-title">
    ${t.invoiceTitle?"":`<h1>${e.title}</h1>`}
    ${e.number&&!t.invoiceNumber?`<div class="doc-no">${e.number}</div>`:""}
  </div>`;return`${n}${r}
  ${a?`<table class="meta">${a}</table>`:""}`}function f(e,a=!1){const t=e||(a?"":"هذا المستند صادر آلياً من نظام تكنو ثيرم."),n=a?"":`${i.address} — ت: ${i.phones.join(" / ")}`;return!t&&!n?"":`<div class="foot"><span>${t}</span><span>${n}</span></div>`}function h(e,a){var r;const t=`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${e.title}${e.number?` ${e.number}`:""}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${c}</style></head>
<body><div class="sheet">${g(e)}${a}${f(e.note,!!((r=e.hide)!=null&&r.companyFooter))}</div>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`,n=window.open("","_blank","width=1000,height=1000");n&&(n.document.write(t),n.document.close())}export{i as C,l as c,h as p};
