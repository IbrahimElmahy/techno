/**
 * فاتورة الشرا بتتكتب بنفس إيد فاتورة البيع.
 *
 * The buying and the selling side ask the same questions in the same order — which supplier, which
 * items, how many, at what price, paid or owed — and the person typing them is often the same
 * person on the same afternoon. Two screens that answer the same questions with two different
 * gestures cost that person a relearn every time they switch.
 *
 * They had drifted in exactly the places that hurt at speed:
 *
 * - **الزرار كان تحت السطور، صغير ومتقطّع.** On an invoice of fifteen lines that is a scroll to
 *   find and a click to choose, twice per line. On the sale it is a large primary button ABOVE the
 *   lines, always in the same place, and F2 reaches it without the mouse.
 * - **الاختيار كان واحد واحد.** The sale takes a multi-select and adds them in one go; the
 *   purchase made you reopen the picker per item.
 * - **العرض كان جدول مسطّح.** The sale groups the lines under their category with a header and a
 *   count, which is how somebody checking a long invoice actually reads it.
 *
 * **فروق مقصودة بين الشاشتين، وكلها بطلب العميل:**
 *
 * - لوحة «رصيد الصنف في المخازن» اتشالت من فاتورة الشرا. كانت واخدة تلت العرض وهي فاضية،
 *   وبقت مالهاش طريق بعد ما عمود اسم الصنف اتشال — هو اللي كان بيوجّهها. رصيد الصنف لسه
 *   بيتشاف جوّه بوباب اختيار الصنف. فاتورة البيع لسه فيها اللوحة.
 * - عمود اسم الصنف اتشال من سطور فاتورة الشرا.
 *
 * **وفرق الشكل (١٩ أغسطس ٢٠٢٦):** العميل طلب إن فاتورة الشرا تبقى جدول إدخال
 * مضغوط زي اللي هو شغّال عليه — سطر واحد لكل صنف وعنوان أعمدة مرة واحدة فوق — بدل الكروت
 * المتجمّعة بالفئة. فاتورة البيع لسه بالكروت. الحاجات اللي تحت لسه مشتركة؛ اللي اختلف هو شكل
 * عرض السطور وحركة Enter، والاتنين متوثّقين في الاختبارات اللي تحت بدل ما يعدّوا في صمت.
 *
 * Source-shape checks rather than renders: they cost nothing and they fail the moment one screen
 * gains something the other did not — which is the only way two screens stay alike over years.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const sale = read('Invoices.tsx');
const buy = read('Purchases.tsx');

/** الحاجات اللي بتخلّي المستندين يتكتبوا بنفس الحركة. */
const SHARED: [string, RegExp][] = [
  ['منتقي الأطراف بنافذة', /PartyPickerModal/],
  ['منتقي الأصناف', /ProductPickerModal/],
  ['اختيار أكتر من صنف مرة واحدة', /onPickMany/],
  ['الفئة بتبان مع السطر', /categoryLabels/],
  ['شريط الأوامر', /DocumentToolbar/],
  ['سلّم الإجماليات', /TotalsLadder/],
  ['خيارات الطباعة', /PrintOptionsMenu/],
  ['إعدادات الأعمدة', /ColumnSettings/],
  ['مستودع لكل سطر', /warehouse_id/],
  ['رقم مستند خارجي', /external_document_number/],
  ['بيانات ١ ٢ ٣', /statement1/],
  ['خصم على السطر', /discount_pct|fixed_discount/],
  ['نوافذ داخل التبويب', /TabModal/],
];

describe('الاتنين فيهم نفس الحاجات', () => {
  it.each(SHARED)('فاتورة الشرا فيها %s', (_label, pattern) => {
    expect(pattern.test(buy)).toBe(true);
  });

  it.each(SHARED)('فاتورة البيع فيها %s', (_label, pattern) => {
    expect(pattern.test(sale)).toBe(true);
  });
});

describe('اللي اتشال من الشرا بطلب العميل', () => {
  it('مفيش لوحة رصيد تحت المستند في الاتنين', () => {
    // صندوق كبير مكتوب فيه «اختر فئة أو صنف عشان تشوف رصيده» وطالع الصفحة لتحت من غير
    // ما يقول حاجة. رصيد الصنف بيتشاف جوّه بوباب اختيار الصنف — وهو المكان اللي السؤال
    // بيتسأل فيه فعلاً وانت بتقول هاخد منه كام.
    expect(buy, 'رجعت لوحة الرصيد في الشرا').not.toContain('<ItemStockPanel');
    expect(sale, 'رجعت لوحة الرصيد في البيع').not.toContain('<ItemStockPanel');
  });
});

describe('إضافة الصنف بنفس الحركة', () => {
  it('الزرار فوق السطور مش تحتها', () => {
    // «فوق» هنا = قبل حلقة عرض السطور في نص الملف. الترتيب ده هو اللي بيخلّي الزرار في
    // نفس المكان مهما طالت الفاتورة.
    const button = buy.indexOf('إضافة صنف للفاتورة');
    const lines = buy.indexOf('purchaseItems.map((line, idx)');
    expect(button).toBeGreaterThan(-1);
    expect(lines).toBeGreaterThan(-1);
    expect(button).toBeLessThan(lines);
  });

  it('الزرار أساسي وبعرض الشاشة، مش متقطّع', () => {
    const around = buy.slice(buy.indexOf('إضافة صنف للفاتورة') - 400,
      buy.indexOf('إضافة صنف للفاتورة'));
    expect(around).toContain('type="primary"');
    expect(around).toContain('block');
    expect(around).not.toContain('type="dashed"');
  });

  it('F2 بيوصل لزرار إضافة الصنف في الشاشتين', () => {
    for (const [name, src] of [['البيع', sale], ['الشرا', buy]] as const) {
      const marker = src.indexOf('data-shortcut="F2"');
      expect(marker, `${name}: مافيش F2`).toBeGreaterThan(-1);
      // نفس الزرار في الاتنين — مش زرار تاني خد المفتاح.
      expect(src.slice(marker, marker + 700)).toContain('إضافة صنف للفاتورة');
    }
  });

  it('مفتاح واحد بس بيدّعي F2 في كل شاشة', () => {
    // اتنين في ملف واحد معناهم إن المحرك مش عارف يضغط أنهي واحد.
    for (const [name, src] of [['البيع', sale], ['الشرا', buy]] as const) {
      expect((src.match(/data-shortcut="F2"/g) || []).length, name).toBe(1);
    }
  });

  it('Enter بيكمّل المستند من غير ماوس — في الاتنين', () => {
    // اختار، اكتب كمية، Enter، اكتب اللي بعدها… ولما تخلص السطور البوباب بيفتح لصنف جديد.
    for (const [name, src] of [['البيع', sale], ['الشرا', buy]] as const) {
      expect(/onPressEnter[\s\S]{0,400}advanceFrom\(line\.key\)/.test(src), name).toBe(true);
      const advance = src.slice(src.indexOf('const advanceFrom'));
      expect(advance.slice(0, 500), `${name}: آخر سطر مابيفتحش البوباب`)
        .toContain('setPickerOpen(true)');
    }
  });
});

describe('نفس تركيب الصفحة', () => {
  /**
   * السجل هو الصفحة، والكتابة بتحل محله.
   *
   * The purchase was a two-tab screen — «فاتورة جديدة» beside «سجل المشتريات» — so the record was
   * a place you switched to and the blank form was what the screen opened on. The sale is the
   * other way round, and it is the right way round: what somebody opens a documents screen for is
   * almost always to look something up, and writing a new one is a deliberate act that starts with
   * a button.
   */
  it.each([['البيع', 'Invoices.tsx'], ['الشرا', 'Purchases.tsx']])(
    'شاشة %s مبنية على «السجل هو الصفحة»', (_name, file) => {
      const src = read(file);
      expect(src).toContain('createVisible');
      // الكتابة بترجع بدري وبتحل محل الصفحة، مش تبويب جنبها.
      expect(/if \(createVisible\)[\s\S]{0,40}return/.test(src)).toBe(true);
      expect(src).not.toContain('<Tabs');
    });

  it.each([['البيع', 'Invoices.tsx', 'invoiceDate'], ['الشرا', 'Purchases.tsx', 'purchaseDate']])(
    'شاشة %s بتفتح بباب واحد فيه التاريخ والطرف مع بعض', (_name, file, dateVar) => {
      // بوباب «انشاء» واحد فيه الفرع والتاريخ والتصنيف والبحث والقايمة. كانوا خطوتين —
      // نافذة بتسأل التاريخ وبعدها نافذة بتسأل الطرف — وهما نفس القرار.
      const src = read(file);
      expect(src, 'لسه فيه خطوة تاريخ منفصلة').not.toContain("newStep === 'date'");
      expect(src).toContain("setNewStep('party')");
      // والتاريخ اتنقل جوّه الباب نفسه.
      expect(src).toContain(`date={${dateVar}} onDateChange=`);
    });

  it.each([['البيع', 'Invoices.tsx'], ['الشرا', 'Purchases.tsx']])(
    'شاشة %s بيرجع منها للسجل بزرار رجوع', (_name, file) => {
      const src = read(file);
      expect(src).toContain('closeCreate');
      expect(src).toContain('رجوع');
    });

  it('اختيار الطرف بيسلّم للصفحة في الاتنين', () => {
    // آخر باب بيقفل ويفتح الفاتورة — مش بيسيب الواحد على شاشة فاضية.
    for (const [name, file] of [['البيع', 'Invoices.tsx'], ['الشرا', 'Purchases.tsx']] as const) {
      const src = read(file);
      expect(/newStep === 'party'[\s\S]{0,160}setCreateVisible\(true\)/.test(src), name)
        .toBe(true);
    }
  });
});

describe('مخزن الاستلام', () => {
  /**
   * سؤال واحد، في مكان واحد، وبيفضل متجاوب عليه.
   *
   * The document used to carry «مستودع الاستلام» at the top AND every line could override it —
   * the same question asked twice for the ordinary shipment that all goes to one store. The top
   * field is gone: the first line's warehouse IS the document's, and every line after it starts
   * on the same one.
   *
   * The part that must not drift: changing it applies to lines added AFTER, never to the ones
   * already typed. Rewriting a line somebody has already entered because a later line went
   * somewhere else is the kind of silent change that surfaces at the stocktake.
   */
  it('مافيش حقل مخزن على المستند', () => {
    expect(buy).not.toContain('label="مستودع الاستلام"');
    expect(buy).not.toContain('name="warehouse_id"');
  });

  it('مخزن المستند بيتاخد من أول سطر', () => {
    // السيرفر لسه محتاج مكان على المستند (٠٣٠)؛ بقى مشتق مش مسؤول عنه حد تاني.
    expect(/location_id: validLines\[0\]\.warehouse_id/.test(buy)).toBe(true);
  });

  it('السطر الجديد بيرث آخر مخزن اتختار', () => {
    expect(buy).toContain('stickyWarehouseId');
    expect(/warehouse_id: stickyWarehouseId/.test(buy)).toBe(true);
  });

  it('تغيير المخزن على سطر بيثبّت الجديد للسطور الجاية', () => {
    const at = buy.indexOf('setStickyWarehouseId(val ?? null)');
    expect(at, 'تغيير المخزن مابيثبّتش الجديد').toBeGreaterThan(-1);
    // وبيتغيّر على السطر نفسه كمان، مش بس الافتراضي.
    expect(buy.slice(at - 400, at)).toContain("handleItemChange(line.key, 'warehouse_id'");
  });

  it('مافيش سطر بيتساب من غير مخزن', () => {
    // مخزن المستند بقى مخزن أول سطر — فسطر من غير مخزن مالوش مكان ينزل فيه.
    expect(buy).toContain('اختار مخزن الاستلام');
  });
});

describe('الحاجات اللي مالهاش لازمة في الشرا', () => {
  /**
   * فاتورة الشرا نسخة من البيع **من غير** الحاجات دي — قرار العميل، مش سهو.
   *
   * «المندوب» is the one that will look like an oversight to whoever reads the two screens side
   * by side, so it is written down: a rep is a SELLING role — he sells, he collects, and a
   * commission is worked out on what he brought in. An incoming shipment is received by the
   * storekeeper, and which store it landed in is already on every line. A field that is left
   * blank every time is an empty column in every report built on it afterwards.
   */
  it.each([
    ['الكوبونات', /couponCount|coupon_from/],
    ['النقاط', /pointValues|totalPoints/],
    ['شرايح الأسعار (أبيض وبولي)', /TIER_LABELS/],
    ['المندوب', /rep_id/],
  ])('مافيش %s', (_label, pattern) => {
    expect(pattern.test(buy)).toBe(false);
  });

  it('البيع لسه فيه المندوب — الشيل ده للشرا بس', () => {
    // من غير ده، الاختبار اللي فوق يعدّي لو حد شال المندوب من الشاشتين.
    expect(/rep_id/.test(sale)).toBe(true);
  });
});
