export interface RepLike {
  id: number;
  full_name?: string | null;
  username?: string | null;
  active?: boolean;
}

export const isStopped = (r: RepLike) => r.active === false;

export function repChoices<T extends RepLike>(reps: T[], keep?: number | null): T[] {
  return reps.filter((r) => !isStopped(r) || (keep != null && r.id === keep));
}

export function repOptions(reps: RepLike[], keep?: number | null) {
  return repChoices(reps, keep).map((r) => ({
    value: r.id,
    label: `${r.full_name || r.username || r.id}${isStopped(r) ? ' (موقوف)' : ''}`,
  }));
}
