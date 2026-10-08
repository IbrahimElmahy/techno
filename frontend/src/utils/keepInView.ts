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
