import { useEffect } from 'react';

/**
 * الإيد مابتسيبش الكيبورد وهي بتكتب سطور مستند.
 *
 * الحركة اللي العميل طلبها بالنص: تختار صنف → المؤشر يقع في خانة الكمية → تكتب →
 * Enter ينقلك للسطر اللي بعده → وآخر سطر Enter بيفتح شباك الأصناف لصنف جديد. يعني
 * مستند عشرين سطر يتكتب من غير ما الإيد تروح للماوس ولا مرة.
 *
 * كانت متكتبة في فاتورة البيع والشرا وشيت التسعير، وناقصة في المرتجع ومردود الشرا
 * وإذن التحويل وأذون المخازن والجرد — نفس الشاشات اللي بتتكتب فيها أطول المستندات.
 * فبقت هنا مرة واحدة: كل شاشة بتنده الاتنين دول وخلاص، واللي هيتكتب بكرة بياخدها معاه.
 *
 * ### إزاي تستعملها
 *
 * ```tsx
 * const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
 * useQtyFocus(focusLineKey, setFocusLineKey, pickerOpen, lines);
 * const advance = advanceFrom(lines, setFocusLineKey, () => setPickerOpen(true));
 * // وعلى كل خانة في السطر:
 * <InputNumber data-qty-key={line.key} onPressEnter={(e) => {
 *   e.preventDefault(); advance(line.key);
 * }} />
 * ```
 */

/**
 * بتحطّ المؤشر في خانة كمية السطر اللي `focusKey` بيشاور عليه.
 *
 * **بتحاول على فريمات مش مرة واحدة.** الخانة بتكون لسه ماترسمتش لما السطر يتضاف — وde
 * `focus()` على عنصر مش موجود بيروح في السكوت. فبتفضل تحاول لحد ٤٠ فريم (تلث ثانية
 * تقريباً) وبعدين بتسيب، عشان صف اتشال أو شاشة اتقفلت مايخلّوش اللوب شغال للأبد.
 *
 * ومابتشتغلش والشباك مفتوح: الشباك بياخد التركيز لخانة البحث بتاعته، والخطف منه بيمنع
 * الواحد يكتب اسم الصنف.
 */
export function useQtyFocus(
  focusKey: string | number | null,
  setFocusKey: (v: null) => void,
  pickerOpen: boolean,
  lines: unknown,
): void {
  useEffect(() => {
    if (focusKey === null || pickerOpen) return undefined;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-qty-key="${focusKey}"]`);
      if (el && document.activeElement === el) { setFocusKey(null); return; }
      el?.focus();
      el?.select();
      if (++frames < 40) raf = requestAnimationFrame(tryFocus);
      else setFocusKey(null);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
    // `lines` في التبعيات عن قصد: السطر الجديد بيترسم بعد التغيير ده، والمحاولة لازم
    // تبتدي من جديد بعده.
  }, [focusKey, pickerOpen, lines, setFocusKey]);
}

/**
 * «السطر ده خلص» — ينقل للسطر اللي بعده، وآخر سطر يفتح شباك الأصناف.
 *
 * بترجّع دالة بدل ما تتنده على طول عشان الشاشة تمسكها وتحطّها على كل خانة في السطر.
 */
export function advanceFrom<T extends { key: string | number }>(
  lines: T[],
  setFocusKey: (k: T['key']) => void,
  openPicker: () => void,
): (key: T['key']) => void {
  return (key) => {
    const idx = lines.findIndex((l) => l.key === key);
    const next = idx >= 0 ? lines[idx + 1] : undefined;
    if (next) { setFocusKey(next.key); return; }
    openPicker();
  };
}
