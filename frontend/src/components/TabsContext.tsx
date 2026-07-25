import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Chrome-style workspace tabs. One tab per top-level section, keyed by its base path. Every open
 * tab's page stays MOUNTED (the workspace renders each at its own `<Routes location>` and only
 * shows the active one), so a half-finished invoice — or any in-progress form — is still there
 * when you switch away and come back. Navigating deeper inside a section (e.g. a customer file)
 * stays in the same tab and just updates its title.
 *
 * There is ONE router (the outer HashRouter); its URL always mirrors the ACTIVE tab's location.
 * Switching tabs navigates the URL to that tab's stored location.
 */

export interface WorkTab {
  id: string;    // the base path, e.g. '/customers'
  path: string;  // the tab's current inner path (e.g. '/customers/5')
  title: string;
}

const BASE_TITLES: Record<string, string> = {
  '/dashboard': 'الرئيسية',
  '/users': 'إدارة المستخدمين',
  '/org': 'الهيكل التنظيمي',
  '/customers': 'العملاء والذمم',
  '/suppliers': 'الموردين والمدفوعات',
  '/catalog': 'كتالوج المنتجات',
  '/purchases': 'إدخال المشتريات',
  '/manufacturing': 'عمليات التصنيع',
  '/invoices': 'الفواتير والمرتجعات',
  '/returns': 'مرتجعات المبيعات',
  '/transfers': 'تحويلات المخزون',
  '/treasury': 'الحسابات والخزينة',
  '/vouchers': 'سندات القبض والصرف',
  '/finance-reports': 'القوائم المالية',
  '/general-ledger': 'الأستاذ العام والقيود',
  '/loyalty': 'خدمة ما بعد البيع',
  '/audit': 'سجل العمليات',
  '/inspections': 'المعاينات',
  '/inspection-items': 'أصناف المعاينة',
  '/reports': 'التقارير والإحصائيات',
  '/settings': 'إعدادات القوائم',
};

export function baseOf(path: string): string {
  const seg = path.split('?')[0].split('/').filter(Boolean);
  return `/${seg[0] || 'dashboard'}`;
}

export function titleForPath(path: string): string {
  const seg = path.split('?')[0].split('/').filter(Boolean);
  const base = `/${seg[0] || 'dashboard'}`;
  if (seg.length >= 2) {
    if (base === '/customers') return 'ملف العميل';
    if (base === '/suppliers') return 'ملف المورد';
    if (base === '/catalog') return 'ملف الصنف';
  }
  return BASE_TITLES[base] || base;
}

interface TabsContextType {
  tabs: WorkTab[];
  activeId: string | null;
  openTab: (path: string, title?: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const start = location.pathname === '/' ? '/dashboard' : location.pathname;

  const [tabs, setTabs] = useState<WorkTab[]>([
    { id: baseOf(start), path: start, title: titleForPath(start) },
  ]);
  const [activeId, setActiveId] = useState<string | null>(baseOf(start));
  // Mirrors for synchronous reads inside callbacks (no navigate-in-updater).
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // The URL is the single source of truth: whatever the router is showing, the tabs must reflect.
  // Each tab is a top-level SECTION keyed by its base path; navigating deeper inside a section
  // (e.g. a customer file) keeps the same tab and just updates its stored path + title, so
  // switching back restores exactly where you were. Landing on a NEW section (sidebar click,
  // browser back/forward, deep link) finds no tab for that base → opens one. This one reconciler
  // keeps `id` and content from ever diverging, which is what avoids phantom/duplicate tabs.
  useEffect(() => {
    const path = location.pathname === '/' ? '/dashboard' : location.pathname;
    const base = baseOf(path);
    const title = titleForPath(path);
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === base);
      if (existing) {
        if (existing.path === path && existing.title === title) return prev; // no-op
        return prev.map((t) => (t.id === base ? { ...t, path, title } : t));
      }
      return [...prev, { id: base, path, title }];
    });
    setActiveId(base);
  }, [location.pathname]);

  const openTab = useCallback((path: string) => {
    // Restore an already-open section where the user left it; otherwise open it fresh.
    const existing = tabsRef.current.find((t) => t.id === baseOf(path));
    navigate(existing ? existing.path : path);
  }, [navigate]);

  const activateTab = useCallback((id: string) => {
    const t = tabsRef.current.find((x) => x.id === id);
    if (t) navigate(t.path);
  }, [navigate]);

  const closeTab = useCallback((id: string) => {
    const cur = tabsRef.current;
    const idx = cur.findIndex((t) => t.id === id);
    const next = cur.filter((t) => t.id !== id);
    setTabs(next);
    if (activeIdRef.current === id) {
      const fallback = next[idx] || next[idx - 1] || next[0] || null;
      if (fallback) navigate(fallback.path);   // the reconciler sets active from the URL
      else setActiveId(null);
    }
  }, [navigate]);

  return (
    <TabsContext.Provider value={{ tabs, activeId, openTab, activateTab, closeTab }}>
      {children}
    </TabsContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used within a TabsProvider');
  return ctx;
}
