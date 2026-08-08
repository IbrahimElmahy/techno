import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Segmented, Tooltip } from 'antd';
import { ColumnHeightOutlined } from '@ant-design/icons';

/**
 * ارتفاع الصف — زي الإكسل، وفي النظام كله.
 *
 * Somebody reading a count sheet of four hundred lines wants them tight enough to see a screenful.
 * Somebody typing counts into the same sheet wants them loose enough to hit the right box. Those
 * are two different people at the same table, and the only honest answer is to let each of them
 * decide — which is exactly what the row-height drag in Excel is for.
 *
 * **One switch, every table.** There are 173 tables in this system. A prop threaded through them
 * would be 173 edits, 173 chances to miss one, and a new screen next month that quietly does not
 * obey. So the choice is stamped on the root element and the styling is done in CSS: every table
 * that exists now, every table inside a modal, and every table nobody has written yet all follow
 * without knowing this file exists.
 *
 * It overrides antd's own `size` on purpose. A screen saying `size="small"` was expressing what its
 * author thought was right for it; once the person using it has said what THEY want, that is the
 * one that counts — and a system where the row height depends on which screen you happen to be on
 * is not a preference, it is an inconsistency.
 *
 * Kept in `localStorage`, so it is set once and not re-chosen every morning.
 */

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
  } catch { /* private mode — fall through to the default */ }
  return 'normal';
}

interface Ctx { density: Density; setDensity: (d: Density) => void; }

const DensityContext = createContext<Ctx>({ density: 'normal', setDensity: () => {} });

export function useDensity() { return useContext(DensityContext); }

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensity] = useState<Density>(stored);

  // The whole mechanism: one attribute on <html>, and the CSS does the rest.
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
    try { localStorage.setItem(STORAGE_KEY, density); } catch { /* not worth failing over */ }
  }, [density]);

  const value = useMemo(() => ({ density, setDensity }), [density]);
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

/** The control itself — small enough to live in the header beside the user's name. */
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
        // The icon carries the meaning for anyone who has met the same control in a spreadsheet.
        {...{ 'aria-label': 'ارتفاع الصف' }}
      />
    </Tooltip>
  );
}

export { ColumnHeightOutlined };
