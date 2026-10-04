import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDocReturn } from './docReturn';
import { useOnScreen } from './keyboard';

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
 *
 * ---------------------------------------------------------------------------
 * **و«رجوع» بيرجّع للمكان اللي جيت منه، مش لكشف الشاشة.**
 *
 * الفاتورة بتتفتح من سبع حتت غير كشف الفواتير: كارت الصنف، كشف حساب العميل، كارت
 * العميل والمورد، والتقارير. الرابط بينقلك لشاشة الفواتير، وكان «رجوع» بيشيل المستند
 * من العنوان بس — فتلاقي نفسك في **كشف الفواتير**، وشاشة مالكش دعوة بيها، ولازم ترجع
 * تدوّر على الصنف اللي كنت فيه من الأول.
 *
 * `useOpenDocument` بيحط `ret=<الأصل>` على العنوان، و«رجوع» (`markClosed`) بيروح للأصل ده
 * مباشرة — مش خطوة في تاريخ المتصفح. والتالي/السابق والتعديل (`markOpen`) بيسيبوا `ret`
 * مكانه، فالرجوع بعد التنقّل بيرجّع لنفس الأصل. الشرح الكامل في `docReturn.ts`.
 *
 * وفيه شرطين بيمنعوا خطوة زيادة:
 *
 * * **القفل على عنوان منضّف مابيعملش حاجة.** لما تدوس «رجوع» بتاع المتصفح، العنوان
 *   بيفقد `?doc` والمزامنة بتنده `close()` — واللي بينده `markClosed` بعدها. من غير
 *   الشرط ده كانت الضغطة الواحدة بترجع خطوتين.
 * * **الفتح على مستند مفتوح خلاص مابيدفعش.** الشاشة بتنده `markOpen` جوّه دالة الفتح،
 *   واللي بتتنده كمان لما المزامنة تفتح المستند اللي في العنوان — فكانت بتتسجّل خطوة
 *   مكرّرة، و«رجوع» يرجّع لنفس المستند.
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
  /**
   * **الشاشة دي هي اللي شغّالة دلوقتي ولا لأ؟** — للشاشات اللي فيها تبويبات.
   *
   * antd بتسيب أي تبويب اتفتح مرة **شغّال ومخفي** بعده، فخُطّافه بيفضل بيسمع العنوان.
   * ولما تبويبين على نفس الشاشة يسمعوا نفس `?doc=`، الرقم الواحد بيتفسّر في مساحتين
   * `id` مختلفتين: واحد يفتح مستند مش بتاعه، والتاني يقع وهو بيقرا صف ناقص. ولو
   * التبويب المخفي نده `close()` على رجوع، بيقفل مستند التبويب الظاهر.
   *
   * فالتبويب المخفي بيبعت `false` وبيسكت خالص: مابيفتحش، مابيقفلش، ومابيكتبش.
   * الافتراضي `true` — الشاشة اللي مالهاش تبويبات مابتحسّش بوجوده.
   */
  enabled?: boolean;
}) {
  const { rows, openId, open, close, fetchOne, loading, enabled = true } = opts;
  const [params, setParams] = useSearchParams();
  const editRaw = params.get('edit');
  const raw = params.get('doc') || editRaw;
  const wanted = raw ? Number(raw) : null;
  const mode: DocMode = editRaw ? 'edit' : 'view';
  const docReturn = useDocReturn();
  // الشاشة المخفية مابتكتبش في العنوان: العنوان بتاع التبويب الظاهر، و`setParams` منها
  // كان بيشدّ المستخدم لشاشتها.
  const onScreen = useOnScreen();
  const writable = enabled && onScreen;

  // أحدث نسخة من الدوال من غير ما تبقى اعتماد — وإلا المزامنة بتشتغل مع كل رندر.
  const ref = useRef({ open, close, fetchOne, rows });
  ref.current = { open, close, fetchOne, rows };

  // الرقم اللي اتعامل معاه خلاص — بيمنع إعادة الجلب لنفس المستند مع كل رندر.
  const handled = useRef<number | null>(null);

  /**
   * **الشاشة سبقت العنوان — استنّى العنوان يلحقها، ماتعكسش عليها.** (٢٠٢٦-٠٩-٣٠)
   *
   * الراوتر شغّال بـ`v7_startTransition`، فتغيير العنوان بيتأجّل عن تغيير الشاشة لفّة أو
   * اتنين. فكان «رجوع» بيقفل المستند (`openId` = null) والعنوان لسه فيه `?doc=12` ⇒
   * المزامنة تشوف «العنوان عايز ١٢ والشاشة فاضية» وتفتحه تاني، وبعدين العنوان يتنضّف
   * فتقفله تاني: رجوع ← دخول ← رجوع. والفتح نفس الحكاية بالعكس: الشاشة فتحت والعنوان
   * لسه فاضي ⇒ «اقفل»، وبعدين العنوان يوصل ⇒ «افتح».
   *
   * فـ`markOpen`/`markClosed` بيعلّموا إن فيه تغيير عنوان في السكة، والمزامنة بتسكت لحد
   * ما العنوان والشاشة يتقابلوا.
   */
  const pendingOpen = useRef<number | null>(null);
  const pendingClose = useRef(false);
  /** المستند اللي اتطلب ومالقيناهوش — عشان `opening` مايفضلش شغّال على رقم مش موجود. */
  const [missing, setMissing] = useState<number | null>(null);

  useEffect(() => {
    // تبويب مخفي: مايسمعش ومايقفلش. الشرح عند `enabled`.
    if (!enabled) return;
    if (wanted === openId) {
      handled.current = wanted;
      pendingOpen.current = null;
      pendingClose.current = false;
      return;
    }
    // اتطلب فتح المستند ده والعنوان لسه مالحقش — والشاشة نفسها ممكن تكون لسه بتجيبه.
    if (pendingOpen.current != null && wanted !== pendingOpen.current) return;
    // اتطلب قفل والعنوان لسه شايل المستند اللي اتقفل.
    if (pendingClose.current && wanted != null) return;
    if (wanted == null) {
      // العنوان مابقاش فيه مستند (رجوع، أو قفل من شاشة تانية) ⇒ اقفل.
      handled.current = null;
      ref.current.close();
      return;
    }
    if (handled.current === wanted) return;
    handled.current = wanted;
    const inPage = ref.current.rows.find((r) => r.id === wanted);
    if (inPage) { ref.current.open(inPage, mode); return; }
    // **مش في الصفحة المحمّلة ≠ مش موجود.** الكشف بيتحمّل بصفحات، والرابط الجاي من
    // كارت الصنف ممكن يبقى لمستند قديم برّه الصفحة.
    //
    // **ومابنستناش الكشف يخلص.** (٢٠٢٦-١٠-٠٤) كان الفتح بيستنى `loading` — يعني الكشف كله
    // يتحمّل الأول عشان يمكن المستند يطلع فيه — والمستخدم واقف قدام الكشف لحد ما المستند
    // يفتح. طلب واحد بالرقم أسرع من استنية الصفحة كلها.
    const id = wanted;
    ref.current.fetchOne(id)
      .then((r) => { if (r) ref.current.open(r, mode); else setMissing(id); })
      .catch(() => setMissing(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, mode, openId, rows.length, enabled]);
  void loading;

  /** بيتنده جوّه دالة الفتح بتاعة الشاشة — بيدفع المستند على العنوان. */
  const markOpen = useCallback((id: number, m: DocMode = 'view') => {
    if (!enabled) return;
    handled.current = id;
    pendingClose.current = false;
    if (!writable) return;
    // العنوان بيقول كده خلاص ⇒ مافيش خطوة جديدة. الشرح فوق.
    const key = m === 'edit' ? 'edit' : 'doc';
    const other = key === 'doc' ? 'edit' : 'doc';
    if (params.get(key) === String(id) && !params.get(other)) return;
    pendingOpen.current = id;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('doc');
      next.delete('edit');
      next.set(m === 'edit' ? 'edit' : 'doc', String(id));
      // `ret` بيفضل — التالي/السابق جوّه المستند مابيضيّعش الشاشة اللي اتفتح منها.
      return next;
    });
  }, [params, setParams, enabled, writable]);

  /**
   * بيتنده جوّه دالة القفل — بيشيل المستند من العنوان من غير ما يزوّد خطوة.
   *
   * المستند جاي من شاشة تانية (`ret`) ⇒ بيرجّع لها. `stay` للقفل اللي مش خروج («جديد»،
   * أو قفل قبل فتح غيره): بيفضل في الشاشة، والأصل بيتشال لأن الشغل بقى شغلها.
   */
  const markClosed = useCallback((opts?: { stay?: boolean }) => {
    if (!enabled) return;
    handled.current = null;
    pendingOpen.current = null;
    if (!writable) return;
    // العنوان اتنضّف خلاص (رجوع المتصفح) ⇒ مافيش خطوة تانية تتعمل.
    if (!params.get('doc') && !params.get('edit')) return;
    // الأصل: تبويب الشاشة دي بياخد كشفه، والتنقّل للأصل. الشاشة قفلت حالتها بنفسها.
    if (opts?.stay !== true && docReturn.leave()) return;
    pendingClose.current = true;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('doc');
      next.delete('edit');
      next.delete('back');
      next.delete('ret');
      return next;
    }, { replace: true });
  }, [params, setParams, enabled, writable, docReturn]);

  /**
   * **العنوان طالب مستند ولسه مافتحش** — الشاشة بتعرض `DocOpening` مكان كشفها.
   *
   * من غيره اللي فاتح فاتورة من كارت الصنف بيشوف كشف الشاشة جزء من الثانية قبل المستند.
   * بيتحسب من العنوان وقت الرسم مش في تأثير، عشان أول رسمة نفسها ماتورّيش الكشف. والقفل
   * اللي في السكة (`pendingClose`) مش «فتح»: العنوان لسه شايل المستند اللي اتقفل.
   */
  const opening = enabled && wanted != null && wanted !== openId
    && !pendingClose.current && missing !== wanted;

  return { markOpen, markClosed, opening };
}
