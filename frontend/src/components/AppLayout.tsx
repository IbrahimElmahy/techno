import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Breadcrumb, theme, Dropdown, Space, Avatar, Modal, Result } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  TeamOutlined,
  ApartmentOutlined,
  DollarOutlined,
  FileTextOutlined,
  SettingOutlined,
  MobileOutlined,
  DatabaseOutlined,
  ShopOutlined,
  SwapOutlined,
  BuildOutlined,
  HistoryOutlined,
  GiftOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, RoleName } from './AuthProvider';

const { Header, Sider, Content } = Layout;

// Role translations in Arabic
const ROLE_LABELS: Record<RoleName, string> = {
  system_admin: 'مدير النظام الرئيسي',
  branch_manager: 'مدير الفرع',
  purchasing_manager: 'مدير المشتريات',
  sales_manager: 'مدير المبيعات',
  after_sales_staff: 'موظف خدمة ما بعد البيع',
  sales_rep: 'مندوب مبيعات',
  accountant: 'المحاسب',
};

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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

  // Define sidebar menu configurations
  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: 'الرئيسية',
      roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'after_sales_staff', 'accountant'],
    },
    {
      key: '/users',
      icon: <TeamOutlined />,
      label: 'إدارة المستخدمين',
      roles: ['system_admin', 'branch_manager'],
    },
    {
      key: '/org',
      icon: <ApartmentOutlined />,
      label: 'الهيكل التنظيمي',
      roles: ['system_admin', 'branch_manager', 'purchasing_manager'],
    },
    {
      key: '/customers',
      icon: <ShopOutlined />,
      label: 'العملاء والذمم',
      roles: ['system_admin', 'branch_manager', 'sales_manager', 'after_sales_staff'],
    },
    {
      key: '/suppliers',
      icon: <TeamOutlined />,
      label: 'الموردين والمدفوعات',
      roles: ['system_admin', 'branch_manager', 'purchasing_manager'],
    },
    {
      key: '/catalog',
      icon: <DatabaseOutlined />,
      label: 'كتالوج المنتجات',
      roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'after_sales_staff'],
    },
    {
      key: '/purchases',
      icon: <FileTextOutlined />,
      label: 'إدخال المشتريات',
      roles: ['system_admin', 'purchasing_manager'],
    },
    {
      key: '/manufacturing',
      icon: <BuildOutlined />,
      label: 'عمليات التصنيع',
      roles: ['system_admin', 'branch_manager', 'purchasing_manager'],
    },
    {
      key: '/invoices',
      icon: <FileTextOutlined />,
      label: 'الفواتير والمرتجعات',
      roles: ['system_admin', 'branch_manager', 'sales_manager'],
    },
    {
      key: '/transfers',
      icon: <SwapOutlined />,
      label: 'تحويلات المخزون',
      roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager'],
    },
    {
      key: '/treasury',
      icon: <DollarOutlined />,
      label: 'الحسابات والخزينة',
      roles: ['system_admin', 'branch_manager'],
    },
    {
      key: '/vouchers',
      icon: <DollarOutlined />,
      label: 'سندات القبض والصرف',
      roles: ['system_admin', 'branch_manager', 'accountant', 'sales_manager'],
    },
    {
      key: '/general-ledger',
      icon: <BookOutlined />,
      label: 'الأستاذ العام والقيود',
      roles: ['system_admin', 'accountant'],
    },
    {
      key: '/loyalty',
      icon: <GiftOutlined />,
      label: 'خدمة ما بعد البيع',
      roles: ['system_admin', 'after_sales_staff'],
    },
    {
      key: '/audit',
      icon: <HistoryOutlined />,
      label: 'سجل العمليات',
      roles: ['system_admin', 'branch_manager'],
    },
    {
      key: '/inspections',
      icon: <MobileOutlined />,
      label: 'المعاينات',
      roles: ['system_admin', 'branch_manager', 'sales_manager', 'after_sales_staff'],
    },
    {
      key: '/reports',
      icon: <FileTextOutlined />,
      label: 'التقارير والإحصائيات',
      roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager'],
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: 'إعدادات القوائم',
      roles: ['system_admin', 'branch_manager'],
    },
  ];

  // Filter items based on active user role
  const userRole = user?.role || 'sales_rep';
  const filteredMenuItems = menuItems
    .filter((item) => item.roles.includes(userRole))
    .map(({ key, icon, label }) => ({ key, icon, label }));

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

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

  // Generate breadcrumb items based on current pathname
  const pathSnippets = location.pathname.split('/').filter((i) => i);
  const breadcrumbItems = [
    {
      key: 'home',
      title: (
        <span onClick={() => navigate('/dashboard')} style={{ cursor: 'pointer' }}>
          الرئيسية
        </span>
      ),
    },
    ...pathSnippets.map((snippet, index) => {
      const url = `/${pathSnippets.slice(0, index + 1).join('/')}`;
      const menuItem = menuItems.find((item) => item.key === url);
      const title = menuItem ? menuItem.label : snippet;
      return {
        key: url,
        title: (
          <span onClick={() => navigate(url)} style={{ cursor: 'pointer' }}>
            {title}
          </span>
        ),
      };
    }),
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
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
          <div
            className="logo"
            style={{
              height: 64,
              margin: 16,
              flexShrink: 0,
              background: '#6AB42D',
              color: '#fff',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 8,
              fontSize: collapsed ? '16px' : '20px',
              fontWeight: 'bold',
              transition: 'all 0.2s',
            }}
          >
            {collapsed ? 'T' : 'Techno Therm'}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <Menu
              theme="light"
              mode="inline"
              selectedKeys={[location.pathname]}
              items={filteredMenuItems}
              onClick={handleMenuClick}
              style={{ borderInlineEnd: 0 }}
            />
          </div>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
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
        <Content style={{ margin: '16px 24px 0', display: 'flex', flexDirection: 'column' }}>
          <Breadcrumb style={{ margin: '0 0 16px 0' }} items={breadcrumbItems} />
          <div
            style={{
              padding: 24,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              flex: 1,
              overflowY: 'auto',
            }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
