/**
 * معاينة الضريبة على الشاشة — نسخة من حساب السيرفر، عشان اللي بيكتب الشرايح يراجعها قبل
 * ما يحفظ. كل رقم بيوصل قسيمة راتب بيتحسب على السيرفر؛ دي للمراجعة بس.
 *
 * والفجوة بين الشرايح: بتتقال هنا بدري بدل ما السيرفر يرفض بعد ما الواحد كتب ست شرايح.
 * فجوة أو تداخل بيطلعوا رقم ضريبة غلط من غير ما حاجة تشتكي — مش خطأ بيتقال، رقم بيتقبل.
 */
import { describe, expect, it } from 'vitest';

import { bracketGap, previewTax } from './PayrollSettings';

const band = (from: string, to: string | null, rate: string) => ({
  sequence: 0, from_amount: from, to_amount: to, rate_pct: rate, fixed_amount: '0',
});

const BANDS = [
  band('0', '10000', '0'),
  band('10000', '30000', '10'),
  band('30000', null, '20'),
];

describe('previewTax', () => {
  it('تحت أول شريحة مافيش ضريبة', () => {
    expect(previewTax(8000, BANDS)).toBe(0);
  });

  it('كل شريحة بنسبتها', () => {
    // ٥٠ ألف = ٠ + (٢٠ ألف × ١٠٪) + (٢٠ ألف × ٢٠٪) = ٦٠٠٠
    expect(previewTax(50000, BANDS)).toBe(6000);
  });

  it('الشريحة المفتوحة بتاخد اللي فوقها', () => {
    expect(previewTax(100000, BANDS)).toBe(16000);
  });

  it('الإعفاء بيتشال الأول', () => {
    expect(previewTax(20000, BANDS, 5000)).toBe(500);
  });

  it('زيادة جنيه مابتخلّيش الصافي أقل', () => {
    const under = 30000 - previewTax(30000, BANDS);
    const over = 30001 - previewTax(30001, BANDS);
    expect(over).toBeGreaterThan(under);
  });

  it('من غير شرايح مافيش ضريبة مش خطأ', () => {
    expect(previewTax(50000, [])).toBe(0);
  });
});

describe('bracketGap', () => {
  it('شرايح متصلة مافيهاش مشكلة', () => {
    expect(bracketGap(BANDS)).toBeNull();
  });

  it('بيمسك الفجوة', () => {
    expect(bracketGap([band('0', '10000', '0'), band('15000', null, '10')]))
      .toContain('السابقة انتهت عند 10000');
  });

  it('بيمسك التداخل', () => {
    expect(bracketGap([band('0', '10000', '0'), band('8000', null, '10')])).not.toBeNull();
  });

  it('بيمسك الشريحة المقلوبة', () => {
    expect(bracketGap([band('10000', '5000', '10')])).toContain('نهايتها قبل بدايتها');
  });

  it('شريحة واحدة مفتوحة سليمة', () => {
    expect(bracketGap([band('0', null, '10')])).toBeNull();
  });
});
