import React, { useEffect, useState } from 'react';
import { useTabs } from './TabsContext';
import PageRoutes from './PageRoutes';
import { TabActiveContext } from './keyboard';

/**
 * مساحة الشغل — شاشة واحدة معروضة، وآخر كام شاشة بتفضل متمسّكة ورا الستار.
 *
 * كانت تبويبات على شكل كروم، واتشالت بطلب صاحب النظام: القايمة بقت فوق، وشريط
 * تبويبات تحتها كان بيحوّل الصف العلوي لحاجات بتتزاحم على نفس المساحة.
 *
 * بس التبويبات كانت بتعمل حاجة تانية غير التنقّل: الشاشة اللي بتسيبها كانت بتفضل
 * **مركّبة**، فالفاتورة اللي نصّها مكتوب بتلاقيها زي ما سبتها لما ترجع. ده اللي
 * رجع هنا من غير الشريط: آخر `KEEP` شاشة بتفضل مركّبة ومخبية، والمعروضة واحدة.
 *
 * **ليه عدد محدود مش الكل.** من غير سقف، كل شاشة تفتحها بتفضل مركّبة للأبد — تفتح
 * عشرين شاشة في اليوم يبقى عشرين جدول عايشين في الذاكرة وبيعيدوا الاشتراك في كل
 * حاجة. الأربعة دول بيغطّوا اللي بيحصل فعلاً: تسيب فاتورة، تبص على رصيد صنف أو
 * كشف حساب، وترجع.
 *
 * والقديم بيتشال بترتيب آخر زيارة، مش ترتيب الفتح: اللي سبته من دقيقة أولى باللي
 * سبته من ساعة.
 *
 * `React.memo` عشان التنقّل يرسم اتنين بس — اللي راح واللي جه — مش كل المتمسّك.
 */

/** كام شاشة تفضل مركّبة، المعروضة منهم. رقم واحد بيتظبط من هنا. */
const KEEP = 4;

const Panel = React.memo(function Panel(
  { path, active }: { path: string; active: boolean },
) {
  return (
    <div style={{ display: active ? 'block' : 'none', height: '100%' }}>
      {/* الشاشة المخبية بتفضل مركّبة عشان حالتها، بس مابتاخدش الكيبورد: شاشة مش
          باينة بترد على F2 هي شاشة بتجاوب عن حاجة انت مش شايفها. */}
      <TabActiveContext.Provider value={active}>
        <PageRoutes location={path} />
      </TabActiveContext.Provider>
    </div>
  );
});

export default function TabWorkspace() {
  const { tabs, activeId } = useTabs();

  // ترتيب آخر زيارة — الأحدث الأول، والزيادة بتتقص من الآخر.
  const [recent, setRecent] = useState<string[]>(() => (activeId ? [activeId] : []));
  useEffect(() => {
    if (!activeId) return;
    setRecent((prev) => (prev[0] === activeId
      ? prev
      : [activeId, ...prev.filter((id) => id !== activeId)].slice(0, KEEP)));
  }, [activeId]);

  const alive = tabs.filter((t) => recent.includes(t.id));

  return (
    <>
      {alive.map((t) => (
        <Panel key={t.id} path={t.path} active={t.id === activeId} />
      ))}
    </>
  );
}
