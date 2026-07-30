import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Tabs, theme, Dropdown, Space, Avatar, Modal, Result } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileTextOutlined,
  SettingOutlined,
  MobileOutlined,
  DatabaseOutlined,
  ShopOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { useAuth, RoleName } from './AuthProvider';
import Logo from './Logo';
import { useTabs } from './TabsContext';
import TabWorkspace from './TabWorkspace';

const { Header, Sider, Content } = Layout;

/**
 * «قارئ» reaches the screens whose job is looking — lists, cards, statements, reports — and none of
 * the entry screens. A viewer cannot post on those anyway; offering a screen where every button is
 * refused is worse than not offering it, because the user has to discover the refusal one click at
 * a time. The backend is the real guard either way: this only decides what is worth showing.
 */
// Role translations in Arabic
const ROLE_LABELS: Record<RoleName, string> = {
  system_admin: 'مدير النظام الرئيسي',
  branch_manager: 'مدير الفرع',
  purchasing_manager: 'مدير المشتريات',
  sales_manager: 'مدير المبيعات',
  after_sales_staff: 'موظف خدمة ما بعد البيع',
  sales_rep: 'مندوب مبيعات',
  accountant: 'المحاسب',
  // «قارئ» — يشوف ويطبع، ما يغيّرش حاجة.
  viewer: 'قارئ (عرض فقط)',
};

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const { tabs, activeId, openTab, activateTab, closeTab } = useTabs();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Version update check
    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.checkForUpdates) {
      electronAPI.checkForUpdates().then((res: any) => {
        if (res && res.updateAvailable) {
          Modal.confirm({
            title: 'يتوفر تحديث جديد للبرنامج',
            content: `يتوفر إصدار أحدث للتحميل (${res.version}). هل ترغب في ترقية نسخة التطبيق الآن؟`,
            okText: 'تنزيل الترقية',
            cancelText: 'تذكيري لاحقاً',
            onOk: () => {
              window.open(res.downloadUrl, '_blank');
            },
          });
        }
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  /**
   * The sidebar, grouped.
   *
   * It had grown to nearly thirty flat entries, which is past the point where anyone reads a
   * list — you scan it for a word you already know and give up if it isn't near the top. The
   * groups are the ones the work actually splits into, so a salesman opens one section and a
   * storekeeper another, and neither scrolls past the other's screens to reach his own.
   *
   * Roles stay declared per SCREEN, never per group: a group is a heading, not a permission.
   * A group whose screens are all forbidden simply disappears.
   */
  const menuGroups: {
    key: string;
    icon: React.ReactNode;
    label: string;
    children: { key: string; label: string; roles: string[] }[];
  }[] = [
    {
      key: 'grp-sales',
      icon: <ShopOutlined />,
      label: 'المبيعات',
      children: [
        { key: '/invoices', label: 'فواتير البيع',
          roles: ['system_admin', 'branch_manager', 'sales_manager', 'viewer'] },
        { key: '/returns', label: 'مرتجعات المبيعات',
          roles: ['system_admin', 'branch_manager', 'sales_manager', 'viewer'] },
        { key: '/orders', label: 'طلبات البيع والشراء',
          roles: ['system_admin', 'branch_manager', 'sales_manager', 'purchasing_manager', 'viewer'] },
        { key: '/customers', label: 'العملاء والذمم',
          roles: ['system_admin', 'branch_manager', 'sales_manager', 'after_sales_staff', 'viewer'] },
        { key: '/coupon-receipts', label: 'استلام الكوبونات',
          roles: ['system_admin', 'branch_manager', 'sales_manager', 'after_sales_staff'] },
        { key: '/loyalty', label: 'خدمة ما بعد البيع',
          roles: ['system_admin', 'after_sales_staff'] },
      ],
    },
    {
      key: 'grp-purchasing',
      icon: <FileTextOutlined />,
      label: 'المشتريات',
      children: [
        { key: '/purchases', label: 'إدخال المشتريات',
          roles: ['system_admin', 'purchasing_manager'] },
        { key: '/suppliers', label: 'الموردين والمدفوعات',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'viewer'] },
      ],
    },
    {
      key: 'grp-stock',
      icon: <DatabaseOutlined />,
      label: 'المخزون',
      children: [
        { key: '/catalog', label: 'كتالوج المنتجات',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager',
            'after_sales_staff', 'viewer'] },
        { key: '/stock-balance', label: 'رصيد صنف',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
        { key: '/item-card', label: 'كارت الصنف',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
        { key: '/stock-permits', label: 'أذونات المخزن',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
        { key: '/transfers', label: 'تحويلات المخزون',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
        { key: '/stocktake', label: 'جرد حق تاريخ',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
        { key: '/stock-alerts', label: 'تنبيهات المخزون',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
        { key: '/manufacturing', label: 'عمليات التصنيع',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager'] },
      ],
    },
    {
      key: 'grp-finance',
      icon: <DollarOutlined />,
      label: 'الحسابات',
      children: [
        { key: '/treasury', label: 'الحسابات والخزينة',
          roles: ['system_admin', 'branch_manager'] },
        { key: '/vouchers', label: 'سندات القبض والصرف',
          roles: ['system_admin', 'branch_manager', 'accountant', 'sales_manager', 'viewer'] },
        { key: '/account-statement', label: 'كشف حساب',
          roles: ['system_admin', 'branch_manager', 'accountant', 'viewer'] },
        { key: '/fixed-assets', label: 'الأصول الثابتة',
          roles: ['system_admin', 'branch_manager', 'accountant', 'viewer'] },
        { key: '/finance-reports', label: 'القوائم المالية',
          roles: ['system_admin', 'branch_manager', 'accountant', 'viewer'] },
        { key: '/general-ledger', label: 'الأستاذ العام والقيود',
          roles: ['system_admin', 'accountant', 'viewer'] },
      ],
    },
    {
      key: 'grp-reports',
      icon: <BookOutlined />,
      label: 'التقارير',
      children: [
        { key: '/trade-reports', label: 'تقارير المبيعات والمشتريات',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
        { key: '/reports', label: 'التقارير والإحصائيات',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'] },
      ],
    },
    {
      key: 'grp-inspections',
      icon: <MobileOutlined />,
      label: 'المعاينات',
      children: [
        { key: '/inspections', label: 'المعاينات',
          roles: ['system_admin', 'branch_manager', 'sales_manager', 'after_sales_staff', 'viewer'] },
        { key: '/inspection-items', label: 'أصناف المعاينة',
          roles: ['system_admin', 'branch_manager'] },
      ],
    },
    {
      key: 'grp-admin',
      icon: <SettingOutlined />,
      label: 'الإدارة',
      children: [
        { key: '/users', label: 'إدارة المستخدمين',
          roles: ['system_admin', 'branch_manager'] },
        { key: '/employees', label: 'الموظفون والوظائف',
          roles: ['system_admin', 'branch_manager'] },
        { key: '/org', label: 'الهيكل التنظيمي',
          roles: ['system_admin', 'branch_manager', 'purchasing_manager'] },
        { key: '/audit', label: 'سجل العمليات',
          roles: ['system_admin', 'branch_manager'] },
        { key: '/settings', label: 'إعدادات القوائم',
          roles: ['system_admin', 'branch_manager'] },
      ],
    },
  ];

  // The dashboard sits outside the groups: it is where everyone lands, not a section to open.
  const dashboardItem = {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: 'الرئيسية',
    roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager',
      'after_sales_staff', 'accountant'],
  };

  // Filter by role at the SCREEN level, then drop any group left with nothing in it — a heading
  // over an empty list is worse than no heading, because it reads as something broken.
  const userRole = user?.role || 'sales_rep';
  const filteredMenuItems = [
    ...(dashboardItem.roles.includes(userRole)
      ? [{ key: dashboardItem.key, icon: dashboardItem.icon, label: dashboardItem.label }]
      : []),
    ...menuGroups
      .map((g) => ({
        key: g.key,
        icon: g.icon,
        label: g.label,
        children: g.children
          .filter((c) => c.roles.includes(userRole))
          .map(({ key, label }) => ({ key, label })),
      }))
      .filter((g) => g.children.length > 0),
  ];

  // Open the group the active screen lives in, so a tab restored on load doesn't leave the
  // sidebar shut around a highlighted item nobody can see.
  const openGroupKeys = menuGroups
    .filter((g) => g.children.some((c) => c.key === (activeId || '/dashboard')))
    .map((g) => g.key);

  // A menu click opens (or focuses) that section's tab.
  const handleMenuClick = ({ key }: { key: string }) => {
    openTab(key);
  };

  // The active tab's base path drives the sidebar highlight.
  const activeBase = activeId || '/dashboard';

  const userDropdownItems = [
    {
      key: 'profile',
      label: (
        <div style={{ padding: '4px 12px' }}>
          <strong>{user?.name}</strong>
          <div style={{ fontSize: '12px', color: '#888' }}>{user && ROLE_LABELS[user.role]}</div>
        </div>
      ),
      disabled: true,
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      danger: true,
      icon: <LogoutOutlined />,
      label: 'تسجيل الخروج',
      onClick: logout,
    },
  ];

  return (
    // The shell is exactly one viewport and never scrolls: the sidebar and the header stay
    // put, and only the content box below scrolls. With `minHeight` the whole document
    // scrolled instead, dragging the sidebar (logo included) out of view.
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {!isOnline && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            direction: 'rtl',
          }}
        >
          <Result
            status="error"
            title="انقطع الاتصال بالشبكة"
            subTitle="عذراً، فقدنا الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت الخاص بك ومحاولة إعادة الاتصال لمتابعة العمل بأمان."
            extra={
              <Button type="primary" onClick={() => setIsOnline(navigator.onLine)}>
                إعادة المحاولة
              </Button>
            }
          />
        </div>
      )}
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        reverseArrow
        width={250}
        theme="light"
        style={{
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 10,
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        {/* Flex column so the logo stays pinned and the menu scrolls when items overflow. */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* The brand mark itself — collapsed keeps just the house+leaf. */}
          <div
            className="logo"
            style={{
              minHeight: 64,
              margin: 16,
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              transition: 'all 0.2s',
            }}
          >
            <Logo variant={collapsed ? 'mark' : 'full'} width={collapsed ? 40 : 168} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <Menu
              theme="light"
              mode="inline"
              selectedKeys={[activeBase]}
              defaultOpenKeys={openGroupKeys}
              items={filteredMenuItems}
              onClick={handleMenuClick}
              style={{ borderInlineEnd: 0 }}
            />
          </div>
        </div>
      </Sider>
      <Layout style={{ height: '100vh', overflow: 'hidden' }}>
        <Header
          style={{
            flexShrink: 0,
            padding: 0,
            background: colorBgContainer,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
            zIndex: 9,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{
              fontSize: '16px',
              width: 64,
              height: 64,
            }}
          />
          <div style={{ paddingLeft: 24, display: 'flex', alignItems: 'center' }}>
            <Dropdown menu={{ items: userDropdownItems }} placement="bottomLeft">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar style={{ backgroundColor: '#6AB42D' }} icon={<UserOutlined />} />
                <span className="ant-avatar-string">{user?.name}</span>
              </Space>
            </Dropdown>
          </div>
        </Header>
        {/* minHeight:0 lets this flex child actually shrink, so the box below can scroll
            instead of stretching the page. */}
        <Content style={{
          margin: '12px 24px 0', display: 'flex', flexDirection: 'column',
          minHeight: 0, overflow: 'hidden',
        }}>
          {/* Chrome-style tab strip — one tab per open section, each keeps its page mounted. */}
          <Tabs
            hideAdd
            type="editable-card"
            size="small"
            activeKey={activeId || undefined}
            onChange={activateTab}
            onEdit={(key, action) => { if (action === 'remove') closeTab(key as string); }}
            style={{ flexShrink: 0 }}
            items={tabs.map((t) => ({
              key: t.id,
              label: t.title,
              closable: tabs.length > 1,
            }))}
          />
          <div
            style={{
              padding: 24,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              marginBottom: 16,
            }}
          >
            <TabWorkspace />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
