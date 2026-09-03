import{p as o}from"./brand-BzPFnluT.js";function i(t){return t==null?"":String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function u(t,e){return typeof e.value=="function"?e.value(t):t[e.value]}function m(t,e,r){if(!t.length)return"";const d=t.map(a=>`<th>${i(a.title)}</th>`).join(""),n=e.map(a=>`<tr>${t.map(l=>`<td${l.numeric?' style="text-align:left;direction:ltr"':""}>${i(u(a,l))}</td>`).join("")}</tr>`).join(""),c=e.length?"":`<tr><td colspan="${t.length}">مفيش بيانات في المدى المحدد</td></tr>`,s=r!=null&&r.length?`<table class="totals">${r.map(a=>`<tr><td>${i(a.label)}</td><td>${i(a.value)}</td></tr>`).join("")}</table>`:"";return`<table class="grid"><thead><tr>${d}</tr></thead><tbody>${n}${c}</tbody></table>${s}`}function h(t,e,r,d){const n={...t,meta:[...t.meta??[],["عدد السطور",String(r.length)]]};o(n,m(e,r,d))}function p(t){const e=n=>Number(n||0).toLocaleString("ar-EG",{minimumFractionDigits:2,maximumFractionDigits:2}),d=`<table class="grid">
      <thead><tr><th>البند</th><th>العدد</th><th>استحقاق</th><th>استقطاع</th></tr></thead>
      <tbody>${t.details.map(n=>`<tr>
      <td style="text-align:start">${i(n.label)}</td>
      <td>${n.quantity?i(Number(n.quantity)):""}</td>
      <td class="num">${n.kind==="earning"?e(n.amount):""}</td>
      <td class="num">${n.kind==="deduction"?e(n.amount):""}</td>
    </tr>`).join("")}</tbody>
    </table>
    <table class="totals">
      <tr><td>إجمالي الاستحقاق</td><td>${e(t.line.gross)}</td></tr>
      <tr><td>إجمالي الاستقطاع</td><td>${e(t.line.total_deductions)}</td></tr>
      <tr><td>الصافي</td><td>${e(t.line.net)}</td></tr>
    </table>
    <div class="signatures">
      <div class="sig">توقيع الموظف</div>
      <div class="sig">المختص</div>
    </div>`;o({title:"قسيمة راتب",number:t.run.document_number,meta:[["الموظف",t.employee_name??""],["الشهر",`${t.run.year}/${String(t.run.month).padStart(2,"0")}`]],note:"قسيمة صادرة آلياً — أي اعتراض يتقدّم خلال شهر من تاريخ الصرف."},d)}export{p as a,h as p,m as r};
