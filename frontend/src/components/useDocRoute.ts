import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDocReturn } from './docReturn';
import { useOnScreen } from './keyboard';

export type DocMode = 'view' | 'edit';

export function useDocRoute<T extends { id: number }>(opts: {
  rows: T[];
  openId: number | null;
  open: (row: T, mode: DocMode) => void;
  close: () => void;
  fetchOne: (id: number) => Promise<T | null>;
  loading?: boolean;
  enabled?: boolean;
}) {
  const { rows, openId, open, close, fetchOne, loading, enabled = true } = opts;
  const [params, setParams] = useSearchParams();
  const editRaw = params.get('edit');
  const raw = params.get('doc') || editRaw;
  const wanted = raw ? Number(raw) : null;
  const mode: DocMode = editRaw ? 'edit' : 'view';
  const docReturn = useDocReturn();
  const onScreen = useOnScreen();
  const writable = enabled && onScreen;

  const ref = useRef({ open, close, fetchOne, rows });
  ref.current = { open, close, fetchOne, rows };

  const handled = useRef<number | null>(null);

  const pendingOpen = useRef<number | null>(null);
  const pendingClose = useRef(false);
  const [missing, setMissing] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (wanted === openId) {
      handled.current = wanted;
      pendingOpen.current = null;
      pendingClose.current = false;
      return;
    }
    if (pendingOpen.current != null && wanted !== pendingOpen.current) return;
    if (pendingClose.current && wanted != null) return;
    if (wanted == null) {
      handled.current = null;
      ref.current.close();
      return;
    }
    if (handled.current === wanted) return;
    handled.current = wanted;
    const inPage = ref.current.rows.find((r) => r.id === wanted);
    if (inPage) { ref.current.open(inPage, mode); return; }
    const id = wanted;
    ref.current.fetchOne(id)
      .then((r) => { if (r) ref.current.open(r, mode); else setMissing(id); })
      .catch(() => setMissing(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, mode, openId, rows.length, enabled]);
  void loading;

  const markOpen = useCallback((id: number, m: DocMode = 'view') => {
    if (!enabled) return;
    handled.current = id;
    pendingClose.current = false;
    if (!writable) return;
    const key = m === 'edit' ? 'edit' : 'doc';
    const other = key === 'doc' ? 'edit' : 'doc';
    if (params.get(key) === String(id) && !params.get(other)) return;
    pendingOpen.current = id;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('doc');
      next.delete('edit');
      next.set(m === 'edit' ? 'edit' : 'doc', String(id));
      return next;
    });
  }, [params, setParams, enabled, writable]);

  const markClosed = useCallback((opts?: { stay?: boolean }) => {
    if (!enabled) return;
    handled.current = null;
    pendingOpen.current = null;
    if (!writable) return;
    if (!params.get('doc') && !params.get('edit')) return;
    if (opts?.stay !== true && docReturn.leave()) return;
    pendingClose.current = true;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('doc');
      next.delete('edit');
      next.delete('back');
      next.delete('ret');
      return next;
    }, { replace: true });
  }, [params, setParams, enabled, writable, docReturn]);

  const opening = enabled && wanted != null && wanted !== openId
    && !pendingClose.current && missing !== wanted;

  return { markOpen, markClosed, opening };
}
