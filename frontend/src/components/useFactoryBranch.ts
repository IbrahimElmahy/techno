import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthProvider';

let cached: Promise<Set<number>> | null = null;

function factoryBranchIds(): Promise<Set<number>> {
  if (!cached) {
    cached = api
      .get('/api/v1/branches')
      .then((res) => {
        const out = new Set<number>();
        for (const b of res.data || []) if (b?.is_factory) out.add(Number(b.id));
        return out;
      })
      .catch(() => {
        cached = null;
        return new Set<number>();
      });
  }
  return cached;
}

export function forgetFactoryBranches(): void {
  cached = null;
}

export function useIsFactoryBranch(): boolean {
  const { user } = useAuth();
  const branchId = (user as any)?.branch_id ?? null;
  const [isFactory, setIsFactory] = useState(false);

  useEffect(() => {
    if (branchId == null) { setIsFactory(false); return undefined; }
    let alive = true;
    factoryBranchIds().then((ids) => { if (alive) setIsFactory(ids.has(Number(branchId))); });
    return () => { alive = false; };
  }, [branchId]);

  return isFactory;
}

export default useIsFactoryBranch;

export function useShowsFactoryTools(): boolean {
  const { user } = useAuth();
  const branchId = (user as any)?.branch_id ?? null;
  const isFactory = useIsFactoryBranch();
  return branchId == null || isFactory;
}
