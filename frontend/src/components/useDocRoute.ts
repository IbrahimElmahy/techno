import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/** ورقة للقراءة، ولا نموذج للتعديل. */
export type DocMode = 'view' | 'edit';

/**
 * المستند المفتوح بيبقى جزء من العنوان — **عشان «رجوع» يبقى ليه معنى جوّه الشاشة**.
 *
 * ---------------------------------------------------------------------------
 * **المشكلة اللي بيحلها.** فتح مستند في النظام ماكانش صفحة: تفتح فاتورة من الكشف
 * فالعنوان مايتغيّرش، لأن الفاتورة بتتفتح كحالة جوّه نفس الشاشة. يعني تاريخ المتصفح فيه
 * **الأقسام اللي اتفتحت وبس**. فاللي دخل «الفواتير» وفتح فيها عشر فواتير، الـ«رجوع»
 * مالوش عشر خطوات يرجّعهم — عنده خطوة واحدة، القسم اللي كان قبل الفواتير. والنتيجة إن
 * «رجوع» بيبان كأنه بيقفز للرئيسية.
 *
 * دلوقتي فتح المستند بيدفع `?doc=12` على العنوان، فالـ«رجوع» بيقفله ويرجّعك للكشف.
 *
 * **الفتح بيدفع والقفل بيستبدل.** لو القفل دفع كمان، كل فتح وقفل كان هيسيب وراه خطوتين
 * في التاريخ، والـ«رجوع» بعدها يعيد فتح اللي انت قافله لسه. الاستبدال بيشيل خطوة الفتح
 * مكانها فالتاريخ بيرجع لـ«الكشف» زي ما كان.
 *
 * **والعنوان هو الحقيقة، مش الحالة.** المزامنة بتمشي في اتجاه واحد: العنوان بيتغيّر
 * (بضغطة المستخدم أو بزرار الرجوع) والشاشة بتتبعه. من غير كده الاتنين بيفرقوا وأول
 * «رجوع» بيسيب العنوان على كشف والشاشة على مستند مفتوح.
 *
 * **الروابط القديمة شغّالة زي ما هي.** `?doc=` (عرض) و`?edit=` (فتح للتعديل) بييجوا من
 * كارت الصنف وكشف الحساب، وهما نفس البارامترات اللي الشاشة بتكتبها دلوقتي — فالرابط
 * الجاي من بره بيفتح المستند، والفرق الوحيد إنه مابيتمسحش من العنوان بعد الفتح.
 *
 * **والوضع جزء من العنوان كمان.** شاشة الفواتير بتفتح المستند بشكلين — ورقة للقراءة أو
 * نموذج للتعديل — والاتنين مش نفس الحاجة للي بيرجع. فالعرض بيكتب `?doc=` والتعديل
 * بيكتب `?edit=`، والرجوع بيرجّع للي كان مفتوح فعلاً.
 */
export function useDocRoute<T extends { id: number }>(opts: {
  /** الصفحة المحمّلة من الكشف — بيتدوّر فيها الأول قبل ما يتجاب بالرقم. */
  rows: T[];
  /** رقم المستند المفتوح دلوقتي على الشاشة. `null` = مافيش. */
  openId: number | null;
  /** بيفتح المستند على الشاشة — دالة الشاشة نفسها. الشاشة اللي عندها وضع واحد بتتجاهل
   *  البارامتر التاني. */
  open: (row: T, mode: DocMode) => void;
  /** بيقفل اللي مفتوح ويرجّع الشاشة للكشف. */
  close: () => void;
  /** بيجيب مستند مش في الصفحة المحمّلة. `null` = مش موجود. */
  fetchOne: (id: number) => Promise<T | null>;
  /** لسه بيحمّل الكشف — الفتح بيستنى، عشان مايجيبش بالرقم وهو جاي في الصفحة. */
  loading?: boolean;
}) {
  const { rows, openId, open, close, fetchOne, loading } = opts;
  const [params, setParams] = useSearchParams();
  const editRaw = params.get('edit');
  const raw = params.get('doc') || editRaw;
  const wanted = raw ? Number(raw) : null;
  const mode: DocMode = editRaw ? 'edit' : 'view';

  // أحدث نسخة من الدوال من غير ما تبقى اعتماد — وإلا المزامنة بتشتغل مع كل رندر.
  const ref = useRef({ open, close, fetchOne, rows });
  ref.current = { open, close, fetchOne, rows };

  // الرقم اللي اتعامل معاه خلاص — بيمنع إعادة الجلب لنفس المستند مع كل رندر.
  const handled = useRef<number | null>(null);

  useEffect(() => {
    if (wanted === openId) { handled.current = wanted; return; }
    if (wanted == null) {
      // العنوان مابقاش فيه مستند (رجوع، أو قفل من شاشة تانية) ⇒ اقفل.
      handled.current = null;
      ref.current.close();
      return;
    }
    if (handled.current === wanted || loading) return;
    handled.current = wanted;
    const inPage = ref.current.rows.find((r) => r.id === wanted);
    if (inPage) { ref.current.open(inPage, mode); return; }
    // **مش في الصفحة المحمّلة ≠ مش موجود.** الكشف بيتحمّل بصفحات، والرابط الجاي من
    // كارت الصنف ممكن يبقى لمستند قديم برّه الصفحة.
    ref.current.fetchOne(wanted).then((r) => { if (r) ref.current.open(r, mode); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, mode, openId, loading, rows.length]);

  /** بيتنده جوّه دالة الفتح بتاعة الشاشة — بيدفع المستند على العنوان. */
  const markOpen = useCallback((id: number, m: DocMode = 'view') => {
    handled.current = id;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('doc');
      next.delete('edit');
      next.set(m === 'edit' ? 'edit' : 'doc', String(id));
      return next;
    });
  }, [setParams]);

  /** بيتنده جوّه دالة القفل — بيشيل المستند من العنوان من غير ما يزوّد خطوة. */
  const markClosed = useCallback(() => {
    handled.current = null;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('doc');
      next.delete('edit');
      return next;
    }, { replace: true });
  }, [setParams]);

  return { markOpen, markClosed };
}
