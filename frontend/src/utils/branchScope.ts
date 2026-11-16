import { roleForAccess, type User } from '../components/AuthProvider';

export function seesAllBranches(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.branch_ids?.length) return false;
  return roleForAccess(user.role) === 'system_admin' || !user.branch_id;
}

export function ownBranches<T extends { id: number }>(list: T[], user: User | null | undefined): T[] {
  if (seesAllBranches(user)) return list;
  return list.filter((b) => b.id === user?.branch_id);
}
