import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Users from '../pages/Users';
import Org from '../pages/Org';
import Customers from '../pages/Customers';
import CustomerProfile from '../pages/CustomerProfile';
import SupplierProfile from '../pages/SupplierProfile';
import Suppliers from '../pages/Suppliers';
import Catalog from '../pages/Catalog';
import ItemProfile from '../pages/ItemProfile';
import Purchases from '../pages/Purchases';
import Manufacturing from '../pages/Manufacturing';
import Transfers from '../pages/Transfers';
import StockBalance from '../pages/StockBalance';
import StockAlerts from '../pages/StockAlerts';
import ItemCard from '../pages/ItemCard';
import StockPermits from '../pages/StockPermits';
import Stocktake from '../pages/Stocktake';
import AccountStatement from '../pages/AccountStatement';
import FixedAssets from '../pages/FixedAssets';
import Employees from '../pages/Employees';
import Orders from '../pages/Orders';
import Invoices from '../pages/Invoices';
import Returns from '../pages/Returns';
import Loyalty from '../pages/Loyalty';
import Treasury from '../pages/Treasury';
import GeneralLedger from '../pages/GeneralLedger';
import Audit from '../pages/Audit';
import Reports from '../pages/Reports';
import TradeReports from '../pages/TradeReports';
import Settings from '../pages/Settings';
import Inspections from '../pages/Inspections';
import InspectionItems from '../pages/InspectionItems';
import Vouchers from '../pages/Vouchers';
import FinanceReports from '../pages/FinanceReports';

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
    <Routes location={location}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Placeholder name="الرئيسية" />} />
      <Route path="/users" element={<Users />} />
      <Route path="/org" element={<Org />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/customers/:customerId" element={<CustomerProfile />} />
      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/suppliers/:supplierId" element={<SupplierProfile />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/catalog/:itemId" element={<ItemProfile />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/manufacturing" element={<Manufacturing />} />
      <Route path="/invoices" element={<Invoices />} />
      <Route path="/returns" element={<Returns />} />
      <Route path="/transfers" element={<Transfers />} />
      <Route path="/stock-balance" element={<StockBalance />} />
      <Route path="/stock-alerts" element={<StockAlerts />} />
      <Route path="/item-card" element={<ItemCard />} />
      <Route path="/stock-permits" element={<StockPermits />} />
      <Route path="/stocktake" element={<Stocktake />} />
      <Route path="/account-statement" element={<AccountStatement />} />
      <Route path="/fixed-assets" element={<FixedAssets />} />
      <Route path="/employees" element={<Employees />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/treasury" element={<Treasury />} />
      <Route path="/vouchers" element={<Vouchers />} />
      <Route path="/finance-reports" element={<FinanceReports />} />
      <Route path="/general-ledger" element={<GeneralLedger />} />
      <Route path="/loyalty" element={<Loyalty />} />
      <Route path="/audit" element={<Audit />} />
      <Route path="/inspections" element={<Inspections />} />
      <Route path="/inspection-items" element={<InspectionItems />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/trade-reports" element={<TradeReports />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
