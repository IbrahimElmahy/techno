import { flashExistingItem } from './duplicateItem';

export type PickResult = { needsQty?: string | number; dup?: number } | void | null;

export async function addPickedSequentially(
  ids: number[],
  qtys: Record<number, number> | undefined,
  add: (id: number, qty: number | null) => PickResult | Promise<PickResult>,
  focus: (key: any) => void,
): Promise<void> {
  let first: string | number | null = null;
  let dup: number | null = null;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const r = await add(id, qtys?.[id] ?? null);
    if (r?.needsQty != null && first == null) first = r.needsQty;
    if (r?.dup != null && dup == null) dup = r.dup;
  }
  if (first != null) focus(first);
  else if (dup != null) flashExistingItem(dup);
}
