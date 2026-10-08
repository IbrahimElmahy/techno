import axios from 'axios';
import { message, notification } from 'antd';

export const api = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept-Language': 'ar',
  },
});

export function setApiBaseURL(url: string) {
  api.defaults.baseURL = url;
}

export function getApiBaseURL() {
  return api.defaults.baseURL || 'http://127.0.0.1:8000';
}

const VIEW_BRANCH_KEY = 'viewBranch';

export function getViewBranch(): number | null {
  try {
    const v = Number(localStorage.getItem(VIEW_BRANCH_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch { return null; }
}

export function setViewBranch(id: number | null) {
  try {
    if (id) localStorage.setItem(VIEW_BRANCH_KEY, String(id));
    else localStorage.removeItem(VIEW_BRANCH_KEY);
  } catch {}
}

const getCache = new Map<string, { data: any; headers: any; expiry: number }>();
const inflightRequests = new Map<string, Promise<any>>();

let cacheEpoch = 0;

export function clearApiCache() {
  getCache.clear();
  inflightRequests.clear();
  cacheEpoch += 1;
}

const CACHEABLE_PATHS = new Set([
  '/api/v1/warehouses',
  '/api/v1/branches',
  '/api/v1/accounts',
  '/api/v1/loyalty/coupon-types',
  '/api/v1/settings/lookups',
  '/api/v1/employees',
  '/api/v1/users',
  '/api/v1/customers',
  '/api/v1/customers/options',
  '/api/v1/suppliers',
  '/api/v1/items',
  '/api/v1/products/point-values',
  '/api/v1/territories',
  '/api/v1/governorates',
  '/api/v1/cost-centers',
  '/api/v1/treasuries',
  '/api/v1/custodies',
  '/api/v1/cash-accounts',
  '/api/v1/reps',
  '/api/v1/hr/departments',
]);

const TTL_LIVE_MS = 5 * 60 * 1000;
const TTL_OFFLINE_MS = 20000;
let liveConnected = false;

export function setLiveConnected(on: boolean) {
  liveConnected = on;
  if (on) return;
  const cap = Date.now() + TTL_OFFLINE_MS;
  getCache.forEach((entry) => { if (entry.expiry > cap) entry.expiry = cap; });
}

const NON_DATA_PREFIXES = ['/api/v1/auth/', '/api/v1/live/', '/api/v1/drafts'];

function isDataMutation(url: string | undefined): boolean {
  if (!url) return true;
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/^.*?(\/api\/v1\/)/, '$1');
  return !NON_DATA_PREFIXES.some((p) => path.startsWith(p));
}

let inflight = 0;
export function apiBusy(): boolean {
  return inflight > 0;
}

const originalGet = api.get.bind(api);

api.get = function (url: string, config?: any): Promise<any> {
  const isNoCache = config?.headers?.['Cache-Control'] === 'no-cache';
  const path = url.split('?')[0];
  const fullKey = `${url}?${JSON.stringify(config?.params || {})}#b${getViewBranch() ?? ''}`;
  const isCacheable = !isNoCache && CACHEABLE_PATHS.has(path);

  if (isCacheable) {
    const cached = getCache.get(fullKey);
    if (cached && Date.now() < cached.expiry) {
      return Promise.resolve({
        data: cached.data, status: 200, statusText: 'OK',
        headers: cached.headers, config: config || {},
      });
    }

    if (inflightRequests.has(fullKey)) {
      return inflightRequests.get(fullKey)!;
    }

    const startedAt = cacheEpoch;
    const reqPromise = originalGet(url, config)
      .then((res) => {
        inflightRequests.delete(fullKey);
        if (startedAt === cacheEpoch) {
          getCache.set(fullKey, {
            data: res.data, headers: res.headers || {},
            expiry: Date.now() + (liveConnected ? TTL_LIVE_MS : TTL_OFFLINE_MS),
          });
        }
        return res;
      })
      .catch((err) => {
        inflightRequests.delete(fullKey);
        throw err;
      });

    inflightRequests.set(fullKey, reqPromise);
    return reqPromise;
  }

  return originalGet(url, config);
} as any;

api.interceptors.request.use(
  (config) => {
    inflight += 1;
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const viewBranch = getViewBranch();
    if (viewBranch) config.headers['X-View-Branch'] = String(viewBranch);
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    inflight = Math.max(0, inflight - 1);
    const method = response.config.method?.toUpperCase();
    if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)
        && isDataMutation(response.config.url)) {
      clearApiCache();
    }
    return response;
  },
  (error) => {
    inflight = Math.max(0, inflight - 1);
    const { response } = error;

    if (response) {
      const status = response.status;
      const data = response.data;

      if (status === 401) {
        const replaced = response.data?.detail?.code === 'session_replaced';
        window.dispatchEvent(new CustomEvent('api-unauthorized', {
          detail: { status, code: replaced ? 'session_replaced' : undefined },
        }));
        if (replaced) {
          notification.warning({
            message: 'تم فتح الحساب من جهاز آخر',
            description: response.data?.detail?.message
              || 'الحساب يعمل على جهاز واحد فقط — تم إنهاء الجلسة هنا.',
            placement: 'topLeft',
            duration: 8,
          });
          return Promise.reject(error);
        }
      }

      const detail = data?.detail;
      const errorMessage =
        (typeof detail === 'string' && detail) ||
        detail?.message ||
        (Array.isArray(detail) && detail.map((d: any) => {
          const field = Array.isArray(d?.loc)
            ? d.loc.filter((x: any) => x !== 'body').join('.') : '';
          return field ? `${field}: ${d?.msg}` : d?.msg;
        }).filter(Boolean).join('، ')) ||
        (typeof data?.message === 'string' && data.message) ||
        'حدث خطأ في النظام';
      
      if (status === 400 || status === 422) {
        notification.error({
          message: 'خطأ في عملية التحقق',
          description: errorMessage,
          placement: 'topLeft',
        });
      } else if (status >= 500) {
        message.error('خطأ غير متوقع في الخادم الرئيسي');
      } else {
        message.error(errorMessage);
      }
    } else {
      message.error('فشل الاتصال بالخادم، يرجى التحقق من الشبكة');
      window.dispatchEvent(new Event('api-network-down'));
    }

    return Promise.reject(error);
  }
);
