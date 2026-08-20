import React, { useEffect, useState } from 'react';
import { ConfigProvider, Spin } from 'antd';
import arEG from 'antd/locale/ar_EG';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/AuthProvider';
import RouteGuard from './components/RouteGuard';
import AppLayout from './components/AppLayout';
import { TabsProvider } from './components/TabsContext';
import { KeyboardProvider } from './components/keyboard';
import { DensityProvider } from './components/RowDensity';
import ColumnResizeProvider from './components/ColumnResize';
import Login from './pages/Login';
import { setApiBaseURL } from './api/client';

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
      // Web build. Local `vite` dev → the backend on :8000. Deployed → the canonical API domain.
      // NOT a baked VITE_API_URL: a stale Vercel env once pointed the production bundle at the
      // old *.vercel.app domain, whose /api no longer routes to the backend → CORS-dead login.
      const host = window.location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1';
      const apiBase = isLocal ? 'http://127.0.0.1:8000' : 'https://api.technothermeg.com';
      setApiUrl(apiBase);
      setApiBaseURL(apiBase);
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
          /*
           * وضوح الخط — في التوكن مش في CSS بس.
           *
           * antd بتبني ألوانها ومقاساتها من التوكنز دي وبتحقنها في كل مكوّن، حتى اللي مالوش
           * كلاس أقدر أمسكه من `index.css`. فالتغيير هنا بيوصل للبوبابات والتنبيهات والقوايم
           * المنسدلة كمان، مش للجداول والفورمات بس.
           *
           * ١٤ بدل ١٣: فرق بيكسل واحد، وهو الفرق بين رقم بتقراه ورقم بتتأكد منه.
           * و`colorText` أغمق من الافتراضي `rgba(0,0,0,0.88)`، و`colorTextSecondary` كان
           * `0.65` — رمادي فاتح على أبيض، وهو اللي كان بيخلّي العناوين تبان باهتة.
           */
          fontSize: 14,
          colorText: '#1f1f1f',
          colorTextSecondary: '#4a4a4a',
          colorTextDescription: '#5c5c5c',
        },
      }}
    >
      {/* Both sit ABOVE the router: they are document-level preferences about how tables look,
          with nothing to do with who is logged in or which tab is open. Mounted inside the
          authenticated shell they would also reset on every logout, which is not what a saved
          preference means. */}
      <DensityProvider>
      <ColumnResizeProvider>
      <AuthProvider apiUrl={apiUrl}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Everything else is the authenticated shell, which hosts the work tabs. Each tab
                keeps its own page mounted, so leaving unfinished work and coming back is easy. */}
            <Route path="*" element={<RouteGuard><TabsProvider><KeyboardProvider><AppLayout /></KeyboardProvider></TabsProvider></RouteGuard>} />
          </Routes>
        </Router>
      </AuthProvider>
      </ColumnResizeProvider>
      </DensityProvider>
    </ConfigProvider>
  );
}
