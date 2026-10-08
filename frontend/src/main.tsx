import './utils/noGrouping';
import './components/tableDefaults';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './theme-hc.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
