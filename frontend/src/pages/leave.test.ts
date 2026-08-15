/**
 * لون الرصيد المتبقي — الصفر والسالب مش نفس الحاجة.
 *
 * A balance of zero is «خلص رصيدك» — normal, expected, and the answer to «ينفع آخد يومين؟» is no.
 * A NEGATIVE balance is a different fact: somebody was granted leave they did not have, which is
 * a mistake in the books rather than a full quota. Painting both amber hides the second one inside
 * the first, and the second is the one an HR manager has to act on.
 */
import { describe, expect, it } from 'vitest';

import { remainingTone } from './Leave';

describe('remainingTone', () => {
  it('الرصيد المتاح أخضر', () => {
    expect(remainingTone('5')).toBe('green');
    expect(remainingTone('21.000')).toBe('green');
  });

  it('الصفر برتقالي — خلص، مش غلط', () => {
    expect(remainingTone('0')).toBe('orange');
    expect(remainingTone('0.000')).toBe('orange');
  });

  it('السالب أحمر — ده غلط في الدفاتر مش رصيد خالص', () => {
    expect(remainingTone('-2')).toBe('red');
  });

  it('الفاضي بيتعامل كصفر مش كخطأ', () => {
    expect(remainingTone('')).toBe('orange');
  });
});
