import React from 'react';
import { Alert, Button } from 'antd';
import { useSearchParams } from 'react-router-dom';

/**
 * «وَدّيني على الصفوف اللي فيها المشكلة» — فلتر جاي من رابط فحص النظام.
 *
 * الرئيسية بتقول «٤ فواتير بنودها من غير تكلفة» وبتدّيك زرار. الزرار كان بيوديك على
 * شاشة الفواتير — كل الـ٨٬٦١٣ — وتدوّر انت بنفسك على الأربعة. يعني الفحص عرف الإجابة
 * ومارماهاش، والشغل اللي هو عمله بيتعاد بالإيد.
 *
 * دلوقتي الرابط بيحمل الأرقام (`/invoices?ids=8604,8591,…`)، والشاشة بتفتح عليهم هم
 * بس. وبيفضل باين إن دي **نظرة مفلترة** مش الكشف كله — لأن جدول فيه ٤ صفوف من غير ما
 * حد يقول ليه أسوأ من جدول فيه ٨ آلاف.
 *
 * الاستعمال في أي شاشة كشف:
 *
 *     const focus = useFocusedIds();
 *     const shown = focus.filter(rows, (r) => r.id);
 *     …
 *     <FocusedRowsBanner focus={focus} total={rows.length} noun="فاتورة" />
 */

export interface FocusedIds {
  /** الأرقام اللي الرابط طلبها، أو `null` لو مافيش فلتر. */
  ids: Set<number> | null;
  /** بيرجّع الصفوف المطلوبة بس — أو الكل لو مافيش فلتر. */
  filter: <T,>(rows: T[], idOf: (row: T) => number | null | undefined) => T[];
  /** بيشيل الفلتر من الرابط من غير ما يسيب الشاشة. */
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
    // `replace` عشان زرار الرجوع مايرجّعش الفلتر اللي المستخدم لسه شايله.
    setParams(next, { replace: true });
  }, [params, setParams]);

  const filter = React.useCallback(
    <T,>(rows: T[], idOf: (row: T) => number | null | undefined): T[] => {
      if (!ids) return rows;
      return rows.filter((r) => {
        const v = idOf(r);
        return v != null && ids.has(Number(v));
      });
    },
    [ids],
  );

  return { ids, filter, clear };
}

export function FocusedRowsBanner({
  focus, total, noun = 'صف', shown,
}: {
  focus: FocusedIds;
  /** عدد الصفوف من غير فلتر — عشان «اعرض الكل» يقول على كام. */
  total: number;
  noun?: string;
  /** المعروض فعلاً؛ لو مااتقالش بيتاخد من عدد الأرقام. */
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
          ? 'مالقيتش الصفوف دي في الكشف — يمكن اتصلّحت أو اتشالت خلاص.'
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
