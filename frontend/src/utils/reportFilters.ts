import { useEffect } from 'react';
import type { CategoryTree } from '../hooks/useCategoryTree';

export const MULTI = { mode: 'multiple' as const, allowClear: true, maxTagCount: 'responsive' as const };

export function picked(f: Record<string, any>, key: string): any[] {
  const v = f[key];
  if (Array.isArray(v)) return v;
  return v === undefined || v === null || v === '' ? [] : [v];
}

export function filterParams(f: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  Object.entries(f).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.join(',');
    } else if (v !== undefined && v !== null && v !== '') {
      out[k] = v;
    }
  });
  return out;
}

export function categorySet(tree: CategoryTree, cats: string[]): Set<string> {
  const out = new Set<string>();
  const add = (c: string) => {
    if (out.has(c)) return;
    out.add(c);
    (tree.childrenOf[c] || []).forEach(add);
  };
  cats.forEach(add);
  return out;
}

export function territorySet(territories: { id: number; parent_id?: number | null }[], ids: number[]): Set<number> {
  const out = new Set<number>(ids);
  let grew = true;
  while (grew) {
    grew = false;
    territories.forEach((t) => {
      if (t.parent_id != null && out.has(t.parent_id) && !out.has(t.id)) { out.add(t.id); grew = true; }
    });
  }
  return out;
}

export function usePrune(
  f: Record<string, any>,
  setF: (fn: (prev: Record<string, any>) => Record<string, any>) => void,
  key: string,
  allowed: { id: any }[] | null,
) {
  const sig = allowed ? `${allowed.length}:${allowed[0]?.id}:${allowed[allowed.length - 1]?.id}` : '-';
  useEffect(() => {
    if (!allowed) return;
    const cur = picked(f, key);
    if (!cur.length) return;
    const ok = new Set(allowed.map((x) => x.id));
    const kept = cur.filter((v) => ok.has(v));
    if (kept.length !== cur.length) setF((prev) => ({ ...prev, [key]: kept }));
  }, [sig, JSON.stringify(picked(f, key))]);
}
