import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useQueryTab(fallback: string, param = 'tab'): [string, (key: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get(param);
  const [active, setActive] = useState(fromUrl || fallback);

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

export function useSectionParam(): string | null {
  const [searchParams] = useSearchParams();
  const wanted = searchParams.get('section');

  useEffect(() => {
    if (!wanted) return;
    const id = requestAnimationFrame(() => {
      document.getElementById(`section-${wanted}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [wanted]);

  return wanted;
}
