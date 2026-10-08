import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface CategoryTree {
  labels: Record<string, string>;
  parentOf: Record<string, string>;
  childrenOf: Record<string, string[]>;
  roots: string[];
  hasTree: boolean;
}

export const EMPTY_TREE: CategoryTree = {
  labels: {}, parentOf: {}, childrenOf: {}, roots: [], hasTree: false,
};

export function rootOf(tree: CategoryTree, value: string | null | undefined): string | null {
  if (!value) return null;
  return tree.parentOf[value] || value;
}

export function withChildren(tree: CategoryTree, value: string): string[] {
  return [value, ...(tree.childrenOf[value] || [])];
}

function build(rows: any[]): CategoryTree {
  const labels: Record<string, string> = {};
  const parentOf: Record<string, string> = {};
  const childrenOf: Record<string, string[]> = {};
  const roots: string[] = [];
  rows.forEach((r) => { labels[r.value] = r.label; });
  rows.forEach((r) => {
    const parent = r.parent_value && labels[r.parent_value] ? r.parent_value : null;
    if (parent) {
      parentOf[r.value] = parent;
      (childrenOf[parent] = childrenOf[parent] || []).push(r.value);
    } else {
      roots.push(r.value);
    }
  });
  return { labels, parentOf, childrenOf, roots, hasTree: Object.keys(parentOf).length > 0 };
}

export interface CategoryOption { value: string; label: string }
export type CategorySelectOption =
  | CategoryOption
  | { label: string; title: string; options: CategoryOption[] };

export function categorySelectOptions(
  tree: CategoryTree, options: CategoryOption[],
): CategorySelectOption[] {
  if (!tree.hasTree) return options;
  const byValue = new Map(options.map((o) => [o.value, o]));
  const out: CategorySelectOption[] = [];
  const done = new Set<string>();
  options.forEach((o) => {
    const parent = tree.parentOf[o.value];
    if (parent && byValue.has(parent)) return;
    if (done.has(o.value)) return;
    done.add(o.value);
    const kids = (tree.childrenOf[o.value] || [])
      .map((v) => byValue.get(v))
      .filter(Boolean) as CategoryOption[];
    if (!kids.length) { out.push(o); return; }
    kids.forEach((k) => done.add(k.value));
    out.push({ label: o.label, title: o.label, options: [o, ...kids] });
  });
  return out;
}

let cached: Promise<CategoryTree> | null = null;

function load(): Promise<CategoryTree> {
  if (!cached) {
    cached = api
      .get('/api/v1/settings/lookups', { params: { category: 'item_category' } })
      .then((res) => build(res.data || []))
      .catch(() => {
        cached = null;
        return EMPTY_TREE;
      });
  }
  return cached;
}

export function invalidateCategoryTree(): void {
  cached = null;
}

export function useCategoryTree(): { tree: CategoryTree; loading: boolean } {
  const [tree, setTree] = useState<CategoryTree>(EMPTY_TREE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    load().then((t) => {
      if (cancelled) return;
      setTree(t);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { tree, loading };
}
