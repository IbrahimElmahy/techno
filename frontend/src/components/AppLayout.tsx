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
} from '@ant-design/icons';
import {
  NAVIGATION, EXTRA_SECTIONS, HOME_SCREEN, isGroup, NavGroup, NavScreen,
} from './navigation';
import { useAuth, RoleName, roleForAccess } from './AuthProvider';
import RowDensityControl from './RowDensity';
import NumeralsControl from './Numerals';
import { bindNumeralsUser } from '../utils/numerals';
import { useFullscreen } from './FullscreenToggle';
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
  owner: 'المالك',
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

/** One icon per top-level section. Their menu has no icons; ours does, and it costs nothing. */
const SECTION_ICONS: Record<string, React.ReactNode> = {
  'grp-setup': <ApartmentOutlined />,
  'grp-sales': <ShopOutlined />,
  'grp-purchasing': <ShoppingCartOutlined />,
  'grp-stock': <DatabaseOutlined />,
  'grp-accounts': <DollarOutlined />,
  'grp-production': <BuildOutlined />,
  'grp-settings': <SettingOutlined />,
  'grp-extra': <MobileOutlined />,
  // شاشة مستقلة في الشريط، مش قسم — ليها أيقونتها زي أي مدخل.
  '/voucher-keys': <KeyOutlined />,
};

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  /**
   * القايمة بقت فوق، والشجرة الجانبية بقت اختيارية — زي أودو.
   *
   * الشجرة كانت واخدة ٢٥٠ بكسل من عرض كل شاشة عشان تعرض نفس الأقسام اللي الشريط
   * الأفقي بيعرضها في ٤٤ بكسل من الطول. الجداول هي اللي بتستفيد بالعرض ده.
   *
   * **بتتخبى مش بتتشال.** الترتيب نفسه متعمّد يحاكي a5 عشان اللي عارف مكان حاجة
   * يلاقيها — والشريط الأفقي بيعرض **نفس** الشجرة بنفس الأسماء والترتيب، فاللي
   * حافظ «اذن تحويل مخازن تحت اداره المخازن» بيلاقيها في نفس المكان بالظبط، بس
   * أفقي. واللي عايز الشجرة ترجع بيضغط زرار واحد فوق.
   */
  const [showTree, setShowTree] = useState(() => {
    try { return localStorage.getItem('nav.tree') === '1'; } catch { return false; }
  });
  const toggleTree = () => setShowTree((v) => {
    // بيتفضّل: اللي بيشتغل بالشجرة مايرجعش يفتحها كل يوم.
    try { localStorage.setItem('nav.tree', v ? '0' : '1'); } catch { /* private mode */ }
    return !v;
  });
  const { user, logout } = useAuth();
  const { activeId, openTab } = useTabs();
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  /*
   * شكل الأرقام متخزّن باسم المستخدم، والربط بيتعمل من هنا.
   *
   * المخزن بيقرا الاسم من الجلسة مرة واحدة وقت تحميل الموديول، وده كفاية لفتحة
   * الصفحة. إنما اللي يخرج ويدخل بحساب تاني من غير تحديث كان هياخد اختيار اللي
   * قبله — فالربط بيتعاد كل ما المستخدم يتغيّر.
   */
  useEffect(() => { bindNumeralsUser(user?.username ?? null); }, [user?.username]);

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
  // The tree itself lives in `navigation.ts` — it mirrors the a5 menu the client's people already
  // know, section for section. See that file for why the arrangement is copied and the appearance
  // is not.
  const userRole = user ? roleForAccess(user.role) : 'sales_rep';

  /**
   * Build antd's menu items from the tree, dropping what this role may not open.
   *
   * Recursive because the tree is two deep (section → group → screen), and filtering has to happen
   * at the leaves: a group is a heading, not a permission. A group left with nothing permitted is
   * removed rather than rendered empty, since a heading over an empty list reads as broken.
   */
  const showsFactoryTools = useShowsFactoryTools();
  const buildItems = (nodes: (NavScreen | NavGroup)[]): any[] =>
    nodes
      .map((node) => {
        if (!isGroup(node)) {
          return node.roles.includes(userRole) ? { key: node.key, label: node.label } : null;
        }
        // قسم المصنع بيتشال من غير فرع التصنيع — زي ما المجموعة اللي مافيهاش صلاحية
        // بتتشال. الشرح في `navigation.ts` و`useFactoryBranch`.
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

  // Open every ancestor of the active screen, so a tab restored on load never leaves the sidebar
  // shut around a highlighted item nobody can see — with two levels, opening only the section
  // would still hide a report inside its group.
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
      /*
       * ارتفاع الصف وملء الشاشة نزلوا هنا من الشريط.
       *
       * الاتنين إعدادات بتتظبط مرة كل كام يوم، وكانوا واخدين مكان دايم في صف بيتزاحم
       * على عرضه مع أقسام النظام كلها. الاسم كمان اتشال من جنب الأيقونة: الأيقونة
       * بتقول «ده انت» والاسم جوّه القايمة، واللي بيسأل «انا داخل بمين» بيفتحها.
       */
      key: 'density',
      label: (
        // الوقفة دي عشان اختيار الارتفاع مايقفلش القايمة — بتتجرّب على الجدول اللي
        // وراها، واللي بيجرّب بيعدّي على التلاتة.
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '2px 0' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>ارتفاع الصف</div>
          <RowDensityControl />
        </div>
      ),
    },
    {
      // نفس وقفة الحدث: اللي بيجرّب الشكلين بيبص على الجدول اللي ورا القايمة وهو بيبدّل.
      key: 'numerals',
      label: (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '2px 0' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>شكل الأرقام</div>
          <NumeralsControl />
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
        // `display: none` مش إلغاء المكوّن: الشجرة بتفضل محمّلة ومفتوحة على نفس
        // المجموعة، فالرجوع ليها بيرجّعها زي ما سبتها مش من أولها.
        style={{
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 10,
          height: '100vh',
          overflow: 'hidden',
          display: showTree ? undefined : 'none',
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
        {/*
          * شريط واحد فوق: الأقسام والمستخدم، وخلاص.
          *
          * كانوا تلات شرايط — اسم المستخدم، وتبويبات المستندات المفتوحة، والأقسام —
          * يعني ١٤٠ بكسل من طول الشاشة بتروح في حاجة مش داتا. بقوا صف واحد بارتفاع ٤٨.
          *
          * وقايمة الأقسام بتلمّ الزيادة تحت «…» لما الشاشة تصغر، فمابتدفعش حاجة لسطر تاني.
          */}
        <Header
          style={{
            flexShrink: 0,
            // `minHeight` مش `height`: لما القايمة تلفّ لسطر تاني الشريط بيطول معاها
            // بدل ما البنود تتقصّ.
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
          {/* العلامة كانت عايشة في الشجرة، والشجرة بقت مخبية — فنقلت هنا. النظام
              من غير علامة بيبان كأنه اتفتح غلط. */}
          {!showTree && (
            <div style={{ paddingInlineStart: 12, display: 'flex', alignItems: 'center' }}>
              <Logo variant="mark" width={26} />
            </div>
          )}
          {/* الشجرة اختيارية دلوقتي — الزرار بيظهّرها ويخبّيها، والاختيار بيتفضّل. */}
          <Tooltip title={showTree ? 'إخفاء القائمة الجانبية' : 'إظهار القائمة الجانبية'}>
            <Button
              type="text"
              icon={showTree ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={toggleTree}
              style={{ fontSize: 16, width: 44, height: 44, flexShrink: 0 }}
            />
          </Tooltip>
          {/*
            * الأقسام — نفس شجرة `navigation.ts` بالظبط، بس أفقي.
            *
            * نفس الترتيب ونفس الأسماء ونفس التداخل: الترتيب متعمّد يحاكي a5 عشان اللي
            * عارف مكان حاجة يلاقيها من غير ما يسأل. اللي اتغيّر هو الاتجاه وبس.
            *
            * الأيقونات بتتشال: على الشجرة كانت بتفرّق الأقسام بالعين وهي فوق بعض؛ في صف
            * أفقي هي اللي بتاكل العرض اللي الأسماء محتاجاه.
            */}
          <Menu
            mode="horizontal"
            selectedKeys={[activeBase]}
            items={filteredMenuItems.map(({ icon, ...rest }: any) => rest)}
            onClick={handleMenuClick}
            /*
             * `disabledOverflow` — الأقسام كلها بتتعرض، ومفيش «…» بتلمّ الزيادة.
             *
             * القايمة الافتراضية بتقيس العرض وبتخبّي اللي مش لاقي مكان تحت تلات نقط.
             * ده منطقي في شريط أدوات، وغلط في قايمة تنقّل: القسم اللي اتخبى بيبقى
             * موجود ومش باين، واللي بيدوّر عليه بيفتكره مش موجود. لما المكان يضيق
             * بتلفّ لسطر تاني — سطر زيادة أرخص من قسم مختفي.
             */
            disabledOverflow
            className="top-nav"
            style={{
              flex: '0 1 auto', minWidth: 0, borderBottom: 'none',
              background: 'transparent',
            }}
          />

          {/* المساحة الفاضية بتدفع المستخدم لآخر الشريط. */}
          <div style={{ flex: 1, minWidth: 0 }} />

          <div style={{
            paddingLeft: 16, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          }}>
            {/* الأيقونة وبس — الاسم والإعدادات جوّه القايمة. الصف العلوي شغله يعرض
                الأقسام، وكل بكسل بياخده حاجة تانية بيتاخد منها. */}
            <Dropdown menu={{ items: userDropdownItems }} placement="bottomLeft">
              <Tooltip title={user?.name}>
                <Avatar size={28} style={{ backgroundColor: '#6AB42D', cursor: 'pointer' }}
                        icon={<UserOutlined />} />
              </Tooltip>
            </Dropdown>
          </div>
        </Header>

        {/* minHeight:0 lets this flex child actually shrink, so the box below can scroll
            instead of stretching the page. */}
        <Content style={{
          margin: '10px 16px 0', display: 'flex', flexDirection: 'column',
          minHeight: 0, overflow: 'hidden',
        }}>
          <div
            style={{
              padding: 16,
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
    </Layout>
  );
}
