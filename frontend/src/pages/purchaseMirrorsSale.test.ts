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
  ['السطور متجمّعة بالفئة', /linesByCategory/],
  ['شريط الأوامر', /DocumentToolbar/],
  ['سلّم الإجماليات', /TotalsLadder/],
  ['لوحة مخزون الصنف', /ItemStockPanel/],
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

describe('إضافة الصنف بنفس الحركة', () => {
  it('الزرار فوق السطور مش تحتها', () => {
    // «فوق» هنا = قبل حلقة عرض السطور في نص الملف. الترتيب ده هو اللي بيخلّي الزرار في
    // نفس المكان مهما طالت الفاتورة.
    const button = buy.indexOf('إضافة صنف للفاتورة');
    const lines = buy.indexOf('linesByCategory.map');
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

  it('Enter على الكمية بيرجّع لبوباب الأصناف', () => {
    // ده اللي بيخلّي الفاتورة كلها تتكتب من الكيبورد: اختار، اكتب كمية، Enter، اختار…
    //
    // النافذة واسعة عن قصد: حقل الكمية في شاشة البيع بينه وبين `setPickerOpen` تعليق طويل
    // بيشرح ليه `preventDefault` ضرورية. اللي بيهمنا إن الاتنين موجودين في نفس المعالج.
    for (const [name, src] of [['البيع', sale], ['الشرا', buy]] as const) {
      expect(/onPressEnter[\s\S]{0,1600}setPickerOpen\(true\)/.test(src), name).toBe(true);
    }
  });
});

describe('الحاجات اللي مالهاش لازمة في الشرا', () => {
  // فاتورة الشرا نسخة من البيع **من غير** الحاجات دي — قرار العميل، مش سهو.
  it.each([
    ['الكوبونات', /couponCount|coupon_from/],
    ['النقاط', /pointValues|totalPoints/],
    ['شرايح الأسعار (أبيض وبولي)', /TIER_LABELS/],
  ])('مافيش %s', (_label, pattern) => {
    expect(pattern.test(buy)).toBe(false);
  });
});
