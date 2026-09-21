import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthProvider';

/**
 * **الفرع اللي انا فيه مصنع ولا لأ؟**
 *
 * فرع المصنع شغله مختلف في اتجاهين: مافيهوش كوبونات ولا نقاط ولا خط (أبيض/بولي) —
 * دي أدوات بيع التجزئة للتجار — وقسم الإنتاج بتاعه هو وحده. والفروق دي كلها جواب
 * سؤال واحد، فهي خانة واحدة على كارت الفرع (`branch.is_factory`) مش أربع خانات.
 *
 * **والسؤال بيتسأل عن فرع اللي فاتح الشاشة.** مدير العلياء بيشوف شاشته زي ما هي،
 * واللي في المصنع بيشوف شاشته. واللي مالوش فرع (الإدارة) **بيشوف كل حاجة** — ده
 * الافتراضي الآمن: الإخفاء لازم يكون قرار، ومدير بيدوّر على خانة مش لاقيها أسوأ من
 * مدير بيشوف خانة مش محتاجها.
 *
 * **والقراءة مرة واحدة للتبويب كله.** كشف الفروع صغير وبيتغيّر مرة في السنة، وكل
 * شاشة تسأل عنه لوحدها يعني نداء زيادة مع كل فتحة. الوعد متخزّن، فالشاشة التانية
 * بتاخد نفس النتيجة من غير شبكة.
 *
 * والافتراضي وقت التحميل `false` — الشاشة بتترسم كاملة وبعدين الخانات بتختفي لو
 * الفرع مصنع. العكس (نخفي وبعدين نظهر) بيخلّي كل شاشة ترمش مرة عند كل فتحة.
 */
let cached: Promise<Set<number>> | null = null;

function factoryBranchIds(): Promise<Set<number>> {
  if (!cached) {
    cached = api
      .get('/api/v1/branches')
      .then((res) => {
        const out = new Set<number>();
        for (const b of res.data || []) if (b?.is_factory) out.add(Number(b.id));
        return out;
      })
      // الشبكة وقعت ⇒ «مش مصنع»، يعني الشاشة كاملة. ومابنخزّنش الفشل: النداء الجاي
      // بيحاول تاني بدل ما التبويب كله يفضل على إجابة غلط لحد ما يتقفل.
      .catch(() => {
        cached = null;
        return new Set<number>();
      });
  }
  return cached;
}

/** بيصفّي المخزَّن — بيتنده بعد ما حد يعدّل خانة «فرع تصنيع». */
export function forgetFactoryBranches(): void {
  cached = null;
}

export function useIsFactoryBranch(): boolean {
  const { user } = useAuth();
  const branchId = (user as any)?.branch_id ?? null;
  const [isFactory, setIsFactory] = useState(false);

  useEffect(() => {
    if (branchId == null) { setIsFactory(false); return undefined; }
    let alive = true;
    factoryBranchIds().then((ids) => { if (alive) setIsFactory(ids.has(Number(branchId))); });
    return () => { alive = false; };
  }, [branchId]);

  return isFactory;
}

export default useIsFactoryBranch;

/**
 * **يشوف أدوات المصنع ولا لأ؟** — للقايمة، مش للخانات.
 *
 * الفرق عن `useIsFactoryBranch` إن اللي مالوش فرع (الإدارة) **بيشوف**: هو بيدير
 * المصنع كمان، وإخفاء قسم الإنتاج عنه بيشيل شاشات هو اللي بيفتحها. أما إخفاء خانة
 * من ورقة فبيتقرر بفرع الورقة، وde اللي `useIsFactoryBranch` بيجاوبه.
 */
export function useShowsFactoryTools(): boolean {
  const { user } = useAuth();
  const branchId = (user as any)?.branch_id ?? null;
  const isFactory = useIsFactoryBranch();
  return branchId == null || isFactory;
}
