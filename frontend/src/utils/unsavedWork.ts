/**
 * «هل الخروج دلوقتي هيضيّع حاجة؟» — قاعدة واحدة لكل شاشات المستندات.
 *
 * السؤال ده كان متجاوب عليه غلط في الاتجاهين. شاشة فواتير البيع كانت بتسأل «تسيب
 * المستند؟ فيه ٥ صنف بإجمالي ٣٬٢٦٤٫٤٢ — هيروحوا ومش هيرجعوا» على **فاتورة محفوظة**
 * اتفتحت للتعديل وماتغيّرش فيها حاجة: مافيش حاجة هتروح، الفاتورة على السيرفر زي ما
 * هي، والسؤال بيخوّف من غير سبب. وشاشة المشتريات كانت بتقفل **من غير أي سؤال**، يعني
 * فاتورة اتكتبت سطر سطر بتضيع بضغطة غلط.
 *
 * والسبب واحد: الاتنين كانوا بيسألوا «فيه سطور؟» بدل «فيه شغل مش متحفوظ؟». والسطور
 * على مستند محفوظ مش شغل — هي المستند.
 *
 * فالقاعدة بقت المقارنة: بصمة بتتاخد لحظة فتح المستند، وبصمة تانية لحظة الخروج، ولو
 * الاتنين واحدة يبقى الخروج مش بيكلّف حاجة.
 */

/**
 * بصمة ثابتة للقيمة — مفاتيح مرتّبة عشان ترتيب الكتابة مايعملش فرق.
 *
 * `JSON.stringify` لوحده مابيصلحش: `{a:1,b:2}` و`{b:2,a:1}` بيطلعوا نصّين مختلفين،
 * وإعادة بناء نفس الكائن من رد السيرفر بترتيب مختلف كانت هتبان «تغيير».
 */
export function fingerprint(value: unknown): string {
  const norm = (v: any): any => {
    if (v === undefined || v === null || v === '') return null;
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) {
        const n = norm(v[k]);
        if (n !== null) out[k] = n;
      }
      return out;
    }
    // الرقم اللي جاي من السيرفر نص («5.000») واللي في الشاشة رقم (5) — نفس القيمة
    // بشكلين، وبدون التوحيد ده كل فاتورة محفوظة هتبان متغيّرة أول ما تتفتح.
    if (typeof v === 'number') return Number(v.toFixed(4));
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return Number(Number(v).toFixed(4));
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export type LeaveVerdict =
  /** اخرج على طول — مافيش حاجة هتضيع. */
  | 'silent'
  /** مستند جديد اتكتب فيه شغل ومااتحفظش. */
  | 'confirm-new'
  /** مستند محفوظ اتعدّل والتعديل مااتحفظش. */
  | 'confirm-edit';

export function verdictOnLeave(opts: {
  /** الشاشة للقراية بس — الحقول مقفولة فمافيش تعديل أصلاً. */
  readOnly: boolean;
  /** المستند موجود على السيرفر (مفتوح للتعديل) مش جديد. */
  savedDocument: boolean;
  /** بصمة الشاشة دلوقتي. */
  now: string;
  /** بصمة المستند لحظة ما اتفتح — `null` للمستند الجديد. */
  whenOpened: string | null;
  /** المستند الجديد فيه أي حاجة اتكتبت. */
  hasWork: boolean;
}): LeaveVerdict {
  if (opts.readOnly) return 'silent';
  if (opts.savedDocument) {
    // المقارنة هي الحكم. ولو البصمة الأصلية ضاعت لأي سبب، الأأمن إنه يسأل — سؤال
    // زيادة أرخص من تعديل بيضيع في صمت.
    if (opts.whenOpened === null) return 'confirm-edit';
    return opts.now === opts.whenOpened ? 'silent' : 'confirm-edit';
  }
  return opts.hasWork ? 'confirm-new' : 'silent';
}
