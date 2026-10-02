import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnScreen } from './keyboard';

/** رقم الخطوة الحالية في تاريخ المتصفح — الراوتر بيكتبه في `history.state.idx`. */
export function historyIdx(): number | null {
  const idx = (window.history.state as any)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/**
 * «رجوع» من مستند اتفتح من شاشة تانية (`?back=1`) بيرجّع **للشاشة دي بالظبط**.
 *
 * كان بيعمل `navigate(-1)` — خطوة واحدة. بس شاشة المستند ساعات بتزوّد خطوات في التاريخ
 * من غير ما تقصد (الفواتير كانت بتكتب `?doc=` تاني فوق نفسها، والتالي/السابق بيدفعوا
 * مستند جديد)، فالخطوة الواحدة كانت بتوقع على المستند نفسه أو على كشف الفواتير.
 * دلوقتي بنحفظ رقم الخطوة اللي جيت منها لحظة وصول الرابط، والرجوع بيقفز لها مهما زاد بعدها.
 *
 * **والقفز بيستنى العنوان النضيف يوصل للشاشة الأول.** الشاشة بتشيل `?doc=` بـ`replace`،
 * ولو قفزنا قبل ما ده يتعرض كان التبويب المخفي هيفضل شايل `?doc=` ويفتح المستند تاني
 * وهو ورا الستار. فـ`leave()` بيجهّز، والقفز بيحصل أول ما `hasDoc` يبقى `false`.
 *
 * الأصل بيتنسي لما الشاشة تستخبى (رجوع المتصفح، أو قسم تاني من القايمة) — ساعتها
 * «رجوع» بعدين بيرجع للكشف العادي. ولو الرابط اتفتح في تبويب متصفح جديد (أول خطوة)
 * مافيش أصل، والقفل بيبقى عادي بدل ما يخرج من النظام.
 */
export function useReturnToOrigin(hasDoc: boolean) {
  const navigate = useNavigate();
  const onScreen = useOnScreen();
  const origin = useRef<number | null>(null);
  const pending = useRef(false);
  const hasDocRef = useRef(hasDoc);
  hasDocRef.current = hasDoc;
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;

  const jump = useCallback(() => {
    pending.current = false;
    const o = origin.current;
    origin.current = null;
    const now = historyIdx();
    if (o == null || now == null || now <= o) return;
    navigate(o - now);
  }, [navigate]);

  useEffect(() => {
    if (!onScreen) { origin.current = null; pending.current = false; }
  }, [onScreen]);

  useEffect(() => {
    if (!hasDoc && pending.current) jump();
  }, [hasDoc, jump]);

  /** وصل رابط `back=1` — الخطوة اللي قبله هي الشاشة اللي فتحته. */
  const capture = useCallback(() => {
    // شاشة مخفية بتصحى على تحديث بياناتها والعنوان لسه فيه `back=1` قديم — مش رابط جديد.
    if (!onScreenRef.current) return;
    const now = historyIdx();
    origin.current = now != null && now > 0 ? now - 1 : null;
  }, []);

  /**
   * القفل بيرجّع للأصل؟ `true` = آه، والقفز هيحصل بعد ما العنوان يتنضّف (أو حالاً لو
   * نضيف أصلاً). `false` = مافيش أصل، والشاشة تقفل عادي.
   */
  const leave = useCallback((): boolean => {
    if (origin.current == null) return false;
    if (!hasDocRef.current) { jump(); return true; }
    pending.current = true;
    // احتياطي: لو العنوان مااتنضّفش لأي سبب، المستخدم داس «رجوع» ولازم يرجع.
    window.setTimeout(() => { if (pending.current) jump(); }, 1000);
    return true;
  }, [jump]);

  const hasOrigin = useCallback(() => origin.current != null, []);

  return { capture, leave, hasOrigin };
}
