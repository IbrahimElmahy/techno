import axios from 'axios';
import { message, notification } from 'antd';

export const api = axios.create({
  // Serverless backends + auto-suspending DBs (Vercel/Neon) can take >10s on a cold start;
  // a short timeout surfaced as "فشل الاتصال بالخادم" on the first request. 30s tolerates the wake-up.
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept-Language': 'ar',
  },
});

// Helper to dynamically set base URL after config loads from IPC
export function setApiBaseURL(url: string) {
  api.defaults.baseURL = url;
}

export function getApiBaseURL() {
  return api.defaults.baseURL || 'http://127.0.0.1:8000';
}

// Request interceptor to attach JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for errors and auto-logout
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const { response } = error;

    if (response) {
      const status = response.status;
      const data = response.data;

      // Handle 401 Unauthorized / 403 Forbidden -> Session Expired (FR-004)
      if (status === 401 || status === 403) {
        // Dispatch global event so AuthProvider can intercept and log out
        window.dispatchEvent(new CustomEvent('api-unauthorized', { detail: { status } }));
      }

      // Handle server validation/business logic violations (e.g., negative stock, Principle XI)
      const errorMessage = data?.detail || data?.message || 'حدث خطأ في النظام';
      
      // If validation error or specific stock limit issue (rejections)
      if (status === 400 || status === 422) {
        notification.error({
          message: 'خطأ في عملية التحقق',
          description: errorMessage,
          placement: 'topLeft', // RTL default is top-left in Antd
        });
      } else if (status >= 500) {
        message.error('خطأ غير متوقع في الخادم الرئيسي');
      } else {
        message.error(errorMessage);
      }
    } else {
      // Network drop / offline state (FR-009 / Edge Cases)
      message.error('فشل الاتصال بالخادم، يرجى التحقق من الشبكة');
      window.dispatchEvent(new Event('api-network-down'));
    }

    return Promise.reject(error);
  }
);
