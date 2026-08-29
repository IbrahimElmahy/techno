import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';

/**
 * كل شاشة في ملف لوحدها — بتتحمّل أول ما تتفتح.
 *
 * كانت الشاشات كلها متستوردة على طول، فـVite بيلمّها في ملف واحد. البرنامج كان بيقرا ٢.٣
 * ميجا جافاسكريبت قبل ما يوريك أول شاشة — وفيها الرواتب والتصنيع والتقارير، اللي واحد
 * بيكتب فواتير مش هيفتحهم في يومه أصلاً. `lazy` بيخلّي كل شاشة ملف مستقل، فالبداية بتحمّل
 * الهيكل والشاشة المطلوبة بس.
 *
 * الـ`Suspense` جوّه `PageRoutes`، يعني كل تبويب ليه حدوده — التبويب اللي لسه بيحمّل
 * مايوقّفش اللي مفتوح جنبه.
 */
const Users = lazy(() => import('../pages/Users'));
const Org = lazy(() => import('../pages/Org'));
const Warehouses = lazy(() => import('../pages/Warehouses'));
const Branches = lazy(() => import('../pages/Branches'));
const Dashboard = lazy(() => import('../pages/Dashboard'));
const MainAccounts = lazy(() => import('../pages/MainAccounts'));
const SubAccounts = lazy(() => import('../pages/SubAccounts'));
const Treasuries = lazy(() => import('../pages/Treasuries'));
const CostCenters = lazy(() => import('../pages/CostCenters'));
const Customers = lazy(() => import('../pages/Customers'));
const CustomerProfile = lazy(() => import('../pages/CustomerProfile'));
const SupplierProfile = lazy(() => import('../pages/SupplierProfile'));
const Suppliers = lazy(() => import('../pages/Suppliers'));
const Catalog = lazy(() => import('../pages/Catalog'));
const ItemProfile = lazy(() => import('../pages/ItemProfile'));
const Purchases = lazy(() => import('../pages/Purchases'));
const Manufacturing = lazy(() => import('../pages/Manufacturing'));
const Transfers = lazy(() => import('../pages/Transfers'));
const StockBalance = lazy(() => import('../pages/StockBalance'));
const StockSheet = lazy(() => import('../pages/StockSheet'));
const StockAlerts = lazy(() => import('../pages/StockAlerts'));
const Categories = lazy(() => import('../pages/Categories'));
const PendingScreen = lazy(() => import('../pages/PendingScreen'));
const PurchaseReturns = lazy(() => import('../pages/PurchaseReturns'));
const FreeProduction = lazy(() => import('../pages/FreeProduction'));
const RepReports = lazy(() => import('../pages/RepReports'));
const StockCounts = lazy(() => import('../pages/StockCounts'));
const ItemCard = lazy(() => import('../pages/ItemCard'));
const StockPermits = lazy(() => import('../pages/StockPermits'));
const Stocktake = lazy(() => import('../pages/Stocktake'));
const AccountStatement = lazy(() => import('../pages/AccountStatement'));
const FixedAssets = lazy(() => import('../pages/FixedAssets'));
const Employees = lazy(() => import('../pages/Employees'));
const Departments = lazy(() => import('../pages/Departments'));
const Attendance = lazy(() => import('../pages/Attendance'));
const Leave = lazy(() => import('../pages/Leave'));
const PayrollSettings = lazy(() => import('../pages/PayrollSettings'));
const Advances = lazy(() => import('../pages/Advances'));
const Payroll = lazy(() => import('../pages/Payroll'));
const HrReports = lazy(() => import('../pages/HrReports'));
const OpsReports = lazy(() => import('../pages/OpsReports'));
const Profitability = lazy(() => import('../pages/Profitability'));
const Orders = lazy(() => import('../pages/Orders'));
const CouponReceipts = lazy(() => import('../pages/CouponReceipts'));
const Invoices = lazy(() => import('../pages/Invoices'));
const Returns = lazy(() => import('../pages/Returns'));
const Loyalty = lazy(() => import('../pages/Loyalty'));
const Treasury = lazy(() => import('../pages/Treasury'));
const GeneralLedger = lazy(() => import('../pages/GeneralLedger'));
const Audit = lazy(() => import('../pages/Audit'));
const Reports = lazy(() => import('../pages/Reports'));
const TradeReports = lazy(() => import('../pages/TradeReports'));
const Settings = lazy(() => import('../pages/Settings'));
const Permissions = lazy(() => import('../pages/Permissions'));
const BranchOverview = lazy(() => import('../pages/BranchOverview'));
const Inspections = lazy(() => import('../pages/Inspections'));
const InspectionItems = lazy(() => import('../pages/InspectionItems'));
const Vouchers = lazy(() => import('../pages/Vouchers'));
const VoucherKeys = lazy(() => import('../pages/VoucherKeys'));
const FinanceReports = lazy(() => import('../pages/FinanceReports'));

const Placeholder = ({ name }: { name: string }) => (
  <div style={{ padding: 24, background: '#fff', borderRadius: 8 }}>
    <h2>{name}</h2>
    <p>صفحة قيد التطوير لـ {name}</p>
  </div>
);

/** The application's page routes, WITHOUT the app chrome — rendered inside each work tab.
 *  `location` renders this tab's routes at its own path without changing the shared URL. */
export default function PageRoutes({ location }: { location?: string }) {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>}>
    <Routes location={location}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/users" element={<Users />} />
      <Route path="/org" element={<Org />} />
      {/* Split out of /org: their menu has each as its own screen, and a menu entry
          that lands you on a tabbed page is an entry you have to be taught. */}
      <Route path="/warehouses" element={<Warehouses />} />
      <Route path="/branches" element={<Branches />} />
      <Route path="/main-accounts" element={<MainAccounts />} />
      <Route path="/sub-accounts" element={<SubAccounts />} />
      <Route path="/treasuries" element={<Treasuries />} />
      <Route path="/cost-centers" element={<CostCenters />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/customers/:customerId" element={<CustomerProfile />} />
      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/suppliers/:supplierId" element={<SupplierProfile />} />
      <Route path="/categories" element={<Categories />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/catalog/:itemId" element={<ItemProfile />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/manufacturing" element={<Manufacturing />} />
      <Route path="/invoices" element={<Invoices />} />
      <Route path="/returns" element={<Returns />} />
      <Route path="/transfers" element={<Transfers />} />
      <Route path="/stock-balance" element={<StockBalance />} />
      <Route path="/stock-sheet" element={<StockSheet />} />
      <Route path="/stock-alerts" element={<StockAlerts />} />
      <Route path="/item-card" element={<ItemCard />} />
      <Route path="/stock-permits" element={<StockPermits />} />
      <Route path="/stocktake" element={<Stocktake />} />
      <Route path="/account-statement" element={<AccountStatement />} />
      <Route path="/fixed-assets" element={<FixedAssets />} />
      <Route path="/employees" element={<Employees />} />
      <Route path="/departments" element={<Departments />} />
      <Route path="/attendance" element={<Attendance />} />
      <Route path="/leave" element={<Leave />} />
      <Route path="/payroll-settings" element={<PayrollSettings />} />
      <Route path="/advances" element={<Advances />} />
      <Route path="/payroll" element={<Payroll />} />
      <Route path="/hr-reports" element={<HrReports />} />
      <Route path="/ops-reports" element={<OpsReports />} />
      <Route path="/profitability" element={<Profitability />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/coupon-receipts" element={<CouponReceipts />} />
      <Route path="/treasury" element={<Treasury />} />
      <Route path="/vouchers" element={<Vouchers />} />
      <Route path="/voucher-keys" element={<VoucherKeys />} />
      <Route path="/finance-reports" element={<FinanceReports />} />
      <Route path="/general-ledger" element={<GeneralLedger />} />
      <Route path="/loyalty" element={<Loyalty />} />
      <Route path="/audit" element={<Audit />} />
      <Route path="/inspections" element={<Inspections />} />
      <Route path="/inspection-items" element={<InspectionItems />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/purchase-returns" element={<PurchaseReturns />} />
      <Route path="/free-production" element={<FreeProduction />} />
      <Route path="/rep-reports" element={<RepReports />} />
      <Route path="/stock-counts" element={<StockCounts />} />
      <Route path="/trade-reports" element={<TradeReports />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/permissions" element={<Permissions />} />
      <Route path="/branch-overview" element={<BranchOverview />} />
      {/* A menu entry whose screen is not built yet lands here and says so, naming the a5 screen
          it will mirror. Bouncing to the dashboard instead would read as the click having failed. */}
      <Route path="*" element={<PendingScreen />} />
    </Routes>
    </Suspense>
  );
}
