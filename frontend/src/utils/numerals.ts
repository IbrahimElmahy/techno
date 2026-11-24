import { useSyncExternalStore } from 'react';

export type Numerals = 'arabic' | 'latin';

export const NUMERALS_LABELS: Record<Numerals, string> = {
  arabic: 'عربي ٠١٢٣',
  latin: 'إنجليزي 0123',
};

const KEY_PREFIX = 'techno.numerals.';
const GROUPING_PREFIX = 'techno.grouping.';
const ROUNDING_PREFIX = 'techno.rounding.';

export type Rounding = '2' | '1' | '0' | '10' | '100';

export const ROUNDING_ORDER: Rounding[] = ['2', '1', '0', '10', '100'];

export const ROUNDING_LABELS: Record<Rounding, string> = {
  '2': '٠٫٠٠',
  '1': '٠٫٠',
  '0': '١',
  '10': '١٠',
  '100': '١٠٠',
};

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

function userKey(username: string | null | undefined): string {
  return username && username.trim() ? username.trim() : 'default';
}

function readRounding(username: string | null | undefined): Rounding {
  try {
    const v = localStorage.getItem(ROUNDING_PREFIX + userKey(username));
    if (v && v in ROUNDING_LABELS) return v as Rounding;
  } catch {}
  return '2';
}

let activeKey = keyFor(storedUsername());
let current: Numerals = read(activeKey);
let activeUser: string | null = storedUsername();
let grouping = readGrouping(activeUser);
let rounding = readRounding(activeUser);

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

export function getRounding(): Rounding {
  return rounding;
}

export function setRounding(next: Rounding): void {
  if (next === rounding) return;
  rounding = next;
  try { localStorage.setItem(ROUNDING_PREFIX + userKey(activeUser), next); } catch {}
  emit();
}

export function useRounding(): Rounding {
  return useSyncExternalStore(subscribe, getRounding, getRounding);
}

export function roundAmount(v: unknown): { value: number; digits: number } {
  const n = Number(v || 0);
  if (rounding === '10' || rounding === '100') {
    const step = Number(rounding);
    return { value: Math.round(n / step) * step, digits: 0 };
  }
  const digits = Number(rounding);
  const f = 10 ** digits;
  return { value: Math.round(n * f) / f, digits };
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
  rounding = readRounding(activeUser);
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
