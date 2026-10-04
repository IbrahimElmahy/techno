import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { baseOf, useTabsOptional } from './TabsContext';
import { useOnScreen } from './keyboard';

/**
 * «رجوع» من مستند اتفتح من شاشة تانية بيرجّع **للشاشة دي بالظبط** — من العنوان، مش من
 * تاريخ المتصفح.
 *
 * ---------------------------------------------------------------------------
 * **ليه اتشال `back=1` و`navigate(-1)`.** (٢٠٢٦-١٠-٠٣ — كارت الصنف/كشف الحساب ← فاتورة
 * ← رجوع كان بيودّي لسجل المبيعات.)
 *
 * كل شاشة تبويب في مساحة الشغل، والعنوان واحد بيعكس التبويب الظاهر. والرجوع القديم كان
 * بيعمل تنقّلين ورا بعض: `replace` يشيل المستند من العنوان، و`go(-1)` للشاشة اللي قبله.
 * الراوتر بيدمج الاتنين في لفّة واحدة، فتبويب المستند **مابيشوفش** العنوان النضيف وبيفضل
 * مخفي وشايل `?doc=`. وأول ما كشفه يتحدّث (`useLiveRefresh` — أي فاتورة من أي جهاز)
 * الشاشة المخفية بتشوف «رقم في العنوان ومش مفتوح» فتعتبره رابط جديد، وتكتب في العنوان
 * **المشترك** (`setSearchParams` بينقل الراوتر كله) — فالمستخدم بيتشدّ لكشف الفواتير.
 * وكانت كمان بتبني البارامترات من `window.location.search`، اللي هو عنوان التبويب
 * الظاهر مش بتاعها.
 *
 * ---------------------------------------------------------------------------
 * **دلوقتي:** الرابط بيشيل الأصل نفسه — `ret=<مسار التبويب اللي اتفتح منه بالاستعلام>`.
 * و«رجوع» بيكتب لتبويب المستند كشفه النضيف مباشرة (`retireTab`، من غير تنقّل)، وبعدين
 * بيروح للأصل بـ`replace`. المزامنة في `TabsContext` بتلاقي تبويب الأصل مفتوح بنفس المسار
 * فبتظهره زي ما هو — بحالته وسكروله — ولو مش مفتوح بتفتحه من مساره.
 *
 * **و`replace` مش `push`:** خطوة المستند بتتبدّل بالأصل، فزرار رجوع المتصفح عمره ما
 * بيرجّع مستند انت قافله. التمن خطوة مكرّرة للأصل في التاريخ — مابتغيّرش حاجة على الشاشة.
 *
 * وتحديث الصفحة على مستند فيه `ret` بيفضل يرجّع للأصل: الأصل مكتوب في العنوان نفسه.
 */

/** اسمه `ret` مش `from`: كشف الحساب بيستعمل `from` لأول الفترة، و`doc` لرقم المستند. */
export const RET_PARAM = 'ret';

/** بارامترات المستند المفتوح — اللي بتتشال لما الشاشة ترجع لكشفها. `back` قديم. */
const DOC_PARAMS = ['doc', 'edit', 'id', 'back', RET_PARAM];

/** الأصل من الاستعلام — مسار جوّه النظام بس (`/…`)، غير كده يتجاهل. */
export function readReturn(search: URLSearchParams | string | null | undefined): string | null {
  if (search == null) return null;
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const v = p.get(RET_PARAM);
  if (!v || !v.startsWith('/') || v.startsWith('//')) return null;
  return v;
}

/**
 * رابط المستند ومعاه الأصل.
 *
 * لو الأصل هو نفس شاشة المستند (فاتورة بتفتح فاتورة) مافيش «شاشة تانية» نرجع لها —
 * بس لو الشاشة دي نفسها جاية من أصل، الأصل ده بيتورّث عشان مايضيعش في النص.
 */
export function withReturn(target: string, origin: string | null | undefined): string {
  if (!origin) return target;
  const ret = baseOf(origin) === baseOf(target)
    ? readReturn(origin.split('?')[1] ?? '')
    : origin;
  if (!ret) return target;
  const [path, qs = ''] = target.split('?');
  const p = new URLSearchParams(qs);
  p.set(RET_PARAM, ret);
  return `${path}?${p.toString()}`;
}

/** نفس مسار الشاشة من غير المستند ولا الأصل — كشفها. */
export function cleanDocPath(pathname: string, search: string | URLSearchParams): string {
  const p = new URLSearchParams(search);
  DOC_PARAMS.forEach((k) => p.delete(k));
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * الخُطّاف اللي كل شاشة مستند بتستعمله لـ«رجوع».
 *
 * * `origin()` — الأصل اللي في عنوان **التبويب ده** (مش `window.location`)، أو `null`.
 * * `leave()` — لو فيه أصل: كشف التبويب ده بيتكتب له، وبنروح للأصل، وبيرجّع `true`.
 *   الشاشة بتفضّي حالتها هي بنفسها **من غير ما تلمس العنوان**. من غير أصل بيرجّع `false`
 *   والشاشة تقفل زي ما كانت.
 *
 * الشاشة المخفية مابتمشيش لأي حتة — العنوان بتاع التبويب الظاهر مش بتاعها.
 */
export function useDocReturn() {
  const navigate = useNavigate();
  const loc = useLocation();
  const tabs = useTabsOptional();
  const onScreen = useOnScreen();
  const ref = useRef({ loc, tabs, onScreen });
  ref.current = { loc, tabs, onScreen };

  const origin = useCallback((): string | null => readReturn(ref.current.loc.search), []);

  const leave = useCallback((): boolean => {
    const { loc: l, tabs: t, onScreen: shown } = ref.current;
    const to = readReturn(l.search);
    if (!to || !shown) return false;
    t?.retireTab(l.pathname + l.search, cleanDocPath(l.pathname, l.search), to);
    navigate(to, { replace: true });
    return true;
  }, [navigate]);

  return useMemo(() => ({ origin, leave }), [origin, leave]);
}
