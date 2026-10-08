import './utils/noGrouping';   // أول حاجة: الأرقام من غير فاصل آلاف في كل الشاشات
import './components/tableDefaults';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
// بعد index.css: «ألوان واضحة / خط أكبر» — مابيشتغلش غير مع html.theme-hc (ContrastTheme.tsx).
import './theme-hc.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
