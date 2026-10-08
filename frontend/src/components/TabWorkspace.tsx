import React, { useEffect, useRef, useState } from 'react';
import { Result } from 'antd';
import { useTabs } from './TabsContext';
import { useAuth } from './AuthProvider';
import PageRoutes from './PageRoutes';
import { TabActiveContext } from './keyboard';
import { onLiveEvent } from '../utils/live';
import { PanelBusyContext, type Busy } from './panelBusy';

const KEEP = 12;


const Panel = React.memo(function Panel(
  { path, active, blocked, busy, holder }: {
    path: string; active: boolean; blocked: boolean; busy: Busy;
    holder: (el: HTMLDivElement | null) => void;
  },
) {
  return (
    <div ref={holder} style={{ display: active ? 'block' : 'none', height: '100%' }}>
      {blocked ? (
        <Result status="403" title="ليس لديك صلاحية الوصول إلى هذه الصفحة"
          subTitle="تم حجبها من صلاحيات المستخدمين — اطلبها من مديرك إن كنت تحتاجها." />
      ) : (
        <PanelBusyContext.Provider value={busy}>
          <TabActiveContext.Provider value={active}>
            <PageRoutes location={path} />
          </TabActiveContext.Provider>
        </PanelBusyContext.Provider>
      )}
    </div>
  );
});

function isHidden(path: string, hidden?: string[]): boolean {
  if (!hidden?.length) return false;
  return hidden.includes(path) || hidden.includes(path.split('?')[0]);
}

const EDITING = /[?&](new|edit|doc|draft)=/;

export default function TabWorkspace() {
  const { tabs, activeId } = useTabs();
  const { user } = useAuth();

  const [recent, setRecent] = useState<string[]>(() => (activeId ? [activeId] : []));
  const [versions, setVersions] = useState<Record<string, number>>({});
  const stale = useRef<Set<string>>(new Set());
  const busy = useRef<Record<string, Busy>>({});
  const nodes = useRef<Record<string, HTMLDivElement | null>>({});
  const holders = useRef<Record<string, (el: HTMLDivElement | null) => void>>({});
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => onLiveEvent(() => {
    tabsRef.current.forEach((t) => { if (t.id !== activeRef.current) stale.current.add(t.id); });
  }), []);

  useEffect(() => {
    if (!activeId) return;
    setRecent((prev) => (prev[0] === activeId
      ? prev
      : [activeId, ...prev.filter((id) => id !== activeId)].slice(0, KEEP)));
    if (!stale.current.has(activeId)) return;
    stale.current.delete(activeId);
    const tab = tabsRef.current.find((t) => t.id === activeId);
    const node = nodes.current[activeId];
    const editing = (tab && EDITING.test(tab.path))
      || (busy.current[activeId]?.count ?? 0) > 0
      || !!node?.querySelector('.sale-doc');
    if (editing) return;
    setVersions((v) => ({ ...v, [activeId]: (v[activeId] ?? 0) + 1 }));
  }, [activeId]);

  const alive = tabs.filter((t) => recent.includes(t.id));

  return (
    <>
      {alive.map((t) => {
        if (!busy.current[t.id]) busy.current[t.id] = { count: 0 };
        if (!holders.current[t.id]) {
          holders.current[t.id] = (el) => { nodes.current[t.id] = el; };
        }
        return (
          <Panel key={`${t.id}:${versions[t.id] ?? 0}`} path={t.path} active={t.id === activeId}
            blocked={isHidden(t.path, user?.pages_hidden)} busy={busy.current[t.id]}
            holder={holders.current[t.id]} />
        );
      })}
    </>
  );
}
