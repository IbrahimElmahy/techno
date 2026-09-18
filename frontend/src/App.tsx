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

/**
 * ضبط لغة التقويم للعربية مع اختصارات واضحة لأيام الأسبوع وأسماء الشهور.
 */
const AR_LOCALE: typeof arEG = {
  ...arEG,
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

/**
 * **الراوتر بيتقرر من البروتوكول، مش من إعداد بيلد.**
 *
 * الويب بياخد `BrowserRouter` عشان الرابط يبقى `/dashboard` مش `/#/dashboard` — رابط
 * فيه `#` مايتبعتش لزميل ولا يتحط في إشارة مرجعية من غير ما يبان غلط، ونجينكس عنده
 * `try_files $uri $uri/ /index.html` فأي مسار بيرجّع الصفحة والراوتر بيكمّل.
 *
 * ونسخة سطح المكتب (Electron) بتحمّل الصفحة من `file://` — ومافيش سيرفر يرجّع
 * `index.html` لمسار مش موجود، فـ`BrowserRouter` هناك بيدّي شاشة فاضية أول ما المستخدم
 * يعمل تحديث. الهاش هو اللي بيشتغل على `file:`، فبيفضل هناك.
 *
 * والاختيار وقت التشغيل مش وقت البناء عشان نفس الـ`dist` يخدم الاتنين: البيلد واحد،
 * والصفحة بتعرف هي شغالة فين من `location.protocol`.
 */
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

/**
 * البادئة اللي الموقع متقدّم منها — `/` للإنتاج و`/staging/` للبيئة التجريبية.
 *
 * `BASE_URL` بيجي من `base` بتاع Vite وقت البناء، فالبناء الواحد مايحتاجش يعرف هو
 * رايح فين: نفس الكود بيشتغل على الاتنين وكل بيلد عارف بادئته.
 */
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');
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
      // Web build.
      //
      // **الأصل اللي الصفحة جاية منه هو الـAPI بتاعها** — إلا في تطوير محلي.
      //
      // كان مكتوب: أي دومين غير localhost يروح على `api.technothermeg.com`. ده كان صح
      // لما كان فيه نشر واحد على السحابة، وبقى غلط خطير أول ما اتعمل نشر تاني: الواجهة
      // اللي بتتقدّم من سيرفر الشركة كانت بتكلّم قاعدة السحابة — نفس الشاشة، وقاعدة
      // تانية خالص. اللي بيبص عليها بيشوف أرقام مش بتاعة السيرفر اللي فتحه.
      //
      // النسبي بيحل ده لوحده: كل نشر بيكلّم الباك إند اللي جنبه، من غير ما حد يفتكر
      // يظبط متغيّر. والباك إند بيقدّم الواجهة من نفس الخدمة، فالأصل واحد بالضرورة.
      //
      // و`VITE_API_URL` بتفضل مخرج للحالة اللي الاتنين فيها متفرّقين (Vercel + Render):
      // اتقالت صراحةً ⇒ بتُحترم، ماتقالتش ⇒ نفس الأصل.
      const host = window.location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1';
      const baked = (import.meta as any).env?.VITE_API_URL as string | undefined;
      // **والبادئة جزء من العنوان.** البيئة التجريبية متقدّمة من `/staging/` وليها
      // خدمة وقاعدة لوحدها؛ من غير البادئة كانت هتنادي API الإنتاج — نفس الشاشة
      // وقاعدة تانية، وهي بالظبط الغلطة اللي التعليق فوق بيحذّر منها.
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
    <ConfigProvider
      direction="rtl"
      locale={AR_LOCALE}
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
          fontSize: 15,
          colorText: '#141414',
          colorTextSecondary: '#303030',
          colorTextDescription: '#4a4a4a',
          // ارتفاع السطر — الحروف العربية ليها نقط وذيول، والسطر الضيق
          // بيخلّيها تتلزق في اللي فوقها وتحتها.
          lineHeight: 1.6,
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
        <Router basename={BASENAME} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
