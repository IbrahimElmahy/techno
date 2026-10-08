export interface ActiveLike {
  id?: number | string;
  active?: boolean | null;
}

export const isInactive = (r: ActiveLike | null | undefined) => r?.active === false;

type Keep = number | string | null | undefined | (number | string | null | undefined)[];

const kept = (keep: Keep, id: ActiveLike['id']) =>
  id != null && (Array.isArray(keep) ? keep.some((k) => k != null && String(k) === String(id))
    : keep != null && String(keep) === String(id));

export function activeChoices<T extends ActiveLike>(rows: T[], keep?: Keep): T[] {
  return rows.filter((r) => !isInactive(r) || kept(keep, r.id));
}

export const withInactiveTag = (name: string, r: ActiveLike | null | undefined) =>
  (isInactive(r) ? `${name} (موقوف)` : name);

export function activeOptions<T extends ActiveLike & { id: number; name?: string | null }>(
  rows: T[], keep?: Keep,
) {
  return activeChoices(rows, keep).map((r) => ({
    value: r.id, label: withInactiveTag(r.name || `#${r.id}`, r),
  }));
}
