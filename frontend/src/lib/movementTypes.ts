/**
 * أسماء أنواع حركة المخزون بالعربي — **نسخة واحدة، جاية من الخادم**.
 *
 * كانت القايمة متكتوبة بالإيد في تلات ملفات: `ItemCard.tsx` و`ItemProfile.tsx`
 * و`MovementHistoryLog.tsx`. وتلات نسخ معناها تلات نسخ مختلفة:
 *
 * * `MovementHistoryLog` فيها `manufacture_in` و`wastage_out` و`count_adjust` —
 *   تلات أسماء **مش موجودة في القاعدة أصلاً**، واتكتبت من الذاكرة.
 * * `ItemProfile` ناقصة `sale` و`purchase` و`opening` — يعني ٤٥ ألف حركة بيع
 *   منقولة من a5 كانت بتتعرض بالاسم الإنجليزي الخام.
 * * `ItemCard` ناقصة `permit` — ٣٦٣ حركة إذن مخزن بتتعرض «permit».
 *
 * دلوقت المصدر واحد: `GET /stock/movement-types` بيقراها من `src/lib/stock_docs.py`،
 * وهو نفسه اللي `post_movement` بيتحقق منه قبل ما يكتب. نوع جديد بيتسجّل هناك مرة
 * واحدة وبيظهر في الشاشات كلها من غير ما حد يفتكر يحدّث ثلات ملفات.
 *
 * والجلب **مرة واحدة للجلسة** ومخزّن في وعد مشترك: عشرة مكوّنات بتنده في نفس اللحظة
 * بتستنى نفس الطلب، مش عشر طلبات. والفشل بيرجّع الاسم الخام — شاشة باسم إنجليزي أحسن
 * من شاشة فاضية.
 */
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
        // **لازم تبقى مصفوفة.** `r.data` مش دايماً اللي متوقّعينه: الطلب اللي بيرجع
        // صفحة `index.html` (بروكسي بيردّ HTML على مسار مش موجود) أو جسم خطأ
        // بيدّي كائن — و`|| []` بتعدّيه لأنه «مش فاضي»، فأول `.map` بترمي
        // «a.map is not a function» **وتفضّي الشاشة كلها**. اتشافت على الإنتاج.
        cache = Array.isArray(r.data) ? r.data : [];
        return cache;
      })
      .catch(() => {
        // مانخزّنش الفشل: طلب تاني بعدين ممكن ينجح.
        inFlight = null;
        return [];
      });
  }
  return inFlight;
}

/** `{ sale: 'بيع', ... }` — للعرض في عمود أو تصدير. */
export function useMovementLabels(): Record<string, string> {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    loadMovementTypes().then((list) => {
      if (!alive) return;
      // حزام أمان تاني: اللي بينده مايقعش لو حاجة غريبة عدّت.
      setLabels(Array.isArray(list)
        ? Object.fromEntries(list.map((t) => [t.value, t.label])) : {});
    });
    return () => {
      alive = false;
    };
  }, []);
  return labels;
}

/** القايمة كاملة — لفلتر «كل أنواع الحركة». */
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
