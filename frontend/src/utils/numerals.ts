import { useSyncExternalStore } from 'react';

export type Numerals = 'arabic' | 'latin';

export const NUMERALS_LABELS: Record<Numerals, string> = {
  arabic: 'عربي ٠١٢٣',
  latin: 'إنجليزي 0123',
};

const KEY_PREFIX = 'techno.numerals.';

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

let activeKey = keyFor(storedUsername());
let current: Numerals = read(activeKey);

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function getNumerals(): Numerals {
  return current;
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
