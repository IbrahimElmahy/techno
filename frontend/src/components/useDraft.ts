import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * المسودّة — **اللي اتكتب ولسه ما اترحّلش، بيتحفظ لوحده**.
 *
 *     «لو خرجت وأنا شغال على فاتورة عايزها تبقى مسودّة»
 *
 * ---------------------------------------------------------------------------
 * **الحفظ بيحصل وانت بتكتب، مش لما تخرج.** الاعتماد على لحظة الخروج بيفشل في الحالات
 * اللي المسودّة موجودة عشانها أصلاً: الكهربا تقطع، المتصفح يقفل، التبويب يتقفل بالغلط،
 * الجهاز ينام. اللحظة الوحيدة المضمونة هي **وانت لسه بتكتب**.
 *
 * **وبتأخير، مش مع كل حرف.** الكتابة في خانة بتطلّع رندر لكل ضغطة زر، والحفظ مع كل واحدة
 * بيبعت مية نداء في الدقيقة على فاتورة واحدة. التأخير بيجمّعهم في نداء واحد بعد ما
 * الإيد تقف.
 *
 * **والمسودّة الفاضية مابتتحفظش.** فتح الشاشة وقفلها من غير كتابة مش مسودّة — وكشف مليان
 * مسودّات فاضية بيخلّي اللي فيه شغل حقيقي يضيع وسطهم. `isEmpty` بتقرر، والشاشة هي اللي
 * بتعرّفها لأنها الوحيدة اللي عارفة يعني إيه «فاضية» عندها.
 *
 * **ومابتتكتبش غير لما المحتوى يتغيّر فعلاً.**
 *
 * فتح مستند موجود — معتمد أو مرحّل — بيملا الشاشة بمحتواه. من غير الخط الأساسي ده، أول
 * لفّة حفظ تلقائي كانت بتشوف شاشة مليانة وتكتبها مسودّة، **فمجرد إنك بصيت على فاتورة
 * بيعمل منها مسودّة**. والكشف بيمتلي نسخ من مستندات موجودة خلاص، واللي بيبص يشوف نفس
 * الفاتورة مرتين ومايعرفش أنهي واحدة الحقيقية.
 *
 * فالخُطّاف بياخد لقطة من المحتوى عند كل نقطة بداية — أول تحميل، وكل مرة الشاشة تسيب
 * وضع «مستند مفتوح» (`paused` بترجع `false`)، وكل `adopt` أو `rebase` صريح — والحفظ
 * مابيحصلش غير لما المحتوى يختلف عن اللقطة دي. **فتحت وقفلت من غير ما تلمس = مافيش
 * مسودّة**، وأول حرف بتكتبه بيعمل واحدة.
 *
 * وده أمتن من إن كل شاشة تظبّط `paused` صح في كل مسار: مسار زي «تعديل إذن معتمد» بيلغي
 * الإذن ويفتح محتواه كطلب جديد، فالشاشة بتخرج من وضع «مفتوح» وهي لسه شايلة نفس المحتوى
 * — واللقطة بتمسكها، و`paused` وحدها ماكانتش.
 *
 * **وبتتمسح بالحفظ الناجح مش بالخروج.** لو اتمسحت عند الخروج، الفاتورة اللي اترفضت عند
 * الترحيل (رصيد مايكفيش، حساب ناقص) بتضيع مع الرفض — واللي كتبها بيبتدي من الأول.
 * `discard()` بتتنده بعد ما السيرفر يرد بنجاح وبس.
 *
 * ⚠️ **والمسودّة مش مستند.** مالهاش رقم ومابتحرّكش مخزون ومابتدخلش أي تقرير — هي حرفياً
 * الشاشة وهي نصّها مكتوب. الشرح الكامل لقرار «جدول مستقل مش عمود حالة» في
 * `backend/src/models/draft.py`.
 */
export interface DraftRow<P = any> {
  id: number;
  kind: string;
  title: string | null;
  payload: P;
  updated_at: string;
}

export function useDraft<P>(opts: {
  /** نوع المستند: `sale`، `purchase`… */
  kind: string;
  /** الحمولة الحالية للشاشة — بتتحفظ زي ما هي وبترجع زي ما هي. */
  payload: P;
  /** فاضية ⇒ مش مسودّة، ومابتتحفظش. */
  isEmpty: (p: P) => boolean;
  /** سطر واحد يوصفها في الكشف — اسم العميل والإجمالي مثلاً. */
  title: (p: P) => string;
  /** بيتوقف الحفظ خالص — مثلاً والمستند مفتوح للقراءة أو للتعديل، مش جديد. */
  paused?: boolean;
  /** التأخير قبل الحفظ (مللي ثانية). */
  delay?: number;
}) {
  const { kind, payload, isEmpty, title, paused = false, delay = 1500 } = opts;
  const [drafts, setDrafts] = useState<DraftRow<P>[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const idRef = useRef<number | null>(null);
  // آخر حمولة اتحفظت — عشان الرندر اللي مابيغيّرش حاجة مايبعتش نداء.
  const lastRef = useRef<string>('');
  // لقطة المحتوى عند آخر نقطة بداية. `null` = لسه ما اتاخدتش، والحفظ مستنيها.
  const baseRef = useRef<string | null>(null);
  const wasPaused = useRef<boolean>(paused);
  const fns = useRef({ isEmpty, title });
  fns.current = { isEmpty, title };

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/api/v1/drafts', { params: { kind } });
      setDrafts(res.data || []);
    } catch { /* الكشف مش حرج — الشاشة شغّالة من غيره */ }
  }, [kind]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const raw = JSON.stringify(payload ?? null);
    // خرجنا من وضع «مستند مفتوح» ⇒ خد لقطة جديدة. المحتوى اللي على الشاشة دلوقتي هو
    // المستند اللي اتفتح، ومش المفروض يتحفظ إلا لو اتغيّر بعد كده.
    if (wasPaused.current && !paused) baseRef.current = raw;
    wasPaused.current = paused;
    if (paused) return undefined;
    if (baseRef.current === null) { baseRef.current = raw; return undefined; }
    if (raw === baseRef.current) return undefined;   // مافيش تغيير ⇒ مافيش مسودّة
    if (raw === lastRef.current) return undefined;
    if (fns.current.isEmpty(payload)) return undefined;
    const t = setTimeout(async () => {
      try {
        const res = await api.post('/api/v1/drafts',
          { kind, title: fns.current.title(payload), payload },
          { params: idRef.current ? { draft_id: idRef.current } : {} });
        idRef.current = res.data?.id ?? idRef.current;
        lastRef.current = raw;
        setSavedAt(new Date().toISOString());
        refresh();
      } catch { /* الشبكة وقعت — الحفظ الجاي بياخدها */ }
    }, delay);
    return () => clearTimeout(t);
  }, [payload, paused, kind, delay, refresh]);

  /** بتتنده بعد ما المستند يترحّل بنجاح — المسودّة خلاص بقت مستند. */
  const discard = useCallback(async () => {
    const id = idRef.current;
    idRef.current = null;
    lastRef.current = '';
    baseRef.current = null;
    setSavedAt(null);
    if (id == null) return;
    try { await api.delete(`/api/v1/drafts/${id}`); } catch { /* هتتمسح بعدين */ }
    refresh();
  }, [refresh]);

  /**
   * بتمسح مسودّة من الكشف بالرقم — «امسح» جنب السطر.
   *
   * **والخطأ بيطلع لبرّه.** كان متبلوع (`catch {}`) وبعده إعادة قراءة الكشف — يعني
   * لو الحذف وقع، المسودّة بترجع مكانها من غير ولا كلمة، واللي بيحاول يمسح يفضل
   * يضغط ويشوف نفس السطر. اللي بينده هو اللي يقرر يقول إيه.
   *
   * و`baseRef` بترجع `null` مع المسودّة اللي الشاشة شغّالة عليها: الحفظ التلقائي
   * بياخد لقطة جديدة لأول لفّة بعد المسح بدل ما يكتب نفس المحتوى تاني — من غير كده
   * المسودّة اللي اتمسحت بتقدر ترجع بعد ثانية ونص برقم جديد.
   */
  const remove = useCallback(async (id: number) => {
    try {
      await api.delete(`/api/v1/drafts/${id}`);
    } finally {
      if (idRef.current === id) {
        idRef.current = null;
        lastRef.current = '';
        baseRef.current = null;
      }
      refresh();
    }
  }, [refresh]);

  /** بتقول للخُطّاف إن الشاشة دلوقتي شغّالة على المسودّة دي — فالحفظ الجاي يكتب فوقها. */
  const adopt = useCallback((id: number | null) => {
    idRef.current = id;
    lastRef.current = '';
    // استكمال مسودّة: اللقطة بتترمي عشان أول تغيير بعدها يتحفظ فوقها.
    baseRef.current = null;
  }, []);

  /** خد لقطة جديدة دلوقتي — الشاشة لسه اتملت من مستند موجود ومفيش حاجة اتغيّرت. */
  const rebase = useCallback(() => { baseRef.current = null; }, []);

  return { drafts, savedAt, discard, remove, adopt, rebase, refresh };
}
