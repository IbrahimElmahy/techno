import React, { useEffect, useState } from 'react';
import { ConfigProvider, Spin } from 'antd';
import arEG from 'antd/locale/ar_EG';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/AuthProvider';
import RouteGuard from './components/RouteGuard';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Users from './pages/Users';
import Org from './pages/Org';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Catalog from './pages/Catalog';
import Purchases from './pages/Purchases';
import Manufacturing from './pages/Manufacturing';
import Transfers from './pages/Transfers';
import Invoices from './pages/Invoices';
import Loyalty from './pages/Loyalty';
import Treasury from './pages/Treasury';
import Audit from './pages/Audit';
import Reports from './pages/Reports';
import { setApiBaseURL } from './api/client';

// Define placeholder pages for routes (implemented in later tasks)
const Placeholder = ({ name }: { name: string }) => (
  <div style={{ padding: 24, background: '#fff', borderRadius: 8 }}>
    <h2>{name}</h2>
    <p>صفحة قيد التطوير لـ {name}</p>
  </div>
);

export default function App() {
  const [configLoaded, setConfigLoaded] = useState(false);
  const [apiUrl, setApiUrl] = useState('');

  useEffect(() => {
    // Load config from Electron IPC
    if (window.electronAPI) {
      window.electronAPI.getConfig().then((config) => {
        setApiUrl(config.apiUrl);
        setApiBaseURL(config.apiUrl);
        setConfigLoaded(true);
      }).catch((err) => {
        console.error('Failed to load config via IPC:', err);
        setApiBaseURL('http://127.0.0.1:8000');
        setConfigLoaded(true);
      });
    } else {
      // Fallback for browser testing
      setApiUrl('http://127.0.0.1:8000');
      setApiBaseURL('http://127.0.0.1:8000');
      setConfigLoaded(true);
    }
  }, []);

  if (!configLoaded) {
    return <Spin size="large" tip="جاري تحميل الإعدادات..." fullscreen />;
  }

  return (
    <ConfigProvider
      direction="rtl"
      locale={arEG}
      theme={{
        token: {
          colorPrimary: '#6AB42D',       // Primary green
          colorInfo: '#6AB42D',
          colorWarning: '#F5A11D',       // Accent orange
          fontFamily: 'Cairo, sans-serif',
          borderRadius: 6,
        },
      }}
    >
      <AuthProvider apiUrl={apiUrl}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            {/* Authenticated Dashboard routes */}
            <Route path="/" element={<RouteGuard><AppLayout /></RouteGuard>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Placeholder name="الرئيسية" />} />
              <Route path="users" element={<Users />} />
              <Route path="org" element={<Org />} />
              <Route path="customers" element={<Customers />} />
              <Route path="suppliers" element={<Suppliers />} />
              <Route path="catalog" element={<Catalog />} />
              <Route path="purchases" element={<Purchases />} />
              <Route path="manufacturing" element={<Manufacturing />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="transfers" element={<Transfers />} />
              <Route path="treasury" element={<Treasury />} />
              <Route path="loyalty" element={<Loyalty />} />
              <Route path="audit" element={<Audit />} />
              <Route path="reports" element={<Reports />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </ConfigProvider>
  );
}
