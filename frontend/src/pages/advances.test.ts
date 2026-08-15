/**
 * الجزاء بالأيام مالوش مبلغ لحد ما المسير يحسبه.
 *
 * «خصم يومين» is how a penalty is actually written here — the pound figure depends on the daily
 * rate of the month it lands in, which is not the same number in a month somebody was on unpaid
 * leave. So the record carries the DAYS and the payroll turns them into money.
 *
 * Which leaves the screen with a row whose `amount` is zero and whose real value is two days. A
 * «القيمة» column that reads that as «٠٫٠٠» is a lie somebody will act on — it says the penalty is
 * nothing.
 */
import { describe, expect, it } from 'vitest';

import { adjustmentValue, instalmentLabel } from './Advances';

const row = (over: any = {}) => ({
  id: 1, document_number: 'ADJ-000001', employee_id: 1, employee_name: 'سيد',
  kind: 'penalty', basis: 'amount', quantity: null, amount: '150',
  year: 2026, month: 8, reason: null, status: 'approved', applied: false, ...over,
});

describe('adjustmentValue', () => {
  it('الجزاء بالمبلغ بيتعرض فلوس', () => {
    expect(adjustmentValue(row())).toBe('١٥٠٫٠٠');
  });

  it('الجزاء بالأيام بيتعرض أيام — مش صفر جنيه', () => {
    const days = adjustmentValue(row({ basis: 'days', quantity: '2.000', amount: '0' }));
    expect(days).toBe('2 يوم');
    expect(days).not.toContain('٠٫٠٠');
  });

  it('الجزاء بالساعات كمان', () => {
    expect(adjustmentValue(row({ basis: 'hours', quantity: '4.000', amount: '0' })))
      .toBe('4 ساعة');
  });
});

describe('instalmentLabel', () => {
  it('قسط واحد بيتكتب بالكلام مش «١ × المبلغ»', () => {
    expect(instalmentLabel(1, '1000')).toBe('قسط واحد');
  });

  it('أكتر من قسط بيوري العدد والقيمة', () => {
    expect(instalmentLabel(3, '1000')).toContain('3 أقساط');
  });
});
