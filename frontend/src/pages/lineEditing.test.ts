/**
 * سطور الفاتورة بتتبني من الحالة الحالية، مش من نسخة قديمة اتقفلت عليها الدالة.
 *
 * فاتورة الشراء كانت مش بتقبل أكتر من صنف، والسبب سطر واحد. `addProductById` كانت بتضيف السطر
 * الفاضي الأول، وبعدين تنادي `handleItemChange` بـ`setTimeout` عشان تحطّ الصنف جوّاه — و
 * `handleItemChange` كانت بتبني المصفوفة الجديدة من `purchaseItems` بتاعة الرندر اللي اتعرّفت فيه.
 * النسخة دي مفيهاش السطر اللي لسه اتضاف، فكانت بتتكتب فوقه وتشيله.
 *
 * الصنف الأول كان بيعدّي — بينزل في السطر الفاضي الموجود من بدري، فمافيش سطر بيتضاف والنسختين
 * بيطلعوا واحد. الصنف التاني كان بيختفي. وده اللي بيخلّي العطل يبان كأن الشاشة «مش بتضيف أكتر من
 * صنف» بدل ما يبان كتحديث حالة قديم.
 *
 * الاختبار على النص عن قصد: العطل مش في قيمة بتتحسب غلط، هو في **الشكل** — تحديث بيقرا مصفوفة
 * من الـclosure بدل `prev`. الشكل ده هو اللي لازم يفضل ممنوع، مهما اتغيّرت الأرقام.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('تحديث سطور فاتورة الشراء', () => {
  const src = read('Purchases.tsx');

  it('handleItemChange بتحدّث من prev', () => {
    expect(src).toMatch(/const handleItemChange = \([^)]*\) => \{\s*\n\s*setPurchaseItems\(\(prev\) =>/);
  });

  it('مفيش تحديث بيبني السطور من purchaseItems بتاعة الـclosure', () => {
    // `setPurchaseItems(purchaseItems...)` — أي واحدة زي دي بتكتب فوق أي سطر اتضاف بعد آخر رندر.
    const derived = [...src.matchAll(/setPurchaseItems\(\s*(purchaseItems[.[])/g)];
    expect(derived.map((m) => m[0]), 'تحديث بيقرا نسخة قديمة من السطور').toEqual([]);
  });

  it('إضافة الصنف كلها في تحديث واحد — مفيش setTimeout بيعبّي السطر بعدين', () => {
    const add = src.slice(src.indexOf('const addProductById'),
      src.indexOf('const handleProductPicked'));
    expect(add, 'التعبية اتأجلت لتيك تاني — والسطر ممكن يكون اتكتب فوقه').not.toMatch(/setTimeout/);
    expect(add, 'الصنف والسعر لازم ينزلوا جوّا نفس التحديث').toMatch(/item_id: itemId, unit_price: price/);
  });

  it('اللوب بتاع «اختار كذا صنف» بيبني كل دورة على اللي قبلها', () => {
    // كل الفروع بتقرا `prev` — فعشر دورات ورا بعض بيشوفوا بعض، حتى قبل ما رندر يحصل.
    const add = src.slice(src.indexOf('const addProductById'),
      src.indexOf('const handleProductPicked'));
    expect(add).toMatch(/prev\.find\(\(l\) => l\.item_id === itemId\)/);
    expect(add).toMatch(/prev\.find\(\(l\) => l\.item_id === null\)/);
  });

  it('العين بتروح للسطر بعد ما السطور تستقر', () => {
    // مفتاح السطر مايتقررش غير جوّا التحديث (فاضي اتعبّى؟ مكرر زادت كميته؟ جديد اتضاف؟).
    expect(src).toMatch(/landedRef\.current = /);
    expect(src).toMatch(/setFocusLineKey\(landedRef\.current\)/);
  });
});
