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

/**
 * كاش في الذاكرة للقوايم المرجعية — عشان التنقل بين الشاشات يبقى فوري.
 *
 * الشاشات بتفتح وبتطلب نفس القوايم كل مرة: المخازن، الفروع، شجرة الحسابات، العملاء،
 * الموردين، الأصناف. القوايم دي بتتغيّر مرة كل شوية وبتتقرا مية مرة في الساعة، فطلبها
 * من الأول مع كل شاشة هو الانتظار اللي كان باين.
 *
 * ## اللي بيتخزّن هو القايمة نفسها — مش أي حاجة تحتها
 *
 * الشرط كان `startsWith`، وده كان بيلقط حاجات مالهاش أي علاقة بالقوايم:
 * `/accounts` كانت بتلقط `/accounts/16/statement`، و`/items` بتلقط `/items/5/card`،
 * و`/customers` بتلقط `/customers/3/statement`. يعني كشف حساب عميل وكارت صنف — أرقام
 * بتتغيّر مع كل فاتورة — كانوا بيتعرضوا من كاش عمره ٢٠ ثانية. واللي بيراجع رصيد بيقرا
 * رقم قديم من غير ما حاجة تقوله.
 *
 * فالمطابقة بقت على المسار **بالظبط**: القايمة نفسها بس، وأي حاجة تحتها بتعدّي زي ما هي.
 */
const getCache = new Map<string, { data: any; expiry: number }>();
const inflightRequests = new Map<string, Promise<any>>();

/**
 * رقم بيزيد مع كل تفضية.
 *
 * التفضية لوحدها مش كفاية: طلب كان طاير وقت الحفظ بيرجع **بعده** وبيكتب داتا ما قبل
 * الحفظ في الكاش بعمر جديد — يعني الحفظ بيخلّي الشاشة قديمة ٢٠ ثانية بدل ما يحدّثها.
 * الطلب بياخد الرقم وهو خارج، وبيتأكد إنه ما اتغيّرش قبل ما يكتب.
 */
let cacheEpoch = 0;

export function clearApiCache() {
  getCache.clear();
  inflightRequests.clear();
  cacheEpoch += 1;
}

/** القوايم اللي بتتخزّن — بمسارها الكامل، مش كبداية مسار. */
const CACHEABLE_PATHS = new Set([
  '/api/v1/warehouses',
  '/api/v1/branches',
  '/api/v1/accounts',
  '/api/v1/loyalty/coupon-types',
  '/api/v1/settings/lookups',
  '/api/v1/employees',
  '/api/v1/users',
  '/api/v1/customers',
  '/api/v1/suppliers',
  '/api/v1/items',
  '/api/v1/products/point-values',
]);

const originalGet = api.get.bind(api);

api.get = function (url: string, config?: any): Promise<any> {
  const isNoCache = config?.headers?.['Cache-Control'] === 'no-cache';
  // اللي بعد «؟» جزء من العنوان، فبيتشال قبل المقارنة وبيدخل في المفتاح.
  const path = url.split('?')[0];
  const fullKey = `${url}?${JSON.stringify(config?.params || {})}`;
  const isCacheable = !isNoCache && CACHEABLE_PATHS.has(path);

  if (isCacheable) {
    const cached = getCache.get(fullKey);
    if (cached && Date.now() < cached.expiry) {
      return Promise.resolve({
        data: cached.data, status: 200, statusText: 'OK',
        headers: {}, config: config || {},
      });
    }

    if (inflightRequests.has(fullKey)) {
      return inflightRequests.get(fullKey)!;
    }

    const startedAt = cacheEpoch;
    const reqPromise = originalGet(url, config)
      .then((res) => {
        inflightRequests.delete(fullKey);
        // حصل حفظ والطلب ده كان طاير؟ رده صحيح للّي طلبه، وقديم لأي حد جاي بعده.
        if (startedAt === cacheEpoch) {
          getCache.set(fullKey, { data: res.data, expiry: Date.now() + 20000 });
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
    // Clear cache on any data mutations so UI is always fresh
    const method = response.config.method?.toUpperCase();
    if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      clearApiCache();
    }
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

      // Handle server validation/business logic violations (e.g., negative stock, Principle XI).
      // FastAPI hands back `detail` as {code, message} for our errors and as a list for
      // pydantic validation — rendering either object directly crashes React (#31).
      const detail = data?.detail;
      const errorMessage =
        (typeof detail === 'string' && detail) ||
        detail?.message ||
        (Array.isArray(detail) && detail.map((d: any) => d?.msg).filter(Boolean).join('، ')) ||
        (typeof data?.message === 'string' && data.message) ||
        'حدث خطأ في النظام';
      
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
