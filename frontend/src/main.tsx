import './utils/noGrouping';   // أول حاجة: الأرقام من غير فاصل آلاف في كل الشاشات
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
