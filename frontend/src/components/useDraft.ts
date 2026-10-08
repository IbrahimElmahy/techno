import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

export interface DraftRow<P = any> {
  id: number;
  kind: string;
  title: string | null;
  payload: P;
  updated_at: string;
}

export function useDraft<P>(opts: {
  kind: string;
  payload: P;
  isEmpty: (p: P) => boolean;
  title: (p: P) => string;
  paused?: boolean;
  delay?: number;
}) {
  const { kind, payload, isEmpty, title, paused = false, delay = 1500 } = opts;
  const [drafts, setDrafts] = useState<DraftRow<P>[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const idRef = useRef<number | null>(null);
  const lastRef = useRef<string>('');
  const baseRef = useRef<string | null>(null);
  const wasPaused = useRef<boolean>(paused);
  const fns = useRef({ isEmpty, title });
  fns.current = { isEmpty, title };

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/api/v1/drafts', { params: { kind } });
      setDrafts(res.data || []);
    } catch {}
  }, [kind]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const raw = JSON.stringify(payload ?? null);
    if (wasPaused.current && !paused) baseRef.current = raw;
    wasPaused.current = paused;
    if (paused) return undefined;
    if (baseRef.current === null) { baseRef.current = raw; return undefined; }
    if (raw === baseRef.current) return undefined;
    if (raw === lastRef.current) return undefined;
    if (fns.current.isEmpty(payload)) return undefined;
    const t = setTimeout(async () => {
      try {
        const res = await api.post('/api/v1/drafts',
          { kind, title: fns.current.title(payload), payload },
          { params: idRef.current ? { draft_id: idRef.current } : {} });
        idRef.current = res.data?.id ?? idRef.current;
        lastRef.current = raw;
        setSavedAt(new Date().toISOString());
        refresh();
      } catch {}
    }, delay);
    return () => clearTimeout(t);
  }, [payload, paused, kind, delay, refresh]);

  const discard = useCallback(async () => {
    const id = idRef.current;
    idRef.current = null;
    lastRef.current = '';
    baseRef.current = null;
    setSavedAt(null);
    if (id == null) return;
    try { await api.delete(`/api/v1/drafts/${id}`); } catch {}
    refresh();
  }, [refresh]);

  const remove = useCallback(async (id: number) => {
    try {
      await api.delete(`/api/v1/drafts/${id}`);
    } finally {
      if (idRef.current === id) {
        idRef.current = null;
        lastRef.current = '';
        baseRef.current = null;
      }
      refresh();
    }
  }, [refresh]);

  const adopt = useCallback((id: number | null) => {
    idRef.current = id;
    lastRef.current = '';
    baseRef.current = null;
  }, []);

  const rebase = useCallback(() => { baseRef.current = null; }, []);

  return { drafts, savedAt, discard, remove, adopt, rebase, refresh };
}
