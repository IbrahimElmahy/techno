import { useEffect, useRef } from 'react';
import { api, clearApiCache, getApiBaseURL, setLiveConnected } from '../api/client';
import { useOnScreen } from '../components/keyboard';

type Listener = (topic: string) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let wanted = false;
let retryTimer: number | undefined;
let failures = 0;
let downSince: number | null = null;

const ANY = '*';

export const STOCK_TOPICS = [
  'sales', 'purchases', 'transfers', 'stock', 'manufacturing', 'wastage', 'stock-counts',
];

function emit(topic: string) {
  clearApiCache();
  listeners.forEach((fn) => {
    try { fn(topic); } catch {}
  });
}

let connecting = false;

function retryLater() {
  if (downSince === null) downSince = Date.now();
  if (!wanted) return;
  failures += 1;
  const delay = Math.min(60000, 1000 * 2 ** Math.min(failures - 1, 6)) + Math.random() * 1000;
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(connect, delay);
}

async function connect() {
  if (!wanted || source || connecting || typeof EventSource === 'undefined') return;
  if (!localStorage.getItem('token')) return;
  connecting = true;
  let ticket: string | undefined;
  try {
    const res = await api.post('/api/v1/live/ticket');
    ticket = res.data?.ticket;
  } catch {
    ticket = undefined;
  } finally {
    connecting = false;
  }
  if (!wanted || source) return;
  if (!ticket) { retryLater(); return; }
  const url = `${getApiBaseURL()}/api/v1/live/events?ticket=${encodeURIComponent(ticket)}`;
  const es = new EventSource(url);
  source = es;

  es.onopen = () => {
    failures = 0;
    setLiveConnected(true);
    if (downSince !== null && Date.now() - downSince > 5000) emit(ANY);
    downSince = null;
  };

  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      if (ev && typeof ev.topic === 'string') emit(ev.topic);
    } catch {}
  };

  es.onerror = () => {
    setLiveConnected(false);
    es.close();
    if (source === es) source = null;
    retryLater();
  };
}

export function startLive() {
  wanted = true;
  connect();
}

export function stopLive() {
  wanted = false;
  setLiveConnected(false);
  window.clearTimeout(retryTimer);
  source?.close();
  source = null;
  downSince = null;
  failures = 0;
}

export function onLiveEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useLiveRefresh(
  topics: string[],
  refresh: () => void,
  opts: { enabled?: boolean } = {},
) {
  const onScreen = useOnScreen();
  const enabled = opts.enabled ?? true;

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const shownRef = useRef(onScreen && enabled);
  shownRef.current = onScreen && enabled;

  const pending = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const firstAt = useRef<number | null>(null);

  const fireRef = useRef(() => {});
  fireRef.current = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    firstAt.current = null;
    if (document.hidden || !shownRef.current) {
      pending.current = true;
      return;
    }
    pending.current = false;
    try { refreshRef.current(); } catch {}
  };

  const topicsKey = topics.join('|');
  useEffect(() => {
    const wantedTopics = new Set(topicsKey.split('|'));
    const off = onLiveEvent((topic) => {
      if (topic !== ANY && !wantedTopics.has(topic)) return;
      const now = Date.now();
      if (firstAt.current === null) firstAt.current = now;
      window.clearTimeout(timer.current);
      const wait = Math.max(0, Math.min(800, firstAt.current + 3000 - now));
      timer.current = window.setTimeout(() => fireRef.current(), wait);
    });
    return () => {
      off();
      window.clearTimeout(timer.current);
    };
  }, [topicsKey]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && pending.current) fireRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    if (onScreen && enabled && pending.current) fireRef.current();
  }, [onScreen, enabled]);
}
