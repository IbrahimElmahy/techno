import { useSyncExternalStore } from 'react';

export type Numerals = 'arabic' | 'latin';

export const NUMERALS_LABELS: Record<Numerals, string> = {
  arabic: 'عربي ٠١٢٣',
  latin: 'إنجليزي 0123',
};

const KEY_PREFIX = 'techno.numerals.';
const GROUPING_PREFIX = 'techno.grouping.';

const LOCALES: Record<Numerals, string> = { arabic: 'ar-EG', latin: 'en-EG' };

function keyFor(username: string | null | undefined): string {
  return KEY_PREFIX + (username && username.trim() ? username.trim() : 'default');
}

function storedUsername(): string | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return (JSON.parse(raw) as { username?: string }).username ?? null;
  } catch {
    return null;
  }
}

function read(key: string): Numerals {
  try {
    const v = localStorage.getItem(key);
    if (v === 'arabic' || v === 'latin') return v;
  } catch {}
  return 'arabic';
}

function readGrouping(username: string | null | undefined): boolean {
  try {
    return localStorage.getItem(GROUPING_PREFIX + (username && username.trim() ? username.trim() : 'default')) === '1';
  } catch {
    return false;
  }
}

let activeKey = keyFor(storedUsername());
let current: Numerals = read(activeKey);
let activeUser: string | null = storedUsername();
let grouping = readGrouping(activeUser);

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function getNumerals(): Numerals {
  return current;
}

export function getGrouping(): boolean {
  return grouping;
}

export function setGrouping(next: boolean): void {
  if (next === grouping) return;
  grouping = next;
  try {
    localStorage.setItem(GROUPING_PREFIX + (activeUser && activeUser.trim() ? activeUser.trim() : 'default'),
      next ? '1' : '0');
  } catch {}
  emit();
}

export function useGrouping(): boolean {
  return useSyncExternalStore(subscribe, getGrouping, getGrouping);
}

export function numeralsLocale(): string {
  return LOCALES[current];
}

export function setNumerals(next: Numerals): void {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(activeKey, next); } catch {}
  emit();
}

export function bindNumeralsUser(username: string | null | undefined): void {
  const key = keyFor(username);
  if (key === activeKey) return;
  activeKey = key;
  activeUser = username ?? null;
  grouping = readGrouping(activeUser);
  const next = read(key);
  if (next !== current) {
    current = next;
    emit();
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useNumerals(): Numerals {
  return useSyncExternalStore(subscribe, getNumerals, getNumerals);
}
