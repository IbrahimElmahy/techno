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
 * **فلتر الفرع بتاع المالك/الأدمن** (٢٠٢٦-١٠-٠٤) — بيتبعت هيدر `X-View-Branch` مع كل طلب،
 * والسيرفر بيفلتر بيه كل القوايم والتقارير من مكان واحد (`branch_scope.visible_branch_id`).
 * موظف الفرع السيرفر بيتجاهل الهيدر بتاعه ويرجّعله فرعه هو.
 */
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
  } catch { /* تخزين مقفول — الفلتر بيفضل للجلسة دي بس */ }
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
const getCache = new Map<string, { data: any; headers: any; expiry: number }>();
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
  '/api/v1/customers/options',
  '/api/v1/suppliers',
  '/api/v1/items',
  '/api/v1/products/point-values',
  // قوايم صغيرة بس بتتطلب مع فتحة كل شاشة تقريباً — كل واحدة رحلة للسيرفر (~٣٠٠ms من
  // عند العميل) ومكان من الستة اللي المتصفح بيفتحهم على نفس الدومين.
  '/api/v1/territories',
  '/api/v1/governorates',
  '/api/v1/cost-centers',
  '/api/v1/treasuries',
  '/api/v1/custodies',
  '/api/v1/cash-accounts',
  '/api/v1/reps',
  '/api/v1/hr/departments',
]);

/**
 * **عمر الكاش بيطول لما التحديث الحي شغّال** (٢٠٢٦-١٠-٠١ — «السيستم لسه تقيل»).
 *
 * الـ٢٠ ثانية كانت هي الضمان الوحيد إن القايمة ماتقدمش. بس من ساعة التحديث الحي، أي حفظ
 * من أي جهاز بيوصل إعلان بيفضّي الكاش كله (`utils/live.ts`)، وأي حفظ من الجهاز ده بيفضّيه
 * هنا. يعني الـ٢٠ ثانية بقت بتطلب نفس القوايم من جديد مع كل تنقّل بعد نص دقيقة — من غير
 * ما يكون فيه جديد أصلاً.
 *
 * فالعمر بقى خمس دقايق **طول ما قناة التحديث متوصّلة** — وده نفس الضمان: اللي اتغيّر
 * بيوصل إعلانه. ولو القناة واقعة (نت فاصل، سيرفر بيقوم) بنرجع للـ٢٠ ثانية زي الأول.
 */
const TTL_LIVE_MS = 5 * 60 * 1000;
const TTL_OFFLINE_MS = 20000;
let liveConnected = false;

/** `utils/live.ts` بيقول هنا القناة متوصّلة ولا لأ. */
export function setLiveConnected(on: boolean) {
  liveConnected = on;
  if (on) return;
  // القناة وقعت ⇒ اللي اتخزّن وهي شغّالة مايعيشش أكتر من ٢٠ ثانية من دلوقتي: الإعلانات
  // اللي هتفوتنا وإحنا مقطوعين مش هتفضّيه.
  const cap = Date.now() + TTL_OFFLINE_MS;
  getCache.forEach((entry) => { if (entry.expiry > cap) entry.expiry = cap; });
}

/**
 * نداءات POST مابتغيّرش داتا حد — مابتفضّيش الكاش.
 *
 * التجديد الدوري للتوكن، تذكرة التحديث الحي، وحفظ المسودّة (بيحصل كل كام ثانية وانت بتكتب
 * فاتورة) كانوا بيفضّوا الكاش كله زي أي حفظ. وأسوأها التجديد اللي بيجري مع فتحة البرنامج:
 * كان بيرجع وطلبات أول شاشة لسه طايرة، فالرقم بيتغيّر وردودها ماتتخزّنش — فأول تنقّل بعد
 * أي ريفرش كان بيعيد كل القوايم. نفس القايمة اللي السيرفر مابيعلنش عنها (`_SKIP_TOPICS`
 * في `backend/src/lib/live_events.py`).
 */
const NON_DATA_PREFIXES = ['/api/v1/auth/', '/api/v1/live/', '/api/v1/drafts'];

function isDataMutation(url: string | undefined): boolean {
  if (!url) return true;
  // الرابط ممكن يكون كامل (نسخة سطح المكتب) — المقارنة على المسار بس.
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/^.*?(\/api\/v1\/)/, '$1');
  return !NON_DATA_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * عدد الطلبات الطايرة — `preloadAllPages` بيستنى لحد ما يبقى صفر قبل ما ينزّل ملف شاشة،
 * عشان التحميل في الخلفية مايزاحمش طلبات الشاشة المفتوحة على اتصالات المتصفح.
 */
let inflight = 0;
export function apiBusy(): boolean {
  return inflight > 0;
}

const originalGet = api.get.bind(api);

api.get = function (url: string, config?: any): Promise<any> {
  const isNoCache = config?.headers?.['Cache-Control'] === 'no-cache';
  // اللي بعد «؟» جزء من العنوان، فبيتشال قبل المقارنة وبيدخل في المفتاح.
  const path = url.split('?')[0];
  // الفرع جزء من المفتاح: نفس القايمة بفلتر فرع تاني رد تاني.
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
        // حصل حفظ والطلب ده كان طاير؟ رده صحيح للّي طلبه، وقديم لأي حد جاي بعده.
        if (startedAt === cacheEpoch) {
          // الهيدرات معاها — `X-Total-Count` بيتقرا منها، والرد المخزّن كان بيرجع من غيرها.
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

// Request interceptor to attach JWT token
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

// Response interceptor for errors and auto-logout
api.interceptors.response.use(
  (response) => {
    inflight = Math.max(0, inflight - 1);
    // Clear cache on any data mutations so UI is always fresh
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

      // Handle 401 Unauthorized / 403 Forbidden -> Session Expired (FR-004)
      if (status === 401 || status === 403) {
        // الحساب لجهاز واحد: الدخول من جهاز تاني بيقفل ده. لازم يبان السبب — «انتهت
        // الجلسة» في الحالة دي بيخلّي الناس تفضل تحاول تدخل وهي مش فاهمة إن حد تاني
        // فاتح بنفس الحساب.
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

      // Handle server validation/business logic violations (e.g., negative stock, Principle XI).
      // FastAPI hands back `detail` as {code, message} for our errors and as a list for
      // pydantic validation — rendering either object directly crashes React (#31).
      const detail = data?.detail;
      const errorMessage =
        (typeof detail === 'string' && detail) ||
        detail?.message ||
        // **ومعاه اسم الخانة.** بيدوين «Field required» من غير اسم كان بيسيب اللي قدامه
        // رسالة مالهاش معنى — لا بيعرف أنهي خانة ولا بيقدر يقول لحد. `loc` من فاست-إيه-بي-آي
        // فيها المسار (`body.branch_id`)، وآخر جزء فيه هو اسم الخانة.
        (Array.isArray(detail) && detail.map((d: any) => {
          const field = Array.isArray(d?.loc)
            ? d.loc.filter((x: any) => x !== 'body').join('.') : '';
          return field ? `${field}: ${d?.msg}` : d?.msg;
        }).filter(Boolean).join('، ')) ||
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
