import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Drives a tabbed screen's active tab from the URL.
 *
 * The menu was rebuilt to mirror the system the client is migrating from, where a screen we
 * implement as one tabbed page — the chart of accounts, the organisation, manufacturing — is several
 * separate entries. «الحسابات الرئيسيه» and «مراكز التكلفة» are two menu items there and two tabs of
 * one screen here.
 *
 * Rather than split those screens into copies that would then drift apart, each menu entry carries
 * the tab it means (`/general-ledger?tab=cc`) and this hook opens it. One implementation, several
 * doors — which is what the situation actually is.
 *
 * The tab stays user-controllable after arrival: clicking another tab moves the URL with it, so the
 * open tab is what gets restored when the workspace reopens that tab later, and a copied link opens
 * on what the sender was looking at.
 */
export function useQueryTab(fallback: string, param = 'tab'): [string, (key: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get(param);
  const [active, setActive] = useState(fromUrl || fallback);

  // A later navigation to the same screen with a different tab has to move the tab, not be ignored.
  useEffect(() => {
    if (fromUrl && fromUrl !== active) setActive(fromUrl);
  }, [fromUrl]);

  const select = (key: string) => {
    setActive(key);
    const next = new URLSearchParams(searchParams);
    next.set(param, key);
    setSearchParams(next, { replace: true });
  };

  return [active, select];
}
