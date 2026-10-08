import React from 'react';
import { Alert, Button } from 'antd';
import { useSearchParams } from 'react-router-dom';

export interface FocusedIds {
  ids: Set<number> | null;
  filter: <T,>(rows: T[], idOf: (row: T) => number | null | undefined) => T[];
  clear: () => void;
}

export function useFocusedIds(): FocusedIds {
  const [params, setParams] = useSearchParams();
  const raw = params.get('ids');

  const ids = React.useMemo(() => {
    if (!raw) return null;
    const out = new Set<number>();
    for (const part of raw.split(',')) {
      const n = Number(part.trim());
      if (Number.isFinite(n)) out.add(n);
    }
    return out.size ? out : null;
  }, [raw]);

  const clear = React.useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('ids');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const filter = React.useCallback(
    <T,>(rows: T[], idOf: (row: T) => number | null | undefined): T[] => {
      if (!ids) return rows;
      const hit = rows.filter((r) => {
        const v = idOf(r);
        return v != null && ids.has(Number(v));
      });
      return hit.length ? hit : rows;
    },
    [ids],
  );

  return { ids, filter, clear };
}

export function FocusedRowsBanner({
  focus, total, noun = 'صف', shown,
}: {
  focus: FocusedIds;
  total: number;
  noun?: string;
  shown?: number;
}) {
  if (!focus.ids) return null;
  const n = shown ?? focus.ids.size;
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      message={`بتشوف ${n} ${noun} جايين من فحص النظام في الرئيسية`}
      description={
        n === 0
          ? 'مالقيتش الصفوف دي في الكشف — يمكن اتصلّحت أو اتشالت، أو إنها في فرع تاني'
            + '. الكشف كله معروض تحت.'
          : 'الكشف كله مخفي دلوقتي عشان تشوف اللي فيه المشكلة وبس.'
      }
      action={
        <Button size="small" onClick={focus.clear}>
          اعرض الكل ({total})
        </Button>
      }
    />
  );
}
