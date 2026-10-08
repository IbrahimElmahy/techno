import React, { useState, useEffect } from 'react';
import { useShowsFactoryTools } from './useFactoryBranch';
import {
  Layout, Menu, Button, Tabs, theme, Dropdown, Space, Avatar, Modal, Result, Tooltip,
} from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
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
  ApartmentOutlined,
  ShoppingCartOutlined,
  BuildOutlined,
  AppstoreOutlined,
  KeyOutlined,
  CarOutlined,
} from '@ant-design/icons';
import {
  NAVIGATION, EXTRA_SECTIONS, HOME_SCREEN, isGroup, NavGroup, NavScreen,
} from './navigation';
import ShortcutsDock from './ShortcutsDock';
import HScrollDock from './HScrollDock';
import { useAuth, RoleName, roleForAccess } from './AuthProvider';
import RowDensityControl from './RowDensity';
import NumeralsControl from './Numerals';
import ContrastToggle, { ContrastHeaderButton } from './ContrastTheme';
import { bindNumeralsUser } from '../utils/numerals';
import { useFullscreen } from './FullscreenToggle';
import Logo from './Logo';
import BranchFilter, { BranchBadge } from './BranchFilter';
import { useTabs } from './TabsContext';
import TabWorkspace from './TabWorkspace';
import { APP_SCROLL_CLASS } from './tableDefaults';

const { Header, Sider, Content } = Layout;

const ROLE_LABELS: Record<RoleName, string> = {
  owner: 'المالك',
  system_admin: 'مدير النظام الرئيسي',
  branch_manager: 'مدير الفرع',
  purchasing_manager: 'مدير المشتريات',
  sales_manager: 'مدير المبيعات',
  after_sales_staff: 'موظف خدمة ما بعد البيع',
  sales_rep: 'مندوب مبيعات',
  accountant: 'المحاسب',
  viewer: 'قارئ (عرض فقط)',
  rep_supervisor: 'مشرف مناديب',
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  'grp-setup': <ApartmentOutlined />,
  'grp-sales': <ShopOutlined />,
  'grp-purchasing': <ShoppingCartOutlined />,
  'grp-stock': <DatabaseOutlined />,
  'grp-accounts': <DollarOutlined />,
  'grp-production': <BuildOutlined />,
  'grp-settings': <SettingOutlined />,
  'grp-extra': <MobileOutlined />,
  'grp-fleet': <CarOutlined />,
  '/voucher-keys': <KeyOutlined />,
};

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [showTree, setShowTree] = useState(() => {
    try { return localStorage.getItem('nav.tree') === '1'; } catch { return false; }
  });
  const toggleTree = () => setShowTree((v) => {
    try { localStorage.setItem('nav.tree', v ? '0' : '1'); } catch {}
    return !v;
  });
  const { user, logout } = useAuth();
  const { activeId, openTab } = useTabs();
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => { bindNumeralsUser(user?.username ?? null); }, [user?.username]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.checkForUpdates) {
      electronAPI.checkForUpdates().then((res: any) => {
        if (res && res.updateAvailable) {
          Modal.confirm({
            title: 'يتوفر تحديث جديد للبرنامج',
            content: `يتوفر إصدار أحدث للتحميل (${res.version}). هل ترغب في ترقية البرنامج الآن؟`,
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

  const userRole = user ? roleForAccess(user.role) : 'sales_rep';

  const showsFactoryTools = useShowsFactoryTools();
  const buildItems = (nodes: (NavScreen | NavGroup)[]): any[] =>
    nodes
      .map((node) => {
        if (!isGroup(node)) {
          if (user?.pages_hidden?.includes(node.key)) return null;
          return node.roles.includes(userRole) || user?.pages_shown?.includes(node.key)
            ? { key: node.key, label: node.label } : null;
        }
        if (node.factoryOnly && !showsFactoryTools) return null;
        const children = buildItems(node.children);
        return children.length ? { key: node.key, label: node.label, children } : null;
      })
      .filter(Boolean);

  const filteredMenuItems = [
    ...(HOME_SCREEN.roles.includes(userRole)
      ? [{ key: HOME_SCREEN.key, icon: <DashboardOutlined />, label: HOME_SCREEN.label }]
      : []),
    ...buildItems([...NAVIGATION, ...EXTRA_SECTIONS]).map((item, i) => ({
      ...item,
      icon: SECTION_ICONS[item.key] ?? <AppstoreOutlined />,
    })),
  ];

  const ancestorsOf = (target: string, nodes: (NavScreen | NavGroup)[], trail: string[] = []): string[] => {
    for (const node of nodes) {
      if (!isGroup(node)) {
        if (node.key === target || node.key.split('?')[0] === target) return trail;
        continue;
      }
      const found = ancestorsOf(target, node.children, [...trail, node.key]);
      if (found.length || node.children.some((c) => !isGroup(c) && c.key === target)) return found;
    }
    return [];
  };
  const openGroupKeys = ancestorsOf(activeId || '/dashboard', [...NAVIGATION, ...EXTRA_SECTIONS]);

  const handleMenuClick = ({ key }: { key: string }) => {
    openTab(key);
  };

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
      key: 'density',
      label: (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '2px 0' }}>
          <div style={{ fontSize: 14, color: '#888', marginBottom: 6 }}>ارتفاع الصف</div>
          <RowDensityControl />
        </div>
      ),
    },
    {
      key: 'numerals',
      label: (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '2px 0' }}>
          <div style={{ fontSize: 14, color: '#888', marginBottom: 6 }}>شكل الأرقام</div>
          <NumeralsControl />
        </div>
      ),
    },
    {
      key: 'contrast',
      label: (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '2px 0' }}>
          <ContrastToggle />
        </div>
      ),
    },
    {
      key: 'fullscreen',
      icon: fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />,
      label: fullscreen ? 'خروج من ملء الشاشة' : 'ملء الشاشة',
      onClick: toggleFullscreen,
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
            subTitle="تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت."
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
          display: showTree ? undefined : 'none',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
            minHeight: 48,
            height: 'auto',
            lineHeight: '46px',
            flexWrap: 'wrap',
            padding: 0,
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
            zIndex: 9,
          }}
        >
          {!showTree && (
            <div style={{ paddingInlineStart: 12, display: 'flex', alignItems: 'center' }}>
              <Logo variant="mark" width={26} />
            </div>
          )}
          <Tooltip title={showTree ? 'إخفاء القائمة الجانبية' : 'إظهار القائمة الجانبية'}>
            <Button
              type="text"
              icon={showTree ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={toggleTree}
              style={{ fontSize: 16, width: 44, height: 44, flexShrink: 0 }}
            />
          </Tooltip>
          <Menu
            mode="horizontal"
            selectedKeys={[activeBase]}
            items={filteredMenuItems.map(({ icon, ...rest }: any) => rest)}
            onClick={handleMenuClick}
            disabledOverflow
            className="top-nav"
            style={{
              flex: '0 1 auto', minWidth: 0, borderBottom: 'none',
              background: 'transparent',
            }}
          />

          <div style={{ flex: 1, minWidth: 0 }} />

          <div style={{
            paddingLeft: 16, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          }}>
            {(user?.role === 'owner' || user?.role === 'system_admin')
              ? <BranchFilter /> : <BranchBadge branchId={user?.branch_id} />}
            <ContrastHeaderButton />
            <Dropdown menu={{ items: userDropdownItems }} placement="bottomLeft">
              <Tooltip title={user?.name}>
                <Avatar size={28} style={{ backgroundColor: '#6AB42D', cursor: 'pointer' }}
                        icon={<UserOutlined />} />
              </Tooltip>
            </Dropdown>
          </div>
        </Header>

        <Content style={{
          margin: '10px 16px 0', display: 'flex', flexDirection: 'column',
          minHeight: 0, overflow: 'hidden',
        }}>
          <div
            className={APP_SCROLL_CLASS}
            style={{
              padding: '16px 16px 88px',
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              marginBottom: 10,
            }}
          >
            <TabWorkspace />
          </div>
        </Content>
      </Layout>
      <HScrollDock />
      <ShortcutsDock userId={(user as any)?.id} tree={buildItems([...NAVIGATION, ...EXTRA_SECTIONS])}
        openTab={openTab} />
    </Layout>
  );
}
