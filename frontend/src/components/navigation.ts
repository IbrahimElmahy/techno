export interface NavScreen {
  key: string;
  label: string;
  roles: string[];
  a5?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  children: (NavScreen | NavGroup)[];
  factoryOnly?: boolean;
}

export function isGroup(node: NavScreen | NavGroup): node is NavGroup {
  return (node as NavGroup).children !== undefined;
}

const ADMIN = ['system_admin'];
const OFFICE = ['system_admin', 'branch_manager'];
const SALES = ['system_admin', 'branch_manager', 'sales_manager'];
const BUYING = ['system_admin', 'branch_manager', 'purchasing_manager'];
const STOCK = ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager'];
const BOOKS = ['system_admin', 'branch_manager', 'accountant'];
const R = (base: string[]) => [...base, 'viewer'];
const HR = ['system_admin', 'branch_manager', 'accountant'];
const LOYALTY = ['system_admin', 'branch_manager', 'after_sales_staff', 'viewer'];
const SALARY = ['system_admin', 'accountant'];
const FLEET = ['system_admin', 'branch_manager', 'accountant', 'viewer'];

export const NAVIGATION: (NavGroup | NavScreen)[] = [
  { key: '/voucher-keys', label: 'مفاتيح خاصة', roles: R(BOOKS) },
  {
    key: 'grp-setup',
    label: 'اداره الانشاءات',
    children: [
      { key: '/categories', label: 'فئات الاصناف', roles: R(STOCK), a5: '/categories' },
      { key: '/catalog', label: 'الأصناف', roles: R(STOCK), a5: '/items' },
      { key: '/customers', label: 'العملاء', roles: R([...SALES, 'after_sales_staff']), a5: '/clients' },
      { key: '/suppliers', label: 'الموردين', roles: R(BUYING), a5: '/suppliers' },
      { key: '/party-links', label: 'الأطراف المرتبطة', roles: R([...SALES, ...BUYING]) },
      { key: '/warehouses', label: 'المخازن', roles: R(STOCK), a5: '/stores' },
      { key: '/governorates', label: 'المحافظات', roles: OFFICE },
      { key: '/branches', label: 'الفروع', roles: OFFICE, a5: '/branches' },
      { key: '/territories', label: 'المناطق', roles: R(SALES) },
      { key: '/reps', label: 'المناديب', roles: R(SALES) },
      { key: '/treasuries', label: 'الخزينه و البنوك', roles: R(BOOKS), a5: '/payment-methods' },
      { key: '/main-accounts', label: 'الحسابات الرئيسيه', roles: R(BOOKS), a5: '/mainaccounts' },
      { key: '/sub-accounts', label: 'الحسابات الفرعيه', roles: R(BOOKS), a5: '/subaccounts' },
      { key: '/fixed-assets', label: 'الاصول الثابتة', roles: R(BOOKS), a5: '/fixed-assets' },
      { key: '/cost-centers', label: 'مراكز التكلفة', roles: R(BOOKS), a5: '/cost_centers' },
      { key: '/loyalty', label: 'أنواع الكوبونات', roles: R(LOYALTY), a5: '/loyalty' },
    ],
  },

  {
    key: 'grp-sales',
    label: 'اداره المبيعات',
    children: [
      { key: '/invoices', label: 'فاتوره بيع', roles: R(SALES), a5: '/sales/create' },
      { key: '/returns', label: 'مردود مبيعات', roles: R(SALES), a5: '/salesreturns/create' },
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
          { key: '/bonus-report', label: 'تقرير البونص', roles: R(SALES) },
        ],
      },
      { key: '/trade-reports?view=sales-return-items', label: 'تقارير مردود مبيعات', roles: R(SALES), a5: '/salesreturns/itemsearch' },
      { key: '/customer-debts', label: 'مديونيات العملاء', roles: R(SALES) },
      { key: '/orders?kind=sale', label: 'شيت تسعير بيع', roles: R(SALES), a5: '/saleorders/create' },
      {
        key: 'grp-orders-reports',
        label: 'تقارير الطلبات والحجوزات',
        children: [
          { key: '/ops-reports?view=orders-list', label: 'كشف الطلبات', roles: R(SALES) },
          { key: '/ops-reports?view=orders-open', label: 'الطلبات المعلقة', roles: R(SALES) },
          { key: '/ops-reports?view=reservations-open', label: 'الحجوزات المفتوحة', roles: R(SALES) },
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
      { key: '/trade-reports?view=purchase-return-items', label: 'تقارير مردود مشتريات', roles: R(BUYING), a5: '/purchasesreturns/itemsearch' },
      { key: '/orders?kind=purchase', label: 'شيت تسعير شراء', roles: R(BUYING), a5: '/purchaseorders/create' },
    ],
  },

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
          { key: '/stock-sheet?view=count', label: 'جرد المخازن', roles: R(STOCK), a5: '/inventorycount' },
          { key: '/stock-counts', label: 'دورة الجرد (عدّ وتسوية)', roles: STOCK },
          { key: '/stocktake', label: 'جرد حتى تاريخ', roles: R(STOCK), a5: '/inventory/period-inventory' },
        ],
      },
      { key: '/stock-permits?kind=receipt', label: 'إذن إضافة', roles: STOCK, a5: '/storeins/create' },
      { key: '/stock-permits?kind=issue', label: 'إذن صرف', roles: STOCK, a5: '/storeouts/create' },
      { key: '/transfers', label: 'اذن تحويل مخازن', roles: R(STOCK), a5: '/storetransfers' },
      {
        key: 'grp-stock-reports',
        label: 'تقارير المخازن',
        children: [
          { key: '/stock-alerts', label: 'حد اعادة الطلب', roles: R(STOCK), a5: '/inventory/restock-alert' },
          { key: '/reports?view=stagnant', label: 'اصناف راكدة', roles: R(STOCK), a5: '/stagnant-items' },
        ],
      },
    ],
  },

  {
    key: 'grp-accounts',
    label: 'اداره الحسابات',
    children: [
      { key: '/accounting', label: 'لوحة المحاسبة', roles: R(BOOKS) },
      { key: '/account-statement', label: 'كشف حساب', roles: R(BOOKS), a5: '/entriesreport' },
      { key: '/general-ledger?tab=journal', label: 'قيد حر', roles: BOOKS, a5: '/entries' },
      { key: '/treasury', label: 'حركة خزينه', roles: R(BOOKS), a5: '/draweraction' },
      { key: '/partners-current', label: 'جاري الشركاء', roles: R(BOOKS) },
      { key: '/reconciliation?tab=open', label: 'تسوية — المفتوح', roles: BOOKS },
      { key: '/reconciliation?tab=matched', label: 'تسوية — المطابَق', roles: BOOKS },
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
        key: 'grp-vouchers',
        label: 'سندات',
        children: [
          { key: '/vouchers?tab=receipt', label: 'سند قبض', roles: R(BOOKS) },
          { key: '/vouchers?tab=payment', label: 'سند صرف', roles: R(BOOKS) },
          { key: '/vouchers?tab=handover', label: 'توريد مندوب', roles: R(BOOKS) },
          { key: '/vouchers?tab=expense', label: 'سند مصروف', roles: R(BOOKS) },
          { key: '/vouchers?tab=transfer', label: 'تحويل بين الخزن', roles: R(BOOKS) },
          { key: '/vouchers?tab=treasury-movement', label: 'حركة الخزينة', roles: R(BOOKS) },
          { key: '/vouchers?tab=statement', label: 'كشف حساب السندات', roles: R(BOOKS) },
        ],
      },
      {
        key: 'grp-notes',
        label: 'أوراق قبض ودفع',
        children: [
          { key: '/vouchers?tab=cheques&direction=incoming', label: 'أوراق قبض', roles: R(BOOKS), a5: '/notes-receivable' },
          { key: '/vouchers?tab=cheques&direction=outgoing', label: 'أوراق دفع', roles: R(BOOKS), a5: '/notes-payable' },
          { key: '/ops-reports?view=cheque-wallet', label: 'محفظة الشيكات', roles: R(BOOKS) },
          { key: '/ops-reports?view=cheques-due-soon', label: 'شيكات تستحق قريباً', roles: R(BOOKS) },
          { key: '/ops-reports?view=cheques-by-status', label: 'الشيكات بالحالة', roles: R(BOOKS) },
        ],
      },
      {
        key: 'grp-journals',
        label: 'دفاتر اليومية',
        children: [
          { key: '/general-ledger?tab=journals', label: 'الدفاتر', roles: R(BOOKS) },
          { key: '/general-ledger?tab=integrity', label: 'سلامة الدفاتر', roles: R(BOOKS) },
        ],
      },
      {
        key: 'grp-acct-reports',
        label: 'تقارير المحاسبية',
        children: [
          { key: '/general-ledger?tab=trial', label: 'دفتر الإستاذ', roles: R(BOOKS), a5: '/ledger' },
          { key: '/finance-reports?tab=partner', label: 'دفتر الشريك', roles: R(BOOKS) },
          { key: '/finance-reports?tab=sheet', label: 'ميزانية ختامية', roles: R(BOOKS), a5: '/finalbalancesheet' },
          { key: '/finance-reports?tab=sheet&period=1', label: 'ميزانية خلال فترة', roles: R(BOOKS), a5: '/period-balancesheet' },
          { key: '/finance-reports?tab=income', label: 'مركز مالي وقائمة الدخل', roles: R(BOOKS), a5: '/financialposition' },
          { key: '/finance-reports?tab=income&period=1', label: 'مركز مالي وقائمة الدخل خلال فترة', roles: R(BOOKS), a5: '/period-financialposition' },
          { key: '/income-sheet', label: 'قائمة الدخل (فئات وتكاليف)', roles: R(BOOKS) },
          { key: '/finance-reports?tab=cashflow', label: 'التدفق النقدي', roles: R(BOOKS) },
          { key: '/profitability?view=cost-centers', label: 'أرباح مراكز التكلفة', roles: R(BOOKS) },
          { key: '/profitability?view=branches', label: 'مقارنة الفروع', roles: R(BOOKS) },
          { key: '/finance-reports?tab=vat', label: 'الإقرار الضريبي', roles: R(BOOKS) },
        ],
      },
      {
        key: 'grp-period-closing',
        label: 'إقفال الفترة',
        children: [
          { key: '/period-closing?view=package', label: 'حزمة الإقفال', roles: R(BOOKS) },
          { key: '/period-closing?view=inventory', label: 'تقييم المخزون', roles: R(BOOKS) },
          { key: '/period-closing?view=balances', label: 'ملخص الأرصدة', roles: R(BOOKS) },
          { key: '/period-closing?view=balance-sheet', label: 'الميزانية العمومية الإدارية', roles: R(BOOKS) },
          { key: '/period-closing?view=settlement', label: 'تسوية فرع / منطقة', roles: R(BOOKS) },
          { key: '/period-closing?view=advances', label: 'سلف الموظفين في تاريخ', roles: R(BOOKS) },
        ],
      },
    ],
  },

  {
    key: 'grp-production',
    label: 'ادارة انتاج',
    factoryOnly: true,
    children: [
      { key: '/manufacturing?tab=recipes', label: 'نسب انتاج', roles: BUYING, a5: '/production-proportions' },
      { key: '/free-production', label: 'انتاج حر', roles: BUYING, a5: '/productions/free' },
      { key: '/ratio-production', label: 'انتاج حسب النسب', roles: BUYING, a5: '/productions/proportion' },
      { key: '/reports?view=production', label: 'تقرير الانتاج', roles: R(BUYING), a5: '/productions/report' },
    ],
  },

  {
    key: 'grp-hr',
    label: 'اداره الموارد البشرية',
    children: [
      { key: '/employees', label: 'الموظفين', roles: HR, a5: '/employees' },
      { key: '/departments', label: 'الأقسام', roles: HR },
      { key: '/attendance', label: 'الحضور والانصراف', roles: HR },
      { key: '/attendance?tab=entry', label: 'إدخال حضور', roles: HR },
      { key: '/attendance?tab=import', label: 'استيراد بصمة', roles: HR },
      { key: '/leave', label: 'الإجازات', roles: HR },
      { key: '/leave?tab=balances', label: 'أرصدة الإجازات', roles: HR },
      { key: '/leave?tab=types', label: 'أنواع الإجازات', roles: HR },
      { key: '/employee-salaries', label: 'رواتب الموظفين', roles: SALARY },
      { key: '/payroll-groups', label: 'مجموعات المرتبات', roles: SALARY },
      { key: '/payroll-sheet', label: 'شيت المرتبات', roles: SALARY },
      { key: '/payroll-settings', label: 'شرائح الضريبة والتأمينات', roles: BOOKS },
      { key: '/payroll-settings?tab=components', label: 'بنود الراتب', roles: BOOKS },
      { key: '/payroll-settings?tab=rules', label: 'أرقام المسير', roles: BOOKS },
      { key: '/employee-receivables', label: 'ذمم وسلف الموظفين', roles: BOOKS },
      { key: '/employee-receivables?tab=adjustments', label: 'الجزاءات والمكافآت', roles: SALARY },
      { key: '/commission-settings', label: 'إعدادات العمولات', roles: SALARY },
      { key: '/commission-settings?tab=preview', label: 'معاينة العمولات', roles: SALARY },
      {
        key: 'grp-hr-reports',
        label: 'تقارير الموارد البشرية',
        children: [
          { key: '/hr-reports?view=staff-list', label: 'كشف الموظفين', roles: R(HR) },
          { key: '/hr-reports?view=staff-by-department', label: 'الموظفين بالقسم', roles: R(HR) },
          { key: '/hr-reports?view=staff-by-branch', label: 'الموظفين بالفرع', roles: R(HR) },
          { key: '/hr-reports?view=staff-by-title', label: 'الموظفين بالوظيفة', roles: R(HR) },
          { key: '/hr-reports?view=staff-movement', label: 'الداخلين والخارجين', roles: R(HR) },
          { key: '/hr-reports?view=attendance-sheet', label: 'كشف حضور وانصراف', roles: R(HR) },
          { key: '/hr-reports?view=attendance-by-employee', label: 'ملخص الحضور بالموظف', roles: R(HR) },
          { key: '/hr-reports?view=attendance-by-department', label: 'ملخص الحضور بالقسم', roles: R(HR) },
          { key: '/hr-reports?view=attendance-by-status', label: 'الغياب والتأخير', roles: R(HR) },
          { key: '/hr-reports?view=leave-movement', label: 'حركة الإجازات', roles: R(HR) },
          { key: '/hr-reports?view=leave-by-type', label: 'الإجازات بالنوع', roles: R(HR) },
          { key: '/hr-reports?view=leave-balances', label: 'كشف أرصدة الإجازات', roles: R(HR) },
          { key: '/hr-reports?view=payroll-sheet', label: 'مسير المرتبات', roles: SALARY },
          { key: '/hr-reports?view=payroll-by-month', label: 'المرتبات شهرياً', roles: SALARY },
          { key: '/hr-reports?view=cost-by-component', label: 'تكلفة الأجور بالبند', roles: SALARY },
          { key: '/hr-reports?view=cost-by-department', label: 'تكلفة الأجور بالقسم', roles: SALARY },
          { key: '/hr-reports?view=cost-by-branch', label: 'تكلفة الأجور بالفرع', roles: SALARY },
          { key: '/hr-reports?view=advances-outstanding', label: 'السلف وأرصدتها', roles: SALARY },
          { key: '/hr-reports?view=penalties-bonuses', label: 'كشف الجزاءات والمكافآت', roles: SALARY },
        ],
      },
    ],
  },

  {
    key: 'grp-settings',
    label: 'الاعدادات',
    children: [
      { key: '/users', label: 'المستخدمين', roles: OFFICE, a5: '/userscontroller' },
      { key: '/stock-permits?kind=opening', label: 'أول المدة', roles: OFFICE, a5: '/beginning' },
      { key: '/settings', label: 'اعدادات القاعدة', roles: OFFICE, a5: '/database/settings' },
      { key: '/permissions', label: 'صلاحيات الأدوار', roles: ADMIN },
      { key: '/user-permissions', label: 'صلاحيات المستخدمين', roles: OFFICE },
      { key: '/branch-overview', label: 'نظرة على الفروع', roles: ADMIN },
      { key: '/audit', label: 'سجل العمليات', roles: OFFICE },
    ],
  },
];

export const HOME_SCREEN: NavScreen = {
  key: '/dashboard',
  label: 'الرئيسية',
  roles: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager',
    'after_sales_staff', 'accountant', 'viewer'],
};

export const EXTRA_SECTIONS: NavGroup[] = [
  {
    key: 'grp-extra',
    label: 'خدمات ما بعد البيع',
    children: [
      { key: '/coupon-receipts', label: 'استلام الكوبونات', roles: [...SALES, 'after_sales_staff'] },
      { key: '/coupon-custody', label: 'عهدة الكوبونات', roles: [...SALES, 'after_sales_staff'] },
      { key: '/inspections', label: 'المعاينات', roles: R([...SALES, 'after_sales_staff']) },
      { key: '/visits', label: 'الزيارات العادية', roles: R([...SALES, 'after_sales_staff']) },
      { key: '/owners', label: 'الملّاك', roles: R([...SALES, 'after_sales_staff']) },
      { key: '/inspection-items', label: 'أصناف المعاينة', roles: OFFICE },
      { key: '/points-ledger', label: 'سجل النقاط', roles: LOYALTY },
      {
        key: 'grp-loyalty-reports',
        label: 'تقارير النقاط والكوبونات',
        children: [
          { key: '/ops-reports?view=points-movement', label: 'حركة النقاط', roles: LOYALTY },
          { key: '/ops-reports?view=points-by-customer', label: 'النقاط بالعميل', roles: LOYALTY },
          { key: '/ops-reports?view=points-by-kind', label: 'النقاط بنوع الحركة', roles: LOYALTY },
          { key: '/ops-reports?view=coupons-list', label: 'كشف الكوبونات', roles: LOYALTY },
          { key: '/ops-reports?view=coupons-by-status', label: 'الكوبونات بالحالة', roles: LOYALTY },
          { key: '/ops-reports?view=coupons-by-customer', label: 'الكوبونات بالعميل', roles: LOYALTY },
          { key: '/ops-reports?view=coupon-receipts', label: 'تقرير استلام الكوبونات', roles: LOYALTY },
          { key: '/ops-reports?view=coupon-receipts-by-rep', label: 'استلام الكوبونات بالمندوب', roles: LOYALTY },
        ],
      },
      {
        key: 'grp-followup-reports',
        label: 'تقارير المتابعة',
        children: [
          { key: '/after-sales-reports?tab=distributors', label: 'كوبونات الموزعين', roles: LOYALTY },
          { key: '/after-sales-reports?tab=plumbers', label: 'كوبونات السباكين', roles: LOYALTY },
          { key: '/after-sales-reports?tab=lifecycle', label: 'حركة الكوبون', roles: LOYALTY },
          { key: '/after-sales-reports?tab=technicians', label: 'زيارات الفنيين بالنقاط', roles: R([...SALES, 'after_sales_staff']) },
          { key: '/after-sales-reports?tab=reps', label: 'زيارات المناديب', roles: R([...SALES, 'after_sales_staff']) },
        ],
      },
      {
        key: 'grp-inspection-reports',
        label: 'تقارير المعاينات',
        children: [
          { key: '/ops-reports?view=inspections-list', label: 'كشف المعاينات', roles: R([...SALES, 'after_sales_staff']) },
          { key: '/ops-reports?view=inspections-by-rep', label: 'المعاينات بالمندوب', roles: R([...SALES, 'after_sales_staff']) },
          { key: '/ops-reports?view=inspections-by-kind', label: 'المعاينات بالنوع', roles: R([...SALES, 'after_sales_staff']) },
          { key: '/ops-reports?view=inspections-by-shop', label: 'المعاينات بمحل الشراء', roles: R([...SALES, 'after_sales_staff']) },
          { key: '/ops-reports?view=inspections-by-month', label: 'المعاينات شهرياً', roles: R([...SALES, 'after_sales_staff']) },
        ],
      },
    ],
  },
  {
    key: 'grp-fleet',
    label: 'إدارة السيارات',
    children: [
      { key: '/fleet', label: 'لوحة التحكم', roles: FLEET },
      { key: '/fleet/vehicles', label: 'السيارات', roles: FLEET },
      { key: '/fleet/drivers', label: 'السائقون', roles: FLEET },
      { key: '/fleet/maintenance', label: 'الصيانة', roles: FLEET },
      { key: '/fleet/fuel', label: 'الوقود', roles: FLEET },
      { key: '/fleet/faults', label: 'الأعطال', roles: FLEET },
      { key: '/fleet/violations', label: 'المخالفات', roles: FLEET },
      { key: '/fleet/inspections', label: 'الفحص اليومي', roles: FLEET },
      { key: '/fleet/monthly', label: 'التقرير الشهري', roles: FLEET },
      { key: '/fleet/tasks', label: 'مهام مسؤول الأسطول', roles: FLEET },
    ],
  },
];

export function allScreens(nodes: (NavScreen | NavGroup)[] = [...NAVIGATION, ...EXTRA_SECTIONS]): NavScreen[] {
  return nodes.flatMap((n) => (isGroup(n) ? allScreens(n.children) : [n]));
}
