import React from 'react';
import { Empty } from 'antd';
import PageRoutes from './PageRoutes';
import { useTabs } from './TabsContext';
import { TabActiveContext } from './keyboard';

/**
 * Renders every open tab at once — each as its own `<Routes location={tab.path}>` in the single
 * app router — and shows only the active one. Inactive tabs are display:none but stay MOUNTED,
 * which is what keeps their in-progress state alive.
 */
export default function TabWorkspace() {
  const { tabs, activeId } = useTabs();

  if (tabs.length === 0) {
    return <Empty description="لا توجد تبويبات مفتوحة — اختر قسماً من القائمة" style={{ marginTop: 80 }} />;
  }

  return (
    <>
      {tabs.map((t) => (
        <div key={t.id}
          style={{ display: t.id === activeId ? 'block' : 'none', height: '100%' }}>
          {/* Only the visible tab owns the keyboard. The others stay mounted to keep their
              in-progress state, and a hidden screen holding F2 is a screen answering for one
              you are not looking at. */}
          <TabActiveContext.Provider value={t.id === activeId}>
            <PageRoutes location={t.path} />
          </TabActiveContext.Provider>
        </div>
      ))}
    </>
  );
}
