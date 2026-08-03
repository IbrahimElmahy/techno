import { describe, expect, it } from 'vitest';
import { couponCount } from './Invoices';

/**
 * عدد الكوبونات بيتحسب من المدى، مش بيتكتب.
 *
 * The count used to be a field somebody typed beside «من ٥٠» and «إلى ١٠٠» — two ways of saying
 * one thing, which disagree the first time anybody edits the range and forgets the number. After
 * that the invoice claims a book size its serials do not support, and the receipt screen refuses
 * coupons the customer is holding.
 *
 * The rules worth pinning are the ones where a wrong answer would POST: a reversed range, a
 * prefix mismatch, a serial that is not a number at all. In every one of those the answer is null,
 * because a wrong count is worse than no count.
 */

describe('couponCount', () => {
  it('counts both ends — the customer is handed the first and the last', () => {
    expect(couponCount('50', '100')).toBe(51);
    expect(couponCount('1', '1')).toBe(1);
  });

  it('handles a prefix, which is how the books are actually numbered', () => {
    expect(couponCount('A-1050', 'A-1059')).toBe(10);
  });

  it('refuses a range whose ends do not belong to the same book', () => {
    expect(couponCount('A-1050', 'B-1059')).toBeNull();
  });

  it('refuses a reversed range rather than returning a negative', () => {
    // «من ١٠٠ إلى ٥٠» is a typo. -49 coupons is not a thing to post.
    expect(couponCount('100', '50')).toBeNull();
  });

  it('refuses what is not a number', () => {
    expect(couponCount('كتاب', 'تاني')).toBeNull();
    expect(couponCount('50', '')).toBeNull();
    expect(couponCount(null, '100')).toBeNull();
    expect(couponCount(undefined, undefined)).toBeNull();
  });

  it('ignores stray spaces, which hand-typed serials have', () => {
    expect(couponCount(' 50 ', ' 60 ')).toBe(11);
  });
});
