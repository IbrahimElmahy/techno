/**
 * فاتورة الشرا بتتكتب في جدول إدخال — سطر لكل صنف، والإيد مابتسيبش الكيبورد.
 *
 * العميل صوّر الشاشة اللي هو شغّال عليها وطلب نفس الطريقة: عنوان أعمدة مرة واحدة فوق، كل صنف سطر،
 * والمخزن أول خانة تتحدّد. اللي كان عندنا كروت متجمّعة بالفئة — كل سطر بياخد مساحة كبيرة، وفاتورة
 * خمستاشر صنف بتبقى صفحتين تمرير، والكميات والأسعار مالهاش عمود تتقارن فيه رأسياً.
 *
 * وحاجة واحدة في الشاشة اللي صوّرها **مش** هتتعمل: عمود الباركود والبحث بيه. الباركود اتشال من
 * النظام بطلب العميل نفسه، والاختبار ده بيمنع رجوعه من باب «الشاشة التانية فيها».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'Purchases.tsx'), 'utf8');
const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');

describe('شكل الجدول', () => {
  it('السطور في جدول بترويسة أعمدة، مش كروت', () => {
    expect(src).toMatch(/<table className="entry-grid">/);
    expect(src, 'الكروت المتجمّعة بالفئة لسه موجودة').not.toMatch(/linesByCategory/);
  });

  it('الأعمدة اللي الفاتورة بتتكتب بيها كلها موجودة', () => {
    const head = src.slice(src.indexOf('<thead>'), src.indexOf('</thead>'));
    for (const col of ['المخزن', 'الوحدة', 'الكمية', 'سعر الوحدة',
      'اجمالي قبل', 'خصم متغير %', 'خصم ثابت %', 'الإجمالي']) {
      expect(head, `عمود «${col}» ناقص`).toContain(col);
    }
  });

  it('المخزن أول خانة في السطر', () => {
    // هو أول حاجة بتتحدّد، وبيثبت للسطور اللي بعده لغاية ما يتغيّر.
    const body = src.slice(src.indexOf('<tbody>'), src.indexOf('</tbody>'));
    expect(body.indexOf('مخزن الاستلام')).toBeGreaterThan(-1);
    expect(body.indexOf('مخزن الاستلام')).toBeLessThan(body.indexOf('data-qty-key'));
  });

  it('عمود اسم الصنف موجود', () => {
    // اتشال مرة بطلب صاحب النظام، والنتيجة إن الفاتورة بقت سطور كمية وسعر من غير ما حد
    // يعرف كل سطر بتاع إيه — فرجع بطلبه كمان. المراجعة كلها بتبدأ من «ده صنف إيه».
    const head = src.slice(src.indexOf('<thead>'), src.indexOf('</thead>'));
    expect(head, 'عمود الصنف ناقص').toContain('الصنف');
  });

  it('الترويسة بتفضل بانة والفاتورة الطويلة بتتمرّر تحتها', () => {
    // عمود من غير اسمه رقم مجهول — وفاتورة خمستاشر صنف بتخرج الترويسة برّه الشاشة.
    const block = css.slice(css.indexOf('.entry-grid thead th'));
    expect(block.slice(0, 400)).toContain('position: sticky');
  });
});

describe('الحركة بالكيبورد', () => {
  it('Enter في أي خانة بينزل للسطر اللي بعده', () => {
    // «اعدّل الوحدة والكمية والخصم وادوس Enter يدخلني على اللي بعده» — طلب العميل بالنص.
    const enters = [...src.matchAll(/onPressEnter=\{\(e\) => \{ e\.preventDefault\(\); advanceFrom\(line\.key\); \}\}/g)];
    expect(enters.length, 'مش كل خانة بتكمّل بـEnter').toBeGreaterThanOrEqual(3);
  });

  it('آخر سطر بيفتح بوباب الأصناف بدل ما يقف', () => {
    const advance = src.slice(src.indexOf('const advanceFrom'));
    expect(advance.slice(0, 400)).toContain('setFocusLineKey(next.key)');
    expect(advance.slice(0, 400)).toContain('setPickerOpen(true)');
  });

  it('خانة الكمية لسه بتتلقى التركيز بالمفتاح بتاعها', () => {
    // نفس المحرك اللي بينقل المؤشر بعد إضافة صنف — لو الواصفة اتغيّرت التركيز بيقع في السكوت.
    expect(src).toMatch(/data-qty-key=\{line\.key\}/);
    expect(src).toMatch(/input\[data-qty-key="\$\{focusLineKey\}"\]/);
  });
});

describe('الباركود', () => {
  it('مفيش عمود باركود ولا بحث بيه', () => {
    // اتشال من النظام بطلب العميل. الشاشة اللي صوّرها فيها عمود باركود وبحث بيه، وقال بالنص
    // إنه مش عايزه — فالاختبار ده بيمنع رجوعه من باب المطابقة.
    //
    // بيدوّر على واجهة مش على الكلمة: التعليق اللي بيشرح ليه الباركود مش موجود بيذكره بالضرورة،
    // واختبار بيقع على شرحه بيتشال أول مرة يزعق بدل ما يتصلّح.
    const head = src.slice(src.indexOf('<thead>'), src.indexOf('</thead>'));
    expect(head, 'رجع عمود باركود').not.toMatch(/باركود|barcode/i);

    const markup = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(markup, 'رجعت خانة أو بحث بالباركود').not.toMatch(/(placeholder|label|title)=["'][^"']*باركود/i);
    expect(markup, 'رجع حقل باركود').not.toMatch(/barcode/i);
  });
});

describe('صف الإجمالي', () => {
  it('الجدول بينتهي بصف بيجمع الكميات والقيم', () => {
    // «الفاتورة دي كام قطعة وبكام» سؤال بيتسأل وانت بتكتب — والإجابة كانت محتاجة تمرير لتحت.
    expect(src).toMatch(/<tfoot>/);
    const foot = src.slice(src.indexOf('<tfoot>'), src.indexOf('</tfoot>'));
    expect(foot, 'مافيش مجموع كميات').toContain("l.quantity || 0");
    expect(foot, 'مافيش مجموع قيم').toContain('fmtMoney(grossTotal)');
  });
});

describe('خانة الوحدة', () => {
  it('مفيش قيمة داخلية بتظهر للمستخدم', () => {
    /*
     * `__base__` قيمة داخلية معناها «الوحدة الأساسية»، بتتخزّن `null` على السطر. وantd لما
     * تلاقي قيمة مالهاش خيار مطابق بتعرض القيمة نفسها — فكانت بتكتب `__base__` بالإنجليزي
     * في خانة عربية، كل ما قايمة وحدات الصنف ماتكونش وصلت لسه.
     */
    expect(src).toMatch(/const unitOptions = \(itemId: number \| null\)/);
    const opts = src.slice(src.indexOf('const unitOptions'), src.indexOf('const fetchUnits'));
    // الخيار الأساسي موجود دايماً، سواء وصلت الوحدات أو لأ.
    expect(opts).toContain("{ value: '__base__', label: base?.name || 'الأساسية' }");
  });

  it('الفاتورة اللي بتتفتح للتعديل بتجيب وحدات أصنافها', () => {
    const edit = src.slice(src.indexOf('const editPosted'), src.indexOf('const handleSubmit'));
    expect(edit).toContain('fetchUnits(id as number)');
  });
});

describe('كثافة الشاشة', () => {
  const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');

  it('الفورم مضغوط بالمسافات مش بتصغير الخط', () => {
    /*
     * تصغير الخط عشان يدخل صف زيادة هو إزاي شاشة كثيفة بتبقى شاشة مش مقروءة — واللي بيكتب
     * فاتورة بيقرا أرقام مايتحملش يقراها غلط. فالضغط جه من الحشو والهوامش، والخانات فضلت
     * بخطها.
     */
    expect(src).toContain('className="doc-form"');
    const block = css.slice(css.indexOf('.doc-form .ant-form-item'), css.indexOf('.entry-grid {'));
    expect(block).toContain('margin-bottom: 8px');
    // خانة الإدخال نفسها مش أصغر من ١٣ — الوضوح شرط مش رفاهية.
    // الخانة مش أصغر من ١٤ — الوضوح شرط مش رفاهية.
    expect(block).toMatch(/font-size: 14px/);
  });

  it('اسم الحقل بيتوضّح بالتباين مش بالحجم', () => {
    const label = css.slice(css.indexOf('.doc-form .ant-form-item-label > label'));
    expect(label.slice(0, 200)).toContain('font-weight: 700');
    expect(label.slice(0, 200)).toContain('color: #3a4a3a');
  });

  it('جدول السطور خطه ١٤', () => {
    // كميات وأسعار — الغلط في قراءتها بيتكلّف.
    const grid = css.slice(css.indexOf('.entry-grid {'));
    expect(grid.slice(0, 300)).toContain('font-size: 14px');
  });
});
