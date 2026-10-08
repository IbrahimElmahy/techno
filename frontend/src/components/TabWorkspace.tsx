import React, { useEffect, useState } from 'react';
import { Result } from 'antd';
import { useTabs } from './TabsContext';
import { useAuth } from './AuthProvider';
import PageRoutes from './PageRoutes';
import { TabActiveContext } from './keyboard';

const KEEP = 12;

const Panel = React.memo(function Panel(
  { path, active, blocked }: { path: string; active: boolean; blocked: boolean },
) {
  return (
    <div style={{ display: active ? 'block' : 'none', height: '100%' }}>
      {blocked ? (
        <Result status="403" title="ليس لديك صلاحية الوصول إلى هذه الصفحة"
          subTitle="تم حجبها من صلاحيات المستخدمين — اطلبها من مديرك إن كنت تحتاجها." />
      ) : (
        <TabActiveContext.Provider value={active}>
          <PageRoutes location={path} />
        </TabActiveContext.Provider>
      )}
    </div>
  );
});

function isHidden(path: string, hidden?: string[]): boolean {
  if (!hidden?.length) return false;
  return hidden.includes(path) || hidden.includes(path.split('?')[0]);
}

export default function TabWorkspace() {
  const { tabs, activeId } = useTabs();
  const { user } = useAuth();

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
        <Panel key={t.id} path={t.path} active={t.id === activeId}
          blocked={isHidden(t.path, user?.pages_hidden)} />
      ))}
    </>
  );
}
