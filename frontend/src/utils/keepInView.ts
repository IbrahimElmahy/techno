/**
 * تخلّي عنصر ظاهر جوّه صندوقه — والصندوق بس هو اللي بيتحرك.
 *
 * `scrollIntoView` بيلف على **كل** أب بيعمل تمرير فوق العنصر: القايمة، وجسم النافذة،
 * والصفحة اللي وراها. فالسهم لتحت لحد آخر صف ظاهر كان بيحرّك التلاتة مع بعض، والشاشة
 * بتنطّ — بيبان كإنها رجعت لفوق. وده كان في كل قايمة بتتنقّل بالكيبورد: شباك الأصناف،
 * شباك جهة التعامل، وكل جدول في النظام.
 *
 * الحساب هنا بالفرق بين حدود العنصر وحدود الصندوق، فمافيش حاجة برّا الصندوق بتتلمس، وبأقل
 * حركة تخلّي العنصر ظاهر بالكامل: الطالع من فوق بيتظبط من فوق، والطالع من تحت من تحت.
 */

/** أقرب أب بيعمل تمرير فعلاً — مش اللي مكتوب عليه `auto` وهو مش بيمرّر. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay')
      && p.scrollHeight > p.clientHeight + 1) return p;
    p = p.parentElement;
  }
  return null;
}

export function keepInView(
  el: HTMLElement | null | undefined,
  box?: HTMLElement | null,
): void {
  if (!el) return;
  const b = box ?? scrollParent(el);
  if (!b) return;
  const br = b.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  // الحاجات المثبّتة جوّه الصندوق بتغطّي جزء منه: ترويسة جدول مثبّتة فوق، وإجمالي المستند
  // المثبّت تحت (`.sale-bottom`). الصف اللي تحتهم مش ظاهر حتى لو جوّه حدود الصندوق.
  let top = br.top;
  let bottom = br.bottom;
  b.querySelectorAll<HTMLElement>('.sale-bottom, .ant-table-sticky-holder').forEach((s) => {
    if (s.contains(el)) return;
    const r = s.getBoundingClientRect();
    if (r.height === 0) return;
    if (s.classList.contains('sale-bottom')) { if (r.top < bottom && r.bottom >= bottom - 2) bottom = r.top; }
    else if (r.top <= top + 2 && r.bottom > top) top = r.bottom;
  });
  const pad = 6;
  if (er.top < top) b.scrollTop -= (top - er.top) + pad;
  else if (er.bottom > bottom) b.scrollTop += (er.bottom - bottom) + pad;
}
