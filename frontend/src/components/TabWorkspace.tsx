import React from 'react';
import { Empty } from 'antd';
import PageRoutes from './PageRoutes';
import { useTabs } from './TabsContext';

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
          <PageRoutes location={t.path} />
        </div>
      ))}
    </>
  );
}
