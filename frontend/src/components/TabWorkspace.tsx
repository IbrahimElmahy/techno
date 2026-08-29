import React from 'react';
import { Empty } from 'antd';
import { useTabs } from './TabsContext';
import PageRoutes from './PageRoutes';
import { TabActiveContext } from './keyboard';

/**
 * لوحة تبويب واحدة — متمسّكة، فالتبويبات التانية مابتترسمش وانت بتنقّل.
 *
 * كل تبويب مفتوح بيفضل مركّب عشان الفاتورة اللي نصّها مكتوب تفضل مكانها لما ترجعلها. بس
 * «مركّب» كان بيتحوّل لـ«بيترسم من الأول مع أي حركة»: أي تنقّل بيعمل رندر للورشة، والورشة
 * بترسم التبويبات كلها. يعني تفتح شاشة وانت فاتح خمسة، فالستة كلهم بيترسموا — وفيهم شاشة
 * الفواتير بجدولها وسطورها.
 *
 * `React.memo` هنا بيخلّي التبويب يترسم لما يتغيّر مساره هو أو حالته (نشط/مش نشط) بس. تبديل
 * تبويب بيرسم اتنين — اللي راح واللي جه — مش كل اللي مفتوح.
 */
const TabPanel = React.memo(function TabPanel(
  { path, active }: { path: string; active: boolean },
) {
  return (
    <div style={{ display: active ? 'block' : 'none', height: '100%' }}>
      {/* Only the visible tab owns the keyboard. The others stay mounted to keep their
          in-progress state, and a hidden screen holding F2 is a screen answering for one
          you are not looking at. */}
      <TabActiveContext.Provider value={active}>
        <PageRoutes location={path} />
      </TabActiveContext.Provider>
    </div>
  );
});

export default function TabWorkspace() {
  const { tabs, activeId } = useTabs();

  if (tabs.length === 0) {
    return <Empty description="لا توجد تبويبات مفتوحة — اختر قسماً من القائمة" style={{ marginTop: 80 }} />;
  }

  return (
    <>
      {tabs.map((t) => (
        <TabPanel key={t.id} path={t.path} active={t.id === activeId} />
      ))}
    </>
  );
}
