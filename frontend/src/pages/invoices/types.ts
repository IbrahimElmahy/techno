/**
 * أنواع شاشة الفواتير وثوابتها — مشتركة بين الشاشة وبنّائي أعمدتها.
 *
 * الشاشة ٣١٢٠ سطر، واللي بيدوّر على شكل سطر الفاتورة كان بيعدّي على مية سطر
 * منطق قبل ما يوصله. الأنواع هنا لوحدها، والمنطق اللي بيستعملها هناك.
 */
/** نافذة كتم تكرار تحذير قص الكمية — بالملي ثانية. */
export const CAP_NOTICE_MS = 3000;

// حجم الصفحة في شاشة الفواتير. الكشف كله بقى 6163 فاتورة بعد نقل داتا a5،
// و«اعرض كل حاجة» بقى معناه 2.9 ميجا في كل فتحة. الفلترة والبحث على السيرفر
// فالصفحة دي مش بتخفي حاجة عن اللي بيدوّر.
export const PAGE_SIZE = 300;

export interface InvoiceRecord {
  id: number;
  document_number: string;
  /** فاتورة بونص، والفاتورة اللي هي عليها. */
  is_bonus?: boolean;
  bonus_for_invoice_id?: number | null;
  bonus_for_number?: string | null;
  customer_id: number;
  gross: string;
  combined_pct: string;
  net: string;
  cash_amount: string;
  credit_amount: string;
  ledger_entry_id: number;
  // (المرحلة ٣) «وصل منها كام» — من مطابقة الدفعات، مش من `credit_amount` اللي
  // بيقول «اتباعت بكام أجل» يوم البيع وبس.
  payment_state?: 'not_paid' | 'partial' | 'paid' | null;
  payment_state_label?: string | null;
  residual?: string | null;
}

/** أسعار صنف واحد بفئاته وخصوماته. */
export interface ItemPrices {
  base: number | null;
  tiers: Record<string, number>;
  discounts: Record<string, number>;
}

export interface Customer {
  id: number;
  name: string;
  default_price_tier: string | null;
  /** خصم العميل نفسه — بيسبق خصم الصنف. شوف `defaultFixedDiscount`. */
  discount_pct: string | null;
  // Every customer has exactly one rep, required since 001. It is the first link in the chain
  // that lets choosing a customer fill in who is selling and which store the goods leave from.
  rep_id: number;
}

/** An employee — the payroll record. `warehouse_id` is the store this person works out of, and
 *  `user_id` is the login they sell under. Together they turn a customer's rep into a store. */
export interface RepEmployee {
  id: number;
  name: string;
  warehouse_id: number | null;
  user_id: number | null;
}


/**
 * «نوع الفاتورة» — خط المنتجات: أبيض ولا بولي.
 *
 * القايمة دي كانت مكتوبة بإيدها في تلات حتت: خانة الترويسة، وفلتر الكشف، وعمود الكشف.
 * تلات نسخ لحاجة واحدة معناها إن اللي هيضيف خط رابع هيلاقي الشاشة بتقول حاجتين مختلفتين
 * على حسب إنت بتبص من فين. فبقت مصدر واحد، والبوّابة الجديدة بتقرا منه هي كمان بدل ما
 * تعمل نسخة رابعة.
 */
export const FAMILY_OPTIONS = [
  { value: 'أبيض', label: 'أبيض' },
  { value: 'بولي', label: 'بولي' },
];

export const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري',
  semi_commercial: 'نصف تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نصف جملة',
  consumer: 'مستهلك',
};

export interface Product {
  id: number;
  code: string;
  name: string;
  sale_price: string | null;
  is_serialized: boolean;
  category: string | null;
  default_discount_pct: string | null;   // the item's own fixed discount
}

export interface Warehouse {
  id: number;
  name: string;
}

export interface SaleLineItem {
  key: string;
  category: string | null;         // chosen first; filters the item list
  item_id: number | null;
  /** null = «not typed yet». A quantity box that starts at 1 makes «5» into «15» for anybody who
   *  types without clearing it first, and the invoice is out by ten with nothing looking wrong. */
  quantity: number | null;
  unit_price: number;
  tier: string | null;
  unit: string | null;
  serials: string;
  fixed_discount: number;          // the item's own fixed discount (auto)
  variable_discount: number | null;  // a typed extra discount on this line; null until typed
  warehouse_id: number | null;     // (030) this line is served from its own warehouse
}

export interface ItemUnit { name: string; factor: number; is_base: boolean; }

export interface InvoiceDetail {
  id: number;
  lines: Array<{
    item_id: number;
    quantity: string;
    unit_price: string;
    line_total: string;
  }>;
}

export interface InvoiceFilters {
  q?: string;
  customer_id?: number;
  date_from?: string;
  date_to?: string;
  payment?: string;   // cash | credit | partial
  rep_id?: number;
  family?: string;
  /** جزء من «البيان». */
  statement?: string;
}

/**
 * كام كوبون بين رقمين — محسوبة، مش متكتوبة.
 *
 * The count was a field somebody typed beside «من ٥٠» and «إلى ١٠٠». Two ways to say one thing,
 * and they disagree the first time anybody edits the range and forgets the number — after which
 * the invoice claims a book size the serials do not support, and the receipt screen refuses
 * coupons the customer is holding.
 *
 * Inclusive: 50→100 is fifty-one coupons, because the customer is handed both of them.
 *
 * Serial numbers here are digits, sometimes with a prefix («A-1050»). Only the trailing digits are
 * compared, and when the two ends do not share a prefix — or either is not a number — the answer
 * is null rather than a guess. A wrong count is worse than no count: it posts.
 */
export function couponCount(from?: string | null, to?: string | null): number | null {
  const f = String(from ?? '').trim();
  const t = String(to ?? '').trim();
  if (!f || !t) return null;
  const split = (v: string) => {
    const m = v.match(/^(.*?)(\d+)$/);
    return m ? { prefix: m[1], n: Number(m[2]) } : null;
  };
  const a = split(f);
  const b = split(t);
  if (!a || !b || a.prefix !== b.prefix) return null;
  if (b.n < a.n) return null;      // «من ١٠٠ إلى ٥٠» is a typo, not a range of -49
  return b.n - a.n + 1;
}

/** الكوبونات المصروفة مع الفاتورة — صف لكل نوع، مش صف واحد للكل.
 *
 * كان مدى واحد بيسجّل إن كوبونات اتسلّمت من غير ما يقول أنهي كوبونات: مية دهبي وخمسين
 * فضي بينهم خانتين. المدى فضل على كل صف لأنه هو اللي تطبيق المرتجعات بيراجع عليه الرقم
 * الراجع؛ والنوع هو اللي بيخلّي الدفاتر تقدر تقول اتصرف إيه. */
export interface CouponRow {
  key: string;
  // فئة الدفتر — عادي/فضي/ذهبي/ماسي. دي اللي بتحدد الكوبون مع رقمه، مش «كتالوج
  // الكوبونات» اللي هو عروض استبدال النقاط.
  coupon_kind?: string;
  coupon_type_id?: number;
  count?: number;
  serial_from?: string;
  serial_to?: string;
}

/** صف فاضي جديد. بيتعمل واحد من دول أول ما الفاتورة تتفتح، عشان الخانات تبقى قدام
 *  الواحد على طول من غير ما يدوس «إضافة» الأول. */
/**
 * «الصف ده فيه كوبون ولا فاضي؟» — سؤال واحد بإجابة واحدة.
 *
 * كان متسأل في مكانين بإجابتين: اللي بيبني الحمولة بيبص على `coupon_kind`، وزرار
 * الحفظ بيبص على `coupon_type_id`. و`coupon_type_id` حاجة تانية خالص — كتالوج
 * استبدال النقاط، وجدوله فاضي ومحدش بيملاه من الشاشة دي.
 *
 * فالنتيجة إن فاتورة **كوبونات بس من غير أصناف** — ودي حالة شغل حقيقية عند العميل،
 * فيه ٧٢٣ منها في الداتا المنقولة — كان زرار الحفظ فيها مقفول: الشاشة شايفة الكوبون
 * والزرار شايف المستند فاضي، ومافيش حاجة بتقول ليه.
 */
export function couponRowHasContent(r: CouponRow): boolean {
  return Boolean(r.coupon_kind || r.serial_from || r.serial_to);
}

export function blankCoupon(): CouponRow {
  return { key: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}` };
}

