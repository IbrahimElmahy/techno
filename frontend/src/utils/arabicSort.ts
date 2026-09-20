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

/**
 * مقارنة اسمين أبجدياً — للاستعمال المباشر في `sort`:
 *
 *     items.sort((a, b) => compareArabic(a.name, b.name))
 *
 * `numeric` بترتّب الأرقام اللي جوّه النص زي ما العين بتقراها: «ماسورة 2» قبل
 * «ماسورة 10» مش بعدها — وأسماء الأصناف هنا كلها مقاسات.
 */
export function compareArabic(a?: string | null, b?: string | null): number {
  return normalizeAr(a).localeCompare(normalizeAr(b), 'ar', { numeric: true });
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
function optionText(option: any): string {
  const raw = option?.label ?? option?.title ?? option?.children ?? option?.value;
  return normalizeAr(typeof raw === 'string' || typeof raw === 'number' ? raw : '');
}

/**
 * فلتر `Select` بيوحّد العربي: «جلبه» بتلاقي «جلبة»، و«٢» بتلاقي «2».
 *
 *     <Select showSearch filterOption={searchFilter} filterSort={searchRank} … />
 */
export function searchFilter(input: string, option: any): boolean {
  const n = normalizeAr(input);
  return !n || optionText(option).includes(n);
}

/**
 * ترتيب نتايج البحث بالقُرب — بتلات مراتب زي الخادم:
 *
 *     ٠  بيبدأ بالحروف          «كوع ٢ باب»
 *     ١  كلمة جوّاه بتبدأ بيها   «جلبة كوع ٤"»
 *     ٢  جوّه كلمة               «مكوعة»
 *
 * وجوّه المرتبة الواحدة الترتيب أبجدي، فالقايمة تفضل مقروءة.
 */
export function searchRank(a: any, b: any, info?: { searchValue?: string }): number {
  const n = normalizeAr(info?.searchValue ?? '');
  if (!n) return 0;
  const rank = (o: any) => {
    const t = optionText(o);
    if (t.startsWith(n)) return 0;
    if (t.includes(` ${n}`)) return 1;
    return 2;
  };
  return (rank(a) - rank(b)) || compareArabic(optionText(a), optionText(b));
}
