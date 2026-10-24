import { api } from '../api/client';

export const PREFS_EVENT = 'techno:prefs-synced';

const SYNCED = (key: string) => key.startsWith('cols:') || key === 'techno.col-widths';

const timers = new Map<string, number>();

export function pushPref(key: string, value: string): void {
  if (!SYNCED(key)) return;
  const old = timers.get(key);
  if (old) window.clearTimeout(old);
  timers.set(key, window.setTimeout(() => {
    timers.delete(key);
    api.put('/api/v1/auth/prefs', { key, value }).catch(() => {});
  }, 800));
}

function localKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && SYNCED(k)) out.push(k);
    }
  } catch {}
  return out;
}

export async function syncPrefs(): Promise<void> {
  let server: Record<string, string>;
  try {
    server = (await api.get('/api/v1/auth/prefs')).data || {};
  } catch {
    return;
  }
  const keys = Object.keys(server).filter(SYNCED);
  if (!keys.length) {
    for (const k of localKeys()) {
      try {
        const v = localStorage.getItem(k);
        if (v !== null) await api.put('/api/v1/auth/prefs', { key: k, value: v });
      } catch {}
    }
    return;
  }
  try {
    for (const k of localKeys()) if (!(k in server)) localStorage.removeItem(k);
    for (const k of keys) localStorage.setItem(k, server[k]);
  } catch {}
  window.dispatchEvent(new Event(PREFS_EVENT));
}
