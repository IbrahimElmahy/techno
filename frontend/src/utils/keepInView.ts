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
  if (er.top < br.top) b.scrollTop -= (br.top - er.top);
  else if (er.bottom > br.bottom) b.scrollTop += (er.bottom - br.bottom);
}
