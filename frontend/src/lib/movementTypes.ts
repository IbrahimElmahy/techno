import { useEffect, useState } from 'react';

import { api } from '../api/client';

export type MovementType = { value: string; label: string };

let cache: MovementType[] | null = null;
let inFlight: Promise<MovementType[]> | null = null;

export function loadMovementTypes(): Promise<MovementType[]> {
  if (cache) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = api
      .get<MovementType[]>('/stock/movement-types')
      .then((r) => {
        cache = Array.isArray(r.data) ? r.data : [];
        return cache;
      })
      .catch(() => {
        inFlight = null;
        return [];
      });
  }
  return inFlight;
}

export function useMovementLabels(): Record<string, string> {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    loadMovementTypes().then((list) => {
      if (!alive) return;
      setLabels(Array.isArray(list)
        ? Object.fromEntries(list.map((t) => [t.value, t.label])) : {});
    });
    return () => {
      alive = false;
    };
  }, []);
  return labels;
}

export function useMovementTypes(): MovementType[] {
  const [types, setTypes] = useState<MovementType[]>(
    Array.isArray(cache) ? cache : []);
  useEffect(() => {
    let alive = true;
    loadMovementTypes().then((list) => {
      if (alive) setTypes(Array.isArray(list) ? list : []);
    });
    return () => {
      alive = false;
    };
  }, []);
  return types;
}
