/**
 * The system's navigation tree, arranged the way the client's people already work.
 *
 * It mirrors the a5 menu they are migrating from — same seven sections, same order, same names,
 * same nesting — because the cost of a rearranged menu is not aesthetic: a storekeeper who knows
 * «اذن تحويل مخازن» lives under «اداره المخازن» finds it without being taught, and if we put it
 * somewhere more logical to us, he asks someone. Every screen relocated is a question asked.
 *
 * What is ours and stays ours: the colours, the typography, the components. This file decides
 * arrangement, not appearance.
 *
 * Two levels of nesting on purpose. Theirs has section → group → screen (تقارير مبيعات ▾ holds six
 * reports), and flattening it would put sixteen report names directly under المبيعات, which is the
 * flat-list problem the previous grouping was built to escape.
 *
 * `roles` is declared per SCREEN, never per group: a group is a heading, not a permission. A group
 * left with no permitted screen disappears rather than showing an empty heading, which reads as
 * something broken.
 */

export interface NavScreen {
  /** The route. `?` query included where a screen is a preset view of a shared one. */
  key: string;
  label: string;
  roles: string[];
  /** Their path, kept so the mapping stays auditable against `specs/031-a5-restructure/ia-map.md`. */
  a5?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  children: (NavScreen | NavGroup)[];
}

export function isGroup(node: NavScreen | NavGroup): node is NavGroup {
  return (node as NavGroup).children !== undefined;
}

// --- role shorthands ------------------------------------------------------------------------
// Written out per screen below, but composed from these so a change to "who sees the books" is one
// edit rather than twenty.
const ADMIN = ['system_admin'];
const OFFICE = ['system_admin', 'branch_manager'];
const SALES = ['system_admin', 'branch_manager', 'sales_manager'];
const BUYING = ['system_admin', 'branch_manager', 'purchasing_manager'];
const STOCK = ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager'];
const BOOKS = ['system_admin', 'branch_manager', 'accountant'];
/** Read-only roles are added to a screen only when the screen is genuinely just for looking. */
const R = (base: string[]) => [...base, 'viewer'];

export const NAVIGATION: NavGroup[] = [
  // ١) اداره الانشاءات — master data. Theirs lists all twelve as separate screens; ours had four of
  // them buried inside two combined screens, which is why someone arriving from a5 could not find
  // «المخازن» or «الحسابات الفرعيه» at all.
  {
    key: 'grp-setup',
    label: 'اداره الانشاءات',
    children: [
      { key: '/categories', label: 'فئات الاصناف', roles: R(STOCK), a5: '/categories' },
      { key: '/catalog', label: 'الأصناف', roles: R(STOCK), a5: '/items' },
      { key: '/employees', label: 'الموظفين', roles: OFFICE, a5: '/employees' },
      { key: '/customers', label: 'العملاء', roles: R([...SALES, 'after_sales_staff']), a5: '/clients' },
      { key: '/suppliers', label: 'الموردين', roles: R(BUYING), a5: '/suppliers' },
      { key: '/warehouses', label: 'المخازن', roles: R(STOCK), a5: '/stores' },
      { key: '/branches', label: 'الفروع', roles: OFFICE, a5: '/branches' },
      { key: '/treasuries', label: 'الخزينه و البنوك', roles: R(BOOKS), a5: '/payment-methods' },
      { key: '/main-accounts', label: 'الحسابات الرئيسيه', roles: R(BOOKS), a5: '/mainaccounts' },
      { key: '/sub-accounts', label: 'الحسابات الفرعيه', roles: R(BOOKS), a5: '/subaccounts' },
      { key: '/fixed-assets', label: 'الاصول الثابتة', roles: R(BOOKS), a5: '/fixed-assets' },
      { key: '/cost-centers', label: 'مراكز التكلفة', roles: R(BOOKS), a5: '/cost_centers' },
    ],
  },

  // ٢) اداره المبيعات
  {
    key: 'grp-sales',
    label: 'اداره المبيعات',
    children: [
      { key: '/invoices', label: 'فاتوره بيع', roles: R(SALES), a5: '/sales/create' },
      { key: '/returns', label: 'مردود مبيعات', roles: R(SALES), a5: '/salesreturns/create' },
      // كاشير مباشر is deliberately absent — excluded at the client's request.
      {
        key: 'grp-sales-reports',
        label: 'تقارير مبيعات',
        children: [
          { key: '/trade-reports?view=sales-invoices', label: 'مبيعات فواتير', roles: R(SALES), a5: '/sales/invoice-search' },
          { key: '/trade-reports?view=sales-invoices-grouped', label: 'مجمع مبيعات فواتير', roles: R(SALES), a5: '/sales/invoice-grouped' },
          { key: '/trade-reports?view=sales-items', label: 'مبيعات اصناف', roles: R(SALES), a5: '/sales/itemsearch' },
          { key: '/trade-reports?view=sales-items-grouped', label: 'مبيعات اصناف مجمعة', roles: R(SALES), a5: '/sales/item-grouped' },
          { key: '/trade-reports?view=invoice-profits', label: 'ارباح فواتير', roles: OFFICE, a5: '/invoicesprofits' },
          { key: '/trade-reports?view=item-profits', label: 'ارباح اصناف', roles: OFFICE, a5: '/sales/itemprofits' },
        ],
      },
      {
        key: 'grp-sales-return-reports',
        label: 'تقارير مردرد مبيعات',
        children: [
          { key: '/trade-reports?view=sales-return-items', label: 'مرتجعات أصناف المبيعات', roles: R(SALES), a5: '/salesreturns/itemsearch' },
        ],
      },
      {
        key: 'grp-reservations',
        label: 'الحجوزات',
        children: [
          { key: '/reservations', label: 'حجز عملاء', roles: SALES, a5: '/reservations/create' },
        ],
      },
      {
        key: 'grp-sale-orders',
        label: 'طلبات بيع',
        children: [
          { key: '/orders?kind=sale', label: 'طلب بيع', roles: R(SALES), a5: '/saleorders/create' },
        ],
      },
      {
        key: 'grp-rep-reports',
        label: 'تقارير مندوبين',
        children: [
          { key: '/rep-reports?view=collections', label: 'تحصيلات المندوبين', roles: R(SALES), a5: '/salesagentscollections' },
          { key: '/rep-reports?view=collections-by-customer', label: 'تحصيلات المندوبين عملاء', roles: R(SALES), a5: '/salesagentsclients' },
          { key: '/rep-reports?view=items', label: 'مبيعات اصناف مندوبين', roles: R(SALES), a5: '/salesagentsitems' },
          { key: '/finance-reports?tab=commissions', label: 'عمولة تحصيلات مندوبين', roles: OFFICE, a5: '/salesagentcommission' },
        ],
      },
      {
        key: 'grp-margin',
        label: 'هامش مبيعات',
        children: [
          { key: '/trade-reports?view=margin-by-store', label: 'هامش مبيعات مخازن', roles: OFFICE, a5: '/sales/reports/store-margin' },
          { key: '/trade-reports?view=margin-by-customer', label: 'هامش مبيعات عملاء', roles: OFFICE, a5: '/sales/reports/customer-margin' },
        ],
      },
    ],
  },

  // ٣) اداره المشتريات
  {
    key: 'grp-purchasing',
    label: 'اداره المشتريات',
    children: [
      { key: '/purchases', label: 'فاتوره شراء', roles: R(BUYING), a5: '/purchases/create' },
      { key: '/purchase-returns', label: 'مردودات شراء', roles: R(BUYING), a5: '/purchasesreturns/create' },
      {
        key: 'grp-purchase-reports',
        label: 'تقارير مشتريات',
        children: [
          { key: '/trade-reports?view=purchase-invoices', label: 'مشتريات فواتير', roles: R(BUYING), a5: '/purchases/invoice-search' },
          { key: '/trade-reports?view=purchase-invoices-grouped', label: 'مجمع مشتريات فواتير', roles: R(BUYING), a5: '/purchases/invoice-grouped' },
          { key: '/trade-reports?view=purchase-items', label: 'مشتريات اصناف', roles: R(BUYING), a5: '/purchases/itemsearch' },
          { key: '/trade-reports?view=purchase-items-grouped', label: 'مشتريات اصناف مجمعة', roles: R(BUYING), a5: '/purchases/item-grouped' },
        ],
      },
      {
        key: 'grp-purchase-return-reports',
        label: 'تقارير مردرد مشتريات',
        children: [
          { key: '/trade-reports?view=purchase-return-items', label: 'مرتجعات أصناف المشتريات', roles: R(BUYING), a5: '/purchasesreturns/itemsearch' },
        ],
      },
      {
        key: 'grp-purchase-orders',
        label: 'طلبات شراء',
        children: [
          { key: '/orders?kind=purchase', label: 'طلب شراء', roles: R(BUYING), a5: '/purchaseorders/create' },
        ],
      },
    ],
  },

  // ٤) اداره المخازن
  {
    key: 'grp-stock',
    label: 'اداره المخازن',
    children: [
      { key: '/stock-balance', label: 'رصيد صنف', roles: R(STOCK), a5: '/storelog' },
      { key: '/item-card', label: 'كارت الصنف', roles: R(STOCK), a5: '/store/report' },
      {
        key: 'grp-count',
        label: 'جرد',
        children: [
          { key: '/stocktake?mode=count', label: 'جرد المخازن', roles: STOCK, a5: '/inventorycount' },
          { key: '/stocktake?mode=general', label: 'جرد عام المخازن', roles: STOCK, a5: '/generalinventorycount' },
          { key: '/stocktake?mode=as-of', label: 'جرد حتى تاريخ', roles: R(STOCK), a5: '/inventory/period-inventory' },
        ],
      },
      {
        key: 'grp-permit-in',
        label: 'إذن إضافة',
        children: [
          { key: '/stock-permits?kind=receipt', label: 'إذن إضافة', roles: STOCK, a5: '/storeins/create' },
        ],
      },
      {
        key: 'grp-permit-out',
        label: 'إذن صرف',
        children: [
          { key: '/stock-permits?kind=issue', label: 'إذن صرف', roles: STOCK, a5: '/storeouts/create' },
        ],
      },
      {
        key: 'grp-transfer',
        label: 'اذن تحويل مخازن',
        children: [
          { key: '/transfers', label: 'اذون التحويل', roles: R(STOCK), a5: '/storetransfers' },
        ],
      },
      {
        key: 'grp-stock-reports',
        label: 'تقارير المخازن',
        children: [
          { key: '/stock-alerts?view=reorder', label: 'حد اعادة الطلب', roles: R(STOCK), a5: '/inventory/restock-alert' },
          { key: '/reports?view=stagnant', label: 'اصناف راكدة', roles: R(STOCK), a5: '/stagnant-items' },
          { key: '/serials', label: 'السرايل', roles: R(STOCK), a5: '/serials' },
          { key: '/serials?view=movements', label: 'حركات سرايل', roles: R(STOCK), a5: '/serialtransactions' },
          { key: '/expiry?view=movements', label: 'حركات انتهاء الصلاحية', roles: R(STOCK), a5: '/expiretransactions' },
          { key: '/stock-alerts?tab=expiring', label: 'كميات انتهاء الصلاحية', roles: R(STOCK), a5: '/expirequantities' },
          { key: '/price-display', label: 'شاشة معلومات المنتج', roles: R(STOCK), a5: '/price-display-screen' },
        ],
      },
    ],
  },

  // ٥) اداره الحسابات
  {
    key: 'grp-accounts',
    label: 'اداره الحسابات',
    children: [
      { key: '/account-statement', label: 'كشف حساب', roles: R(BOOKS), a5: '/entriesreport' },
      { key: '/general-ledger?tab=journal', label: 'قيد حر', roles: BOOKS, a5: '/entries' },
      { key: '/treasury', label: 'حركة خزينه', roles: R(BOOKS), a5: '/draweraction' },
      {
        key: 'grp-balances',
        label: 'الأرصدة',
        children: [
          { key: '/finance-reports?tab=aging&side=customers', label: 'مديونيه عملاء', roles: R(BOOKS), a5: '/client-receivables' },
          { key: '/finance-reports?tab=aging&side=suppliers', label: 'ارصده موردين', roles: R(BOOKS), a5: '/supplier-payables' },
          { key: '/general-ledger?tab=chart', label: 'أرصدة الحسابات', roles: R(BOOKS), a5: '/account-balances' },
        ],
      },
      {
        key: 'grp-notes',
        label: 'أوراق قبض ودفع',
        children: [
          { key: '/vouchers?tab=cheques&direction=incoming', label: 'أوراق قبض', roles: R(BOOKS), a5: '/notes-receivable' },
          { key: '/vouchers?tab=cheques&direction=outgoing', label: 'أوراق دفع', roles: R(BOOKS), a5: '/notes-payable' },
        ],
      },
      {
        key: 'grp-acct-reports',
        label: 'تقارير المحاسبية',
        children: [
          { key: '/general-ledger?tab=trial', label: 'دفتر الإستاذ', roles: R(BOOKS), a5: '/ledger' },
          { key: '/finance-reports?view=balance-sheet', label: 'ميزانية ختامية', roles: R(BOOKS), a5: '/finalbalancesheet' },
          { key: '/finance-reports?view=balance-sheet-period', label: 'ميزانية خلال فترة', roles: R(BOOKS), a5: '/period-balancesheet' },
          { key: '/finance-reports?view=financial-position', label: 'مركز مالي وقائمة الدخل', roles: R(BOOKS), a5: '/financialposition' },
          { key: '/finance-reports?view=financial-position-period', label: 'مركز مالي وقائمة الدخل خلال فترة', roles: R(BOOKS), a5: '/period-financialposition' },
        ],
      },
    ],
  },

  // ٦) ادارة انتاج
  {
    key: 'grp-production',
    label: 'ادارة انتاج',
    children: [
      { key: '/manufacturing?tab=recipes', label: 'نسب انتاج', roles: BUYING, a5: '/production-proportions' },
      { key: '/free-production', label: 'انتاج حر', roles: BUYING, a5: '/productions/free' },
      { key: '/manufacturing?tab=orders', label: 'انتاج حسب النسب', roles: BUYING, a5: '/productions/proportion' },
      { key: '/reports?view=production', label: 'تقرير الانتاج', roles: R(BUYING), a5: '/productions/report' },
    ],
  },

  // ٧) الاعدادات
  {
    key: 'grp-settings',
    label: 'الاعدادات',
    children: [
      { key: '/users', label: 'المستخدمين', roles: OFFICE, a5: '/userscontroller' },
      { key: '/stock-permits?tab=opening', label: 'أول المدة', roles: OFFICE, a5: '/beginning' },
      { key: '/settings', label: 'اعدادات القاعدة', roles: OFFICE, a5: '/database/settings' },
      { key: '/settings?section=integrity', label: 'أدوات خاصة', roles: ADMIN, a5: '/database/systemtools' },
    ],
  },
];

/** Screens outside the tree: where everyone lands, not a section to open. */
export const HOME_SCREEN: NavScreen = {
  key: '/dashboard',
  label: 'الرئيسية',
  roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager',
    'after_sales_staff', 'accountant', 'viewer'],
};

/**
 * Screens we keep that theirs has no equivalent for. They live at the end so the mirrored part of
 * the menu reads exactly like the system people are coming from, and the extra sits after it rather
 * than interrupting it.
 */
export const EXTRA_SECTIONS: NavGroup[] = [
  {
    key: 'grp-extra',
    label: 'إضافات تكنو ثيرم',
    children: [
      { key: '/coupon-receipts', label: 'استلام الكوبونات', roles: [...SALES, 'after_sales_staff'] },
      { key: '/loyalty', label: 'خدمة ما بعد البيع والنقاط', roles: ['system_admin', 'after_sales_staff'] },
      { key: '/inspections', label: 'المعاينات', roles: R([...SALES, 'after_sales_staff']) },
      { key: '/inspection-items', label: 'أصناف المعاينة', roles: OFFICE },
      { key: '/audit', label: 'سجل العمليات', roles: OFFICE },
    ],
  },
];

/** Every screen in the tree, flattened — used to check a role may open a route at all. */
export function allScreens(nodes: (NavScreen | NavGroup)[] = [...NAVIGATION, ...EXTRA_SECTIONS]): NavScreen[] {
  return nodes.flatMap((n) => (isGroup(n) ? allScreens(n.children) : [n]));
}
