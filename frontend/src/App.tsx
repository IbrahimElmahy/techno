import React, { useEffect, useState } from 'react';
import { ConfigProvider, Spin } from 'antd';
import arEG from 'antd/locale/ar_EG';
import dayjs from 'dayjs';
import 'dayjs/locale/ar';
import updateLocale from 'dayjs/plugin/updateLocale';

dayjs.extend(updateLocale);
dayjs.locale('ar');
dayjs.updateLocale('ar', {
  weekdaysMin: ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'],
  weekdaysShort: ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
  months: [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ],
  monthsShort: [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ],
});

const AR_LOCALE: typeof arEG = {
  ...arEG,
  Table: {
    ...arEG.Table!,
    filterCheckAll: 'تحديد الكل',
    filterSearchPlaceholder: 'بحث',
    filterConfirm: 'تطبيق',
    filterReset: 'مسح',
  } as any,
  DatePicker: {
    ...arEG.DatePicker!,
    lang: {
      ...arEG.DatePicker!.lang,
      locale: 'ar',
      placeholder: 'اختر التاريخ',
      rangePlaceholder: ['من تاريخ', 'إلى تاريخ'],
      shortWeekDays: ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'],
      shortMonths: [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
      ],
    },
  },
};
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';

const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');
import { AuthProvider } from './components/AuthProvider';
import RouteGuard from './components/RouteGuard';
import AppLayout from './components/AppLayout';
import { TabsProvider } from './components/TabsContext';
import { KeyboardProvider } from './components/keyboard';
import { DensityProvider } from './components/RowDensity';
import ColumnResizeProvider from './components/ColumnResize';
import Login from './pages/Login';
import UpdateBanner from './components/UpdateBanner';
import { setApiBaseURL } from './api/client';
import { useNumerals } from './utils/numerals';
import { HC_THEME, UiThemeProvider, useUiThemeState } from './components/ContrastTheme';

export default function App() {
  const [configLoaded, setConfigLoaded] = useState(false);
  const [apiUrl, setApiUrl] = useState('');

  useNumerals();

  const uiTheme = useUiThemeState();
  const hc = uiTheme.theme === 'hc';

  useEffect(() => {
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
      const host = window.location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1';
      const baked = (import.meta as any).env?.VITE_API_URL as string | undefined;
      const apiBase = baked && baked.trim()
        ? baked.trim().replace(/\/$/, '')
        : (isLocal ? 'http://127.0.0.1:8000' : window.location.origin + BASENAME);
      setApiUrl(apiBase);
      setApiBaseURL(apiBase);
      setConfigLoaded(true);
    }
  }, []);

  if (!configLoaded) {
    return <Spin size="large" tip="جاري تحميل الإعدادات..." fullscreen />;
  }

  return (
    <UiThemeProvider value={uiTheme}>
    <ConfigProvider
      direction="rtl"
      locale={AR_LOCALE}
      theme={{
        components: hc ? HC_THEME.components : undefined,
        token: {
          colorPrimary: '#6AB42D',
          colorInfo: '#6AB42D',
          colorWarning: '#F5A11D',
          fontFamily: 'Cairo, sans-serif',
          borderRadius: 6,
          fontSize: 16,
          fontSizeSM: 14,
          fontSizeLG: 18,
          fontWeightStrong: 800,
          colorText: '#141414',
          colorTextSecondary: '#303030',
          colorTextDescription: '#4a4a4a',
          lineHeight: 1.6,
          ...(hc ? HC_THEME.token : {}),
        },
      }}
    >
      <UpdateBanner />
      <DensityProvider>
      <ColumnResizeProvider>
      <AuthProvider apiUrl={apiUrl}>
        <Router basename={BASENAME} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<RouteGuard><TabsProvider><KeyboardProvider><AppLayout /></KeyboardProvider></TabsProvider></RouteGuard>} />
          </Routes>
        </Router>
      </AuthProvider>
      </ColumnResizeProvider>
      </DensityProvider>
    </ConfigProvider>
    </UiThemeProvider>
  );
}
