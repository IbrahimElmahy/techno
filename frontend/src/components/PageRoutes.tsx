import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { apiBusy } from '../api/client';

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
const CustomerDebts = lazy(() => import('../pages/CustomerDebts'));
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
const RatioProduction = lazy(() => import('../pages/RatioProduction'));
const RepReports = lazy(() => import('../pages/RepReports'));
const StockCounts = lazy(() => import('../pages/StockCounts'));
const ItemCard = lazy(() => import('../pages/ItemCard'));
const StockPermits = lazy(() => import('../pages/StockPermits'));
const Stocktake = lazy(() => import('../pages/Stocktake'));
const AccountStatement = lazy(() => import('../pages/AccountStatement'));
const Reconciliation = lazy(() => import('../pages/Reconciliation'));
const FixedAssets = lazy(() => import('../pages/FixedAssets'));
const Employees = lazy(() => import('../pages/Employees'));
const Departments = lazy(() => import('../pages/Departments'));
const Attendance = lazy(() => import('../pages/Attendance'));
const Leave = lazy(() => import('../pages/Leave'));
const Advances = lazy(() => import('../pages/Advances'));
const EmployeeReceivables = lazy(() => import('../pages/EmployeeReceivables'));
const Payroll = lazy(() => import('../pages/Payroll'));
const HrReports = lazy(() => import('../pages/HrReports'));
const OpsReports = lazy(() => import('../pages/OpsReports'));
const Profitability = lazy(() => import('../pages/Profitability'));
const Orders = lazy(() => import('../pages/Orders'));
const CouponReceipts = lazy(() => import('../pages/CouponReceipts'));
const CouponCustody = lazy(() => import('../pages/CouponCustody'));
const AfterSalesReports = lazy(() => import('../pages/AfterSalesReports'));
const PointsLedger = lazy(() => import('../pages/PointsLedger'));
const Invoices = lazy(() => import('../pages/Invoices'));
const BonusReport = lazy(() => import('../pages/BonusReport'));
const Returns = lazy(() => import('../pages/Returns'));
const Loyalty = lazy(() => import('../pages/Loyalty'));
const Treasury = lazy(() => import('../pages/Treasury'));
const GeneralLedger = lazy(() => import('../pages/GeneralLedger'));
const AccountingDashboard = lazy(() => import('../pages/AccountingDashboard'));
const Audit = lazy(() => import('../pages/Audit'));
const Reports = lazy(() => import('../pages/Reports'));
const TradeReports = lazy(() => import('../pages/TradeReports'));
const Settings = lazy(() => import('../pages/Settings'));
const Permissions = lazy(() => import('../pages/Permissions'));
const UserPermissions = lazy(() => import('../pages/UserPermissions'));
const BranchOverview = lazy(() => import('../pages/BranchOverview'));
const Reps = lazy(() => import('../pages/Reps'));
const PartnersCurrent = lazy(() => import('../pages/PartnersCurrent'));
const PartyLinks = lazy(() => import('../pages/PartyLinks'));
const Territories = lazy(() => import('../pages/Territories'));
const Governorates = lazy(() => import('../pages/Governorates'));
const Inspections = lazy(() => import('../pages/Inspections'));
const Owners = lazy(() => import('../pages/Owners'));
const InspectionItems = lazy(() => import('../pages/InspectionItems'));
const Vouchers = lazy(() => import('../pages/Vouchers'));
const VoucherKeys = lazy(() => import('../pages/VoucherKeys'));
const FinanceReports = lazy(() => import('../pages/FinanceReports'));
const FleetDashboard = lazy(() => import('../pages/FleetDashboard'));
const FleetVehicles = lazy(() => import('../pages/FleetVehicles'));
const FleetVehicle = lazy(() => import('../pages/FleetVehicle'));
const FleetDrivers = lazy(() => import('../pages/FleetDrivers'));
const FleetRecords = lazy(() => import('../pages/FleetRecords'));
const FleetInspections = lazy(() => import('../pages/FleetInspections'));
const FleetMonthly = lazy(() => import('../pages/FleetMonthly'));
const FleetTasks = lazy(() => import('../pages/FleetTasks'));
const IncomeSheet = lazy(() => import('../pages/IncomeSheet'));
const PeriodClosing = lazy(() => import('../pages/PeriodClosing'));

let preloaded = false;
export function preloadAllPages() {
  if (preloaded) return;
  preloaded = true;
  const loaders = Object.values(import.meta.glob('../pages/*.tsx'));
  const idle = (cb: () => void) => ((window as any).requestIdleCallback
    ? (window as any).requestIdleCallback(cb, { timeout: 2000 })
    : window.setTimeout(cb, 200));
  const next = () => {
    if (apiBusy()) { window.setTimeout(() => idle(next), 400); return; }
    const load = loaders.shift();
    if (!load) return;
    load().catch(() => {}).finally(() => idle(next));
  };
  window.setTimeout(() => idle(next), 1500);
}

const Placeholder = ({ name }: { name: string }) => (
  <div style={{ padding: 24, background: '#fff', borderRadius: 8 }}>
    <h2>{name}</h2>
    <p>صفحة قيد التطوير لـ {name}</p>
  </div>
);

export default function PageRoutes({ location }: { location?: string }) {
  useEffect(() => { preloadAllPages(); }, []);
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>}>
    <Routes location={location}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/users" element={<Users />} />
      <Route path="/org" element={<Org />} />
      <Route path="/warehouses" element={<Warehouses />} />
      <Route path="/branches" element={<Branches />} />
      <Route path="/main-accounts" element={<MainAccounts />} />
      <Route path="/sub-accounts" element={<SubAccounts />} />
      <Route path="/treasuries" element={<Treasuries />} />
      <Route path="/cost-centers" element={<CostCenters />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/customers/:customerId" element={<CustomerProfile />} />
      <Route path="/customer-debts" element={<CustomerDebts />} />
      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/suppliers/:supplierId" element={<SupplierProfile />} />
      <Route path="/categories" element={<Categories />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/catalog/:itemId" element={<ItemProfile />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/manufacturing" element={<Manufacturing />} />
      <Route path="/invoices" element={<Invoices />} />
      <Route path="/bonus-report" element={<BonusReport />} />
      <Route path="/returns" element={<Returns />} />
      <Route path="/transfers" element={<Transfers />} />
      <Route path="/stock-balance" element={<StockBalance />} />
      <Route path="/stock-sheet" element={<StockSheet />} />
      <Route path="/stock-alerts" element={<StockAlerts />} />
      <Route path="/item-card" element={<ItemCard />} />
      <Route path="/stock-permits" element={<StockPermits />} />
      <Route path="/stocktake" element={<Stocktake />} />
      <Route path="/account-statement" element={<AccountStatement />} />
      <Route path="/reconciliation" element={<Reconciliation />} />
      <Route path="/fixed-assets" element={<FixedAssets />} />
      <Route path="/employees" element={<Employees />} />
      <Route path="/departments" element={<Departments />} />
      <Route path="/attendance" element={<Attendance />} />
      <Route path="/leave" element={<Leave />} />
      <Route path="/employee-salaries" element={<Navigate to="/payroll?tab=employees" replace />} />
      <Route path="/commission-settings" element={<Navigate to="/payroll?tab=employees" replace />} />
      <Route path="/advances" element={<Advances />} />
      <Route path="/employee-receivables" element={<EmployeeReceivables />} />
      <Route path="/insurance" element={<Navigate to="/payroll?tab=employees" replace />} />
      <Route path="/payroll" element={<Payroll />} />
      <Route path="/payroll-sheet" element={<Navigate to="/payroll" replace />} />
      <Route path="/payroll-groups" element={<Navigate to="/payroll" replace />} />
      <Route path="/hr-reports" element={<HrReports />} />
      <Route path="/ops-reports" element={<OpsReports />} />
      <Route path="/profitability" element={<Profitability />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/coupon-receipts" element={<CouponReceipts />} />
      <Route path="/coupon-custody" element={<CouponCustody />} />
      <Route path="/after-sales-reports" element={<AfterSalesReports />} />
      <Route path="/points-ledger" element={<PointsLedger />} />
      <Route path="/treasury" element={<Treasury />} />
      <Route path="/vouchers" element={<Vouchers />} />
      <Route path="/voucher-keys" element={<VoucherKeys />} />
      <Route path="/finance-reports" element={<FinanceReports />} />
      <Route path="/income-sheet" element={<IncomeSheet />} />
      <Route path="/period-closing" element={<PeriodClosing />} />
      <Route path="/general-ledger" element={<GeneralLedger />} />
      <Route path="/accounting" element={<AccountingDashboard />} />
      <Route path="/loyalty" element={<Loyalty />} />
      <Route path="/audit" element={<Audit />} />
      <Route path="/inspections" element={<Inspections fixedKind="technician" />} />
      <Route path="/visits" element={<Inspections fixedKind="regular" />} />
      <Route path="/owners" element={<Owners />} />
      <Route path="/inspection-items" element={<InspectionItems />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/purchase-returns" element={<PurchaseReturns />} />
      <Route path="/free-production" element={<FreeProduction />} />
      <Route path="/ratio-production" element={<RatioProduction />} />
      <Route path="/rep-reports" element={<RepReports />} />
      <Route path="/stock-counts" element={<StockCounts />} />
      <Route path="/trade-reports" element={<TradeReports />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/permissions" element={<Permissions />} />
      <Route path="/user-permissions" element={<UserPermissions />} />
      <Route path="/branch-overview" element={<BranchOverview />} />
      <Route path="/reps" element={<Reps />} />
      <Route path="/partners-current" element={<PartnersCurrent />} />
      <Route path="/party-links" element={<PartyLinks />} />
      <Route path="/territories" element={<Territories />} />
      <Route path="/governorates" element={<Governorates />} />
      <Route path="/fleet" element={<FleetDashboard />} />
      <Route path="/fleet/vehicles" element={<FleetVehicles />} />
      <Route path="/fleet/vehicles/:vehicleId" element={<FleetVehicle />} />
      <Route path="/fleet/drivers" element={<FleetDrivers />} />
      <Route path="/fleet/maintenance" element={<FleetRecords key="maintenance" kind="maintenance" />} />
      <Route path="/fleet/fuel" element={<FleetRecords key="fuel" kind="fuel" />} />
      <Route path="/fleet/faults" element={<FleetRecords key="faults" kind="faults" />} />
      <Route path="/fleet/violations" element={<FleetRecords key="violations" kind="violations" />} />
      <Route path="/fleet/inspections" element={<FleetInspections />} />
      <Route path="/fleet/monthly" element={<FleetMonthly />} />
      <Route path="/fleet/tasks" element={<FleetTasks />} />
      <Route path="*" element={<PendingScreen />} />
    </Routes>
    </Suspense>
  );
}
