import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { allScreens } from './navigation';

export interface WorkTab {
  id: string;
  path: string;
  title: string;
}

const BASE_TITLES: Record<string, string> = {
  '/dashboard': 'الرئيسية',
  '/users': 'إدارة المستخدمين',
  '/org': 'الهيكل التنظيمي',
  '/customers': 'العملاء والذمم',
  '/customer-debts': 'مديونيات العملاء',
  '/suppliers': 'الموردين والمدفوعات',
  '/catalog': 'كتالوج المنتجات',
  '/purchases': 'إدخال المشتريات',
  '/manufacturing': 'عمليات التصنيع',
  '/invoices': 'الفواتير والمرتجعات',
  '/returns': 'مرتجعات المبيعات',
  '/transfers': 'تحويلات المخزون',
  '/stock-balance': 'رصيد صنف',
  '/stock-sheet': 'جرد المخازن',
  '/stock-alerts': 'تنبيهات المخزون',
  '/stock-value': 'قيمة المخزون',
  '/sales-reports': 'تقارير المبيعات',
  '/purchase-reports': 'تقارير المشتريات',
  '/stock-reports': 'تقارير المخازن',
  '/ledger-reports': 'تقارير الحسابات',
  '/item-card': 'كارت الصنف',
  '/stock-permits': 'أذونات المخزن',
  '/stocktake': 'جرد حتى تاريخ',
  '/account-statement': 'كشف حساب',
  '/reconciliation': 'تسوية الحسابات',
  '/fixed-assets': 'الأصول الثابتة',
  '/employees': 'الموظفون والوظائف',
  '/orders': 'طلبات البيع والشراء',
  '/coupon-receipts': 'استلام الكوبونات',
  '/coupon-custody': 'عهدة الكوبونات',
  '/after-sales-reports': 'تقارير المتابعة',
  '/inspection-points': 'تحليل أصناف المعاينات بالنقاط',
  '/technician-statement': 'كشف حساب الفني',
  '/points-ledger': 'سجل النقاط',
  '/treasury': 'الحسابات والخزينة',
  '/vouchers': 'سندات القبض والصرف',
  '/finance-reports': 'القوائم المالية',
  '/general-ledger': 'الأستاذ العام والقيود',
  '/loyalty': 'الكوبونات والنقاط',
  '/audit': 'سجل العمليات',
  '/inspections': 'المعاينات',
  '/owners': 'الملّاك',
  '/inspection-items': 'أصناف المعاينة',
  '/reports': 'التقارير والإحصائيات',
  '/trade-reports': 'تقارير المبيعات والمشتريات',
  '/employee-receivables': 'ذمم وسلف الموظفين',
  '/hr-reports': 'تقارير الموارد البشرية',
  '/ops-reports': 'تقارير التشغيل',
  '/profitability': 'تحليل الربحية',
  '/income-sheet': 'قائمة الدخل',
  '/settings': 'إعدادات القوائم',
  '/permissions': 'الصلاحيات',
  '/branch-overview': 'نظرة على الفروع',
  '/reps': 'المناديب',
  '/partners-current': 'جاري الشركاء',
  '/party-links': 'الأطراف المرتبطة',
  '/territories': 'المناطق',
  '/governorates': 'المحافظات',
};

const NAV_KEYS = new Set(allScreens().map((s) => s.key));

export function baseOf(path: string): string {
  if (NAV_KEYS.has(path)) return path;
  const seg = path.split('?')[0].split('/').filter(Boolean);
  return `/${seg[0] || 'dashboard'}`;
}

export function titleForPath(path: string): string {
  const named = allScreens().find((s) => s.key === path);
  if (named) return named.label;
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
  retireTab: (fromPath: string, cleanPath: string, toPath?: string) => void;
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
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/dashboard', { replace: true });
      return;
    }
    const raw = location.pathname;
    const path = raw + (location.search || '');
    const base = baseOf(path);
    const title = titleForPath(path);
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === base);
      if (existing) {
        if (existing.path === path && existing.title === title) return prev;
        return prev.map((t) => (t.id === base ? { ...t, path, title } : t));
      }
      return [...prev, { id: base, path, title }];
    });
    setActiveId(base);
  }, [location.pathname, location.search, navigate]);

  const openTab = useCallback((path: string) => {
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
      if (fallback) navigate(fallback.path);
      else setActiveId(null);
    }
  }, [navigate]);

  const retireTab = useCallback((fromPath: string, cleanPath: string, toPath?: string) => {
    const id = baseOf(fromPath);
    const toId = toPath ? baseOf(toPath) : null;
    setTabs((prev) => {
      let next = prev;
      if (next.some((t) => t.id === id)) {
        next = baseOf(cleanPath) !== id
          ? next.filter((t) => t.id !== id)
          : next.map((t) => (t.id === id
            ? { ...t, path: cleanPath, title: titleForPath(cleanPath) } : t));
      }
      if (toPath && toId && toId !== id) {
        const title = titleForPath(toPath);
        next = next.some((t) => t.id === toId)
          ? next.map((t) => (t.id === toId ? { ...t, path: toPath, title } : t))
          : [...next, { id: toId, path: toPath, title }];
      }
      return next;
    });
    if (toId && toId !== id) setActiveId(toId);
  }, []);

  const value = useMemo(
    () => ({ tabs, activeId, openTab, activateTab, closeTab, retireTab }),
    [tabs, activeId, openTab, activateTab, closeTab, retireTab],
  );

  return (
    <TabsContext.Provider value={value}>
      {children}
    </TabsContext.Provider>
  );
}

export function useTabsOptional(): TabsContextType | undefined {
  return useContext(TabsContext);
}

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used within a TabsProvider');
  return ctx;
}
