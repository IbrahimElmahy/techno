import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { baseOf, useTabsOptional } from './TabsContext';
import { useOnScreen } from './keyboard';

export const RET_PARAM = 'ret';

const DOC_PARAMS = ['doc', 'edit', 'id', 'back', RET_PARAM];

export function readReturn(search: URLSearchParams | string | null | undefined): string | null {
  if (search == null) return null;
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const v = p.get(RET_PARAM);
  if (!v || !v.startsWith('/') || v.startsWith('//')) return null;
  return v;
}

export function withReturn(target: string, origin: string | null | undefined): string {
  if (!origin) return target;
  const ret = baseOf(origin) === baseOf(target)
    ? readReturn(origin.split('?')[1] ?? '')
    : origin;
  if (!ret) return target;
  const [path, qs = ''] = target.split('?');
  const p = new URLSearchParams(qs);
  p.set(RET_PARAM, ret);
  return `${path}?${p.toString()}`;
}

export function cleanDocPath(pathname: string, search: string | URLSearchParams): string {
  const p = new URLSearchParams(search);
  DOC_PARAMS.forEach((k) => p.delete(k));
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function useDocReturn() {
  const navigate = useNavigate();
  const loc = useLocation();
  const tabs = useTabsOptional();
  const onScreen = useOnScreen();
  const ref = useRef({ loc, tabs, onScreen });
  ref.current = { loc, tabs, onScreen };

  const origin = useCallback((): string | null => readReturn(ref.current.loc.search), []);

  const leave = useCallback((): boolean => {
    const { loc: l, tabs: t, onScreen: shown } = ref.current;
    const to = readReturn(l.search);
    if (!to || !shown) return false;
    t?.retireTab(l.pathname + l.search, cleanDocPath(l.pathname, l.search), to);
    navigate(to, { replace: true });
    return true;
  }, [navigate]);

  return useMemo(() => ({ origin, leave }), [origin, leave]);
}
