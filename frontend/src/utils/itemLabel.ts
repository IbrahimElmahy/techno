/**
 * **الصنف والمخزن بيتعرضوا باسمهم، والكود بيفضل للبحث.**
 *
 * القايمة كانت بتكتب «AL-00700000013 — ١/٤ غراء حار ابيه...» — الكود بياخد نص عرض
 * الخانة والاسم بيتقطع، واللي بيختار بيقرا نص الاسم ويخمّن الباقي. والكود نفسه رقم
 * نقل من a5 ومحدش في المصنع بيحفظه.
 *
 * **بس اللي بيدوّر بالكود لسه لازم يلاقيه** — الفاتورة القديمة بتقول كود، والعميل
 * بيسأل بكود. فبيتحط في `search`، وهو حقل `optionText` بيقراه ومابيتعرضش
 * (`utils/arabicSort`).
 */
export interface Coded { id: number; code?: string | null; name: string }

/** خيار `Select`: الاسم معروض، والكود بيتبحث بيه. */
export function codedOption<T extends Coded>(x: T, suffix = '') {
  return {
    value: x.id,
    label: `${x.name}${suffix}`,
    search: x.code || '',
  };
}

/** قايمة خيارات جاهزة. */
export function codedOptions<T extends Coded>(list: T[], suffix?: (x: T) => string) {
  return list.map((x) => codedOption(x, suffix ? suffix(x) : ''));
}
