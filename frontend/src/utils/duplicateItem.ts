export const QTY_DATA_ATTR = 'data-qty-row';

export function flashExistingItem(id: number | string) {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[${QTY_DATA_ATTR}="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('qty-flash');
    void el.offsetWidth;
    el.classList.add('qty-flash');
    const input = el.querySelector('input');
    input?.focus();
    input?.select();
  }, 60);
}
