/**
 * شكل الأرقام على الشاشة — عربي «٠١٢٣» ولا إنجليزي «0123»؟ اختيار كل مستخدم لوحده.
 *
 * النظام كله كان بيكتب الأرقام عربية بالثابت (`toLocaleString('ar-EG')`). وده صح لناس
 * وغلط لناس: اللي بيراجع كشف حساب بعينه العربي مرتاح فيه، واللي جاي من a5 أو بيقارن
 * الشاشة بورقة إكسل بيقرا «١٬٢٣٤٫٥٠» مرتين قبل ما يتأكد إنها ١٢٣٤٫٥٠. الفرق ده مش
 * ذوق — هو سرعة قراءة، وبيختلف من راجل للتاني على نفس الشاشة.
 *
 * **الاختيار مخزّن باسم المستخدم، مش للجهاز كله.** مافيش endpoint لتفضيلات المستخدم
 * في السيرفر (شوفنا `api/users.py` و`auth/me` — مافيش مكان يتحط فيه)، والباك إند خارج
 * نطاق الشغل ده. و`localStorage` بمفتاح واحد كان هيخلّي المحاسب والمخزنجي اللي بيدخلوا
 * على نفس الجهاز يتخبطوا: اللي يغيّره واحد يلاقيه التاني اتغيّر عنده. فالمفتاح فيه
 * اسم المستخدم — هو المعرّف الوحيد اللي موجود في الجلسة المخزّنة (`localStorage.user`
 * فيه `username` ومافيهوش `id`) وهو فريد على مستوى النظام.
 *
 * **والمخزّن والمُرسل بيفضلوا لاتينيين دايماً.** ده إعداد عرض بس؛ أي رقم رايح للسيرفر
 * أو متكتب في خانة إدخال بيفضل زي ما هو (اقرا `utils/money.ts`).
 */
import { useSyncExternalStore } from 'react';

export type Numerals = 'arabic' | 'latin';

export const NUMERALS_LABELS: Record<Numerals, string> = {
  arabic: 'عربي ٠١٢٣',
  latin: 'إنجليزي 0123',
};

const KEY_PREFIX = 'techno.numerals.';

/**
 * اللغة اللي بتحدد شكل الرقم عند `toLocaleString`.
 *
 * `en-EG` مش `en-US`: هي اللي مستعملة أصلاً في المواضع اللاتينية الموجودة في الريبو،
 * وبتدّي نفس الفاصلة والنقطة (`1,234.50`) مع الفئة المحلية.
 */
const LOCALES: Record<Numerals, string> = { arabic: 'ar-EG', latin: 'en-EG' };

function keyFor(username: string | null | undefined): string {
  return KEY_PREFIX + (username && username.trim() ? username.trim() : 'default');
}

/** اسم المستخدم من الجلسة المخزّنة — نفس المكان اللي `AuthProvider` بيقرا منه وقت الإقلاع. */
function storedUsername(): string | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return (JSON.parse(raw) as { username?: string }).username ?? null;
  } catch {
    return null;
  }
}

function read(key: string): Numerals {
  try {
    const v = localStorage.getItem(key);
    if (v === 'arabic' || v === 'latin') return v;
  } catch { /* وضع خاص أو تخزين مقفول — نكمّل بالافتراضي */ }
  // العربي هو الافتراضي لأنه اللي النظام كان شغّال بيه، فاللي ماغيّرش مايلاقيش شاشته اتغيّرت.
  return 'arabic';
}

let activeKey = keyFor(storedUsername());
let current: Numerals = read(activeKey);

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

/** الاختيار الحالي — بتتنادي من دوال التنسيق، فلازم تفضل قراءة من الذاكرة مش من `localStorage`. */
export function getNumerals(): Numerals {
  return current;
}

/** اللغة اللي تتبعت لـ`toLocaleString` — للتواريخ كمان مش للأرقام بس. */
export function numeralsLocale(): string {
  return LOCALES[current];
}

export function setNumerals(next: Numerals): void {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(activeKey, next); } catch { /* مايستاهلش نوقّع الشاشة عشانه */ }
  emit();
}

/**
 * بتربط الاختيار بالمستخدم اللي داخل دلوقتي.
 *
 * بتتنادي بعد الدخول وبعد الخروج: من غيرها اللي يدخل بعد زميله ياخد اختيار زميله لحد
 * أول تحديث للصفحة، لأن المفتاح اتحسب مرة واحدة وقت تحميل الموديول.
 */
export function bindNumeralsUser(username: string | null | undefined): void {
  const key = keyFor(username);
  if (key === activeKey) return;
  activeKey = key;
  const next = read(key);
  if (next !== current) {
    current = next;
    emit();
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * الاشتراك في الاختيار.
 *
 * مين اللي بيشترك؟ **`App` نفسه** — مش كل شاشة. دوال التنسيق (`money` / `qty` / `num`)
 * دوال عادية مش هوكس، فالخلية اللي بتنادي `money(v)` مش بتعرف إن في اختيار اتغيّر.
 * واشتراك `App` بيخلّي رندر واحد يعيد رسم الشجرة كلها من غير ما تتفكّ (نفس النوع ونفس
 * المكان ⇒ الحالة بتفضل، فالتبويبات المفتوحة والفواتير النصّ مكتوبة مابتضيعش).
 */
export function useNumerals(): Numerals {
  return useSyncExternalStore(subscribe, getNumerals, getNumerals);
}
