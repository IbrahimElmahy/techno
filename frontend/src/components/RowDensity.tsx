import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Segmented, Tooltip } from 'antd';
import { ColumnHeightOutlined } from '@ant-design/icons';

export type Density = 'compact' | 'normal' | 'comfortable';

const STORAGE_KEY = 'techno.row-density';

export const DENSITY_LABELS: Record<Density, string> = {
  compact: 'مضغوط',
  normal: 'عادي',
  comfortable: 'مريح',
};

function stored(): Density {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'compact' || v === 'normal' || v === 'comfortable') return v;
  } catch {}
  return 'normal';
}

interface Ctx { density: Density; setDensity: (d: Density) => void; }

const DensityContext = createContext<Ctx>({ density: 'normal', setDensity: () => {} });

export function useDensity() { return useContext(DensityContext); }

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensity] = useState<Density>(stored);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
    try { localStorage.setItem(STORAGE_KEY, density); } catch {}
  }, [density]);

  const value = useMemo(() => ({ density, setDensity }), [density]);
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export default function RowDensityControl() {
  const { density, setDensity } = useDensity();
  return (
    <Tooltip title="ارتفاع صفوف الجداول — في النظام كله">
      <Segmented
        size="small"
        value={density}
        onChange={(v) => setDensity(v as Density)}
        options={[
          { value: 'compact', label: DENSITY_LABELS.compact },
          { value: 'normal', label: DENSITY_LABELS.normal },
          { value: 'comfortable', label: DENSITY_LABELS.comfortable },
        ]}
        {...{ 'aria-label': 'ارتفاع الصف' }}
      />
    </Tooltip>
  );
}

export { ColumnHeightOutlined };
