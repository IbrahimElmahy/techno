import { createContext, useContext, useEffect } from 'react';

export type Busy = { count: number };
export const PanelBusyContext = createContext<Busy | null>(null);

export function usePanelBusy(open: boolean) {
  const busy = useContext(PanelBusyContext);
  useEffect(() => {
    if (!busy || !open) return undefined;
    busy.count += 1;
    return () => { busy.count = Math.max(0, busy.count - 1); };
  }, [busy, open]);
}
