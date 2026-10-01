import { useEffect, useRef } from 'react';
import { api, clearApiCache, getApiBaseURL, setLiveConnected } from '../api/client';
import { useOnScreen } from '../components/keyboard';

/**
 * التحديث الحي — الشاشة المفتوحة بتجيب الجديد لوحدها لما حاجة تتغيّر.
 *
 * فاتورة بتترفع من التطبيق، سند، تحويل، مرتجع… كانت بتبان بس لما اللي قاعد قدام الشاشة
 * يعمل ريفرش بإيده — وده بيضيّع الفلتر والصفحة واللي كان كاتبه. السيرفر دلوقتي بيعلن
 * «الموضوع ده اتغيّر» على قناة SSE (`/api/v1/live/events`، الشرح في
 * `backend/src/lib/live_events.py`)، والشاشة اللي مهتمة بالموضوع بتطلب داتاها من جديد
 * **بهدوء**: من غير سبينر، ومن غير ما الفلاتر أو الصفحة أو المودال المفتوح يتلمسوا.
 *
 * اتصال واحد للتطبيق كله (مش واحد لكل شاشة): المتصفح بيسمح بستة اتصالات بس لنفس الدومين
 * على HTTP/1.1، وكل اتصال SSE بياخد واحد منهم للأبد.
 */

type Listener = (topic: string) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let wanted = false;
let retryTimer: number | undefined;
let failures = 0;
// إمتى الاتصال وقع — عشان نعرف لو فاتنا إعلانات وإحنا مقطوعين.
let downSince: number | null = null;

/** موضوع خاص: «ماتعرفش إيه اللي اتغيّر — حدّث كله». */
const ANY = '*';

/**
 * كل حاجة بتحرّك رصيد صنف في مخزن — للشاشات اللي بتعرض أرصدة.
 *
 * الموضوع هو أول جزء في مسار الطلب (`/api/v1/<topic>/...`)، فالرصيد بيتغيّر من كذا باب:
 * البيع ومرتجعه تحت `sales`، الشراء ومردوده تحت `purchases`، الأذونات تحت `stock`…
 */
export const STOCK_TOPICS = [
  'sales', 'purchases', 'transfers', 'stock', 'manufacturing', 'wastage', 'stock-counts',
];

function emit(topic: string) {
  // الكاش في `api/client.ts` بيتفضّى مع أي حفظ من الجهاز ده بس. حفظ من جهاز تاني كان
  // هيخلّي التحديث الهادي يرجّع نفس القايمة المخزّنة (عملاء، أصناف…) لحد ٢٠ ثانية.
  clearApiCache();
  listeners.forEach((fn) => {
    try { fn(topic); } catch { /* شاشة وقعت مابتوقفش الباقي */ }
  });
}

let connecting = false;

function retryLater() {
  if (downSince === null) downSince = Date.now();
  if (!wanted) return;
  failures += 1;
  const delay = Math.min(60000, 1000 * 2 ** Math.min(failures - 1, 6)) + Math.random() * 1000;
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(connect, delay);
}

async function connect() {
  if (!wanted || source || connecting || typeof EventSource === 'undefined') return;
  if (!localStorage.getItem('token')) return;
  // `EventSource` مابيبعتش هيدرات، والرابط بيتسجّل في لوج السيرفر — فالتوكن نفسه مايتحطّش
  // فيه. بناخد **تذكرة** بنداء عادي (التوكن في الهيدر زي أي نداء)، بتنفع مرة واحدة وفي
  // خلال دقيقة، وهي اللي بتروح في الرابط. وبتتاخد من جديد مع كل فتح، فالتوكن المتجدد
  // بيوصل لوحده — السيرفر بيقفل الاتصال كل عشر دقايق.
  connecting = true;
  let ticket: string | undefined;
  try {
    const res = await api.post('/api/v1/live/ticket');
    ticket = res.data?.ticket;
  } catch {
    ticket = undefined;
  } finally {
    connecting = false;
  }
  if (!wanted || source) return;
  if (!ticket) { retryLater(); return; }
  // الأساس هو نفس بتاع axios، فبيشتغل على الإنتاج وعلى `/staging` وعلى نسخة سطح المكتب.
  const url = `${getApiBaseURL()}/api/v1/live/events?ticket=${encodeURIComponent(ticket)}`;
  const es = new EventSource(url);
  source = es;

  es.onopen = () => {
    failures = 0;
    // الكاش يطوّل عمره بس والإعلانات واصلة — شوف `TTL_LIVE_MS` في `api/client.ts`.
    setLiveConnected(true);
    // كنا مقطوعين فترة (لابتوب نام، النت فصل، السيرفر اتعمله ريستارت)؟ الإعلانات اللي
    // حصلت ساعتها ضاعت، فكل شاشة بتحدّث نفسها مرة. القفل الدوري من السيرفر بيرجع في
    // ثانية فمابيعدّيش على الشرط ده.
    if (downSince !== null && Date.now() - downSince > 5000) emit(ANY);
    downSince = null;
  };

  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      if (ev && typeof ev.topic === 'string') emit(ev.topic);
    } catch { /* سطر مش مفهوم — نتجاهله */ }
  };

  es.onerror = () => {
    setLiveConnected(false);
    // إعادة الاتصال بإيدنا مش بتاعة المتصفح: المتصفح بيعيد بنفس الرابط — يعني نفس التذكرة
    // اللي اتصرفت — وعلى 401 بيسيبها خالص. هنا بناخد تذكرة جديدة ونستنى أكتر مع كل فشل.
    es.close();
    if (source === es) source = null;
    retryLater();
  };
}

/** بعد الدخول. بيتنادى تاني من غير ضرر. */
export function startLive() {
  wanted = true;
  connect();
}

/** مع الخروج — الاتصال مايفضلش مفتوح بتوكن حد خرج. */
export function stopLive() {
  wanted = false;
  setLiveConnected(false);
  window.clearTimeout(retryTimer);
  source?.close();
  source = null;
  downSince = null;
  failures = 0;
}

export function onLiveEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * الشاشة دي تحدّث نفسها لما موضوع من `topics` يتغيّر.
 *
 * `refresh` لازم تكون **هادية**: تجيب الداتا وتحطها من غير سبينر ومن غير ما تلمس فلتر
 * أو صفحة أو فورم. الهوك بيقرا آخر نسخة منها وقت النداء، فمش لازم تتعمل `useCallback`.
 *
 * * **مجمّعة:** عشر إعلانات ورا بعض (فاتورة بسطورها وسندها) = طلب واحد بعد ~٨٠٠ms، ومش
 *   أكتر من ٣ ثواني تأخير حتى لو الإعلانات مابتقفش.
 * * **الشاشة المخبية مابتطلبش:** تبويب المتصفح في الخلفية، أو شاشة متمسّكة ورا الستار في
 *   مساحة الشغل (`TabWorkspace`) — بتتعلّم إن فيه جديد، وبتحدّث مرة واحدة لما تبان.
 * * `enabled: false` بيأجّل بنفس الطريقة — للشاشة اللي تحديثها بيبوّظ حاجة مفتوحة.
 */
export function useLiveRefresh(
  topics: string[],
  refresh: () => void,
  opts: { enabled?: boolean } = {},
) {
  const onScreen = useOnScreen();
  const enabled = opts.enabled ?? true;

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const shownRef = useRef(onScreen && enabled);
  shownRef.current = onScreen && enabled;

  const pending = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const firstAt = useRef<number | null>(null);

  const fireRef = useRef(() => {});
  fireRef.current = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    firstAt.current = null;
    if (document.hidden || !shownRef.current) {
      pending.current = true;
      return;
    }
    pending.current = false;
    try { refreshRef.current(); } catch { /* التحديث الهادي مايوقعش الشاشة */ }
  };

  const topicsKey = topics.join('|');
  useEffect(() => {
    const wantedTopics = new Set(topicsKey.split('|'));
    const off = onLiveEvent((topic) => {
      if (topic !== ANY && !wantedTopics.has(topic)) return;
      const now = Date.now();
      if (firstAt.current === null) firstAt.current = now;
      window.clearTimeout(timer.current);
      const wait = Math.max(0, Math.min(800, firstAt.current + 3000 - now));
      timer.current = window.setTimeout(() => fireRef.current(), wait);
    });
    return () => {
      off();
      window.clearTimeout(timer.current);
    };
  }, [topicsKey]);

  // رجعت للتبويب ⇒ اللي فاتك بيتجاب مرة واحدة.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && pending.current) fireRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // الشاشة ظهرت في مساحة الشغل، أو المانع (`enabled`) اتشال.
  useEffect(() => {
    if (onScreen && enabled && pending.current) fireRef.current();
  }, [onScreen, enabled]);
}
