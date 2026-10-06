/**
 * توحيد النص العربي والترتيب الأبجدي — **المكان الوحيد للقاعدتين في الواجهة**.
 *
 * `normalizeAr` كانت عايشة في `ListToolbar` (ملف مكوّن فيه antd) وبتُستعمل في البحث.
 * وهي نفسها اللي الترتيب محتاجها، فاتنقلت هنا: نسختين من نفس القاعدة معناها إن البحث
 * يلاقي صنف والترتيب يحطّه في مكان تاني. و`ListToolbar` بيعيد تصديرها فكل اللي بيستوردها
 * من هناك مابيتلمسش.
 *
 * ---------------------------------------------------------------------------
 * **ليه التوحيد أصلاً.** الترتيب الافتراضي بيرتّب بنقطة الكود، والعربي في يونيكود مش
 * مرتّب أبجدياً بالشكل اللي الناس بتقراه: الهمزات حروف مستقلة فـ«أحمد» و«احمد» بيتفرّقوا،
 * و«ة» بتيجي بعد «ي» كلها، و«ى» غير «ي». فالقايمة بتطلع مبعزقة واللي بيدوّر بعينه على
 * اسم بيعدّي عليه ومايشوفوش.
 *
 *     أ إ آ ٱ  →  ا        الهمزة شكل كتابة مش حرف تاني في الترتيب
 *     ى        →  ي
 *     ة        →  ه
 *     ؤ ئ      →  و ي
 *     ٠-٩      →  0-9
 *     التشكيل بيتشال — «كوع» و«كُوع» اسم واحد
 *
 * الاسم المعروض بيفضل زي ما هو بالحرف: التوحيد ده **للمقارنة بس**.
 *
 * ⚠️ **والقاعدة دي مكتوبة تلات مرات، مرة لكل لغة.** التانيتين:
 *
 *     backend/src/lib/arabic.py
 *     mobile/lib/models/arabic_sort.dart
 *
 * أي تعديل هنا لازم يتعمل في التلاتة، وإلا الكشف اللي السيرفر رتّبه بيتعاد ترتيبه في
 * الشاشة بقاعدة تانية والاتنين بيقولوا ترتيبين.
 */

/** النص موحَّد للبحث والمقارنة. مش للعرض. */
export function normalizeAr(value: any): string {
  return String(value ?? '')
    .replace(/[ً-ْٰ]/g, '')                 // التشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// `localeCompare` بلغة بيبني مقارِن جديد مع كل نداء — وترتيب آلاف الأصناف بيندهها عشرات
// الآلاف من المرات مع كل حرف. مقارِن واحد بنفس الإعدادات بالظبط ونفس النتيجة.
const arCollator = new Intl.Collator('ar', { numeric: true });

/**
 * مقارنة اسمين أبجدياً — للاستعمال المباشر في `sort`:
 *
 *     items.sort((a, b) => compareArabic(a.name, b.name))
 *
 * `numeric` بترتّب الأرقام اللي جوّه النص زي ما العين بتقراها: «ماسورة 2» قبل
 * «ماسورة 10» مش بعدها — وأسماء الأصناف هنا كلها مقاسات.
 */
export function compareArabic(a?: string | null, b?: string | null): number {
  return arCollator.compare(normalizeAr(a), normalizeAr(b));
}

/** نسخة مرتّبة من القايمة — الأصل مابيتلمسش. */
export function sortByName<T>(rows: T[], name: (r: T) => string | null | undefined): T[] {
  return [...rows].sort((x, y) => compareArabic(name(x), name(y)));
}

// ---------------------------------------------------------------- البحث في القوايم
//
// **البحث بيلاقي الحروف في أي مكان، والترتيب بعده أبجدي — والاتنين مش نفس السؤال.**
//
// القايمة المقفولة (`Select` بـ`showSearch`) بتتفلتر بـ`includes` وبتفضل بترتيبها
// الأصلي، فالاسم اللي الحروف في **آخر كلمة** فيه بيطلع فوق الاسم اللي **بيبدأ** بيها.
// اللي بيكتب «كوع» عايز «كوع ٢ باب» مش «جلبة وصل كوع».
//
// نفس القاعدة بالظبط اللي الخادم بيرتّب بيها (`arabic.match_order`)، عشان القايمة
// اللي جاية مرتّبة من السيرفر مايتعادش ترتيبها في الشاشة بقاعدة تانية.

/** نص الخيار اللي بيتبحث فيه — العنوان، وإلا القيمة. */
/**
 * النص اللي البحث بيقيس عليه — **المعروض ومعاه المخفي**.
 *
 * `search` حقل زيادة على الخيار مش بيتعرض: أكواد الأصناف والمخازن اتشالت من الشاشة
 * لأنها بتاكل نص عرض القايمة ومحدش بيقراها، **بس اللي بيدوّر بالكود لسه محتاجها
 * تلاقيه**. من غير السطر ده، إخفاء الكود كان بيمنع البحث بيه كمان.
 */
function optionText(option: any): string {
  const raw = option?.label ?? option?.title ?? option?.children ?? option?.value;
  const shown = normalizeAr(typeof raw === 'string' || typeof raw === 'number' ? raw : '');
  const hidden = option?.search;
  return typeof hidden === 'string' ? `${shown} ${normalizeAr(hidden)}` : shown;
}

/**
 * فلتر `Select` بيوحّد العربي: «جلبه» بتلاقي «جلبة»، و«٢» بتلاقي «2».
 *
 *     <Select showSearch filterOption={searchFilter} filterSort={searchRank} … />
 */
export function searchFilter(input: string, option: any): boolean {
  return matchesWords(optionText(option), normalizeAr(input));
}

/**
 * **كل كلمة مكتوبة موجودة في الاسم — بأي ترتيب، ولو حتة منها.**
 *
 * كان البحث بيدوّر على الجملة المكتوبة حتة واحدة: «كوع نحاس» مابتلاقيش «كوع ١/٢ نحاس»
 * لأن الكلمتين مش جنب بعض، فاللي بيكتب لازم يكتب الاسم كامل بالظبط. دلوقتي «كو نح» كفاية.
 *
 * الاتنين لازم يكونوا متوحّدين بـ`normalizeAr` قبل ما يوصلوا هنا.
 */
export function matchesWords(text: string, needle: string): boolean {
  if (!needle) return true;
  return needle.split(' ').every((w) => text.includes(w));
}

/**
 * **مرتبة الاسم قدّام اللي اتكتب — المكان الوحيد للقاعدة.** بتلات مراتب زي الخادم:
 *
 *     ٠  الاسم بيبدأ بالحروف        «ك» ← «كوع ٢ باب»
 *     ١  كلمة جوّاه بتبدأ بيها       «ك» ← «جلبة كوع ٤"»
 *     ٢  جوّه كلمة                   «ك» ← «تكنو …»
 *
 * طلب العميل (٢٠٢٦-١٠-٠٦): «اكتب ك يجيب اللي بيبدأ بالكاف الأول، واللي الكاف في نصّه
 * آخر حاجة» — في البحث في السيستم كله. فالقاعدة هنا مرة واحدة والكل بيندهها: `searchRank`
 * للقوايم المقفولة، و`searchByName` لشباك الأصناف وسطر الإضافة السريعة.
 *
 * **أكتر من كلمة ⇒ المرتبة من أول كلمة.** «كو نح» كانت بتتقاس كجملة واحدة فمافيش اسم
 * بيبدأ بيها أصلاً، والكل بينزل مرتبة ٢ — يعني كتابة كلمة تانية كانت بتبوّظ الترتيب اللي
 * الكلمة الأولى عملته. الكلمة الأولى هي اللي الناس بتبدأ بيها اسم الصنف.
 * (الخادم `arabic.match_order` لسه بيقيس الجملة كلها — بكلمة واحدة الاتنين نفس الترتيب.)
 *
 * الاتنين متوحّدين بـ`normalizeAr` قبل ما يوصلوا. والمطابقة نفسها (`matchesWords`) مش هنا:
 * دي بتقول **الترتيب** بس، والاسم اللي مش مطابق أصلاً بيتشال قبلها.
 */
export function matchRank(text: string, needle: string): 0 | 1 | 2 {
  if (!needle) return 0;
  const first = needle.split(' ')[0];
  if (text.startsWith(first)) return 0;
  // «1201 — محمد حسن»: الحسابات بتتعرض بالكود قبل الاسم، فالاسم عمره ما كان «بيبدأ»
  // بالحروف. أي جزء بعد «—» بيتحسب بداية.
  if (text.includes(' — ') && text.split(' — ').some((part) => part.trim().startsWith(first))) return 0;
  if (text.includes(` ${first}`)) return 1;
  return 2;
}

/**
 * ترتيب نتايج البحث في `Select` بالقُرب (`matchRank`)، وجوّه المرتبة الواحدة أبجدي
 * فالقايمة تفضل مقروءة.
 *
 * antd بتنده المقارنة دي n·log n مرة، وكل مرة كانت بتوحّد النصّين من الأول. المرتبة والنص
 * الموحَّد بيتحسبوا مرة لكل خيار لكل كتابة — والكاش بيتمسح لما الكتابة تتغيّر.
 */
let rankFor = '';
let rankCache = new WeakMap<object, { t: string; r: number }>();
function optionRank(o: any, n: string): { t: string; r: number } {
  if (n !== rankFor) { rankFor = n; rankCache = new WeakMap(); }
  const hit = o && typeof o === 'object' ? rankCache.get(o) : undefined;
  if (hit) return hit;
  const t = optionText(o);
  const out = { t, r: matchRank(t, n) };
  if (o && typeof o === 'object') rankCache.set(o, out);
  return out;
}

export function searchRank(a: any, b: any, info?: { searchValue?: string }): number {
  const n = normalizeAr(info?.searchValue ?? '');
  if (!n) return 0;
  const x = optionRank(a, n);
  const y = optionRank(b, n);
  return (x.r - y.r) || arCollator.compare(x.t, y.t);
}

/** «2045» أو «A-12»: فيها رقم ومافيهاش حرف عربي ⇒ غالباً بيدوّر بالكود مش بالاسم. */
function looksLikeCode(needle: string): boolean {
  return /\d/.test(needle) && !/[؀-ۿ]/.test(needle);
}

/**
 * **فلترة قايمة أصناف بالبحث وترتيبها بالقُرب** — شباك الأصناف وسطر الإضافة السريعة.
 *
 * المطابقة زي ما هي: كل كلمة مكتوبة موجودة في الاسم بأي ترتيب (`matchesWords`)، أو الحروف
 * جوّه الكود. الجديد **الترتيب**:
 *
 *     كود بيبدأ بالمكتوب — لو المكتوب شكله كود (أرقام)    «204» ← كود 2045
 *     ٠ / ١ / ٢ على الاسم (`matchRank`)
 *     لقيناه بالكود بس
 *
 * وجوّه المرتبة أبجدي عربي (`numeric`: «ماسورة 2» قبل «ماسورة 10»).
 *
 * كان الشباك بيفلتر وبعدين يرتّب أبجدي على طول، فـ«تكنو كوع» بتطلع فوق «كوع» لما تكتب
 * «ك» — عشان التاء قبل الكاف. التوحيد والمرتبة بيتحسبوا **مرة لكل صنف لكل كتابة**، مش
 * جوّه المقارنة: الترتيب بيقارن آلاف الأسماء.
 *
 * `needle` لازم يكون متوحّد بـ`normalizeAr`. فاضي ⇒ القايمة زي ما هي (ولا فلترة ولا ترتيب).
 */
export function searchByName<T>(
  rows: T[],
  needle: string,
  name: (r: T) => string | null | undefined,
  code?: (r: T) => string | null | undefined,
): T[] {
  if (!needle) return rows;
  const codeFirst = looksLikeCode(needle);
  const hits: { row: T; t: string; r: number }[] = [];
  for (const row of rows) {
    const t = normalizeAr(name(row));
    const c = code ? normalizeAr(code(row)) : '';
    let r: number;
    if (codeFirst && c && c.startsWith(needle)) r = -1;
    else if (matchesWords(t, needle)) r = matchRank(t, needle);
    else if (c && c.includes(needle)) r = 3;
    else continue;
    hits.push({ row, t, r });
  }
  hits.sort((a, b) => (a.r - b.r) || arCollator.compare(a.t, b.t));
  return hits.map((h) => h.row);
}
