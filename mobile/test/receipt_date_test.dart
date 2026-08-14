// فلتر التاريخ في مراجعة الكوبونات — استلام من غير `received_date` مايتشالش.
//
// `received_date` came in with v7 of the phone database; every receipt saved before it has NULL.
// The filter dropped those rows the moment any date was set, so the screen went blank on a filter
// that should have narrowed it — and the only way to see anything at all was to clear the dates.
// The screen defaults to today's date, so on a phone holding older receipts it opened empty.
//
// The fallback is not a guess: `created_at` is an ISO timestamp whose first ten characters are the
// day the row was written, in the same format the filter compares.
import 'package:flutter_test/flutter_test.dart';
import 'package:techno_inspections/screens/coupon_review_screen.dart';

void main() {
  test('التاريخ المسجّل هو اللي بيتحسب لما يكون موجود', () {
    expect(
      receiptDate({'received_date': '2026-08-01', 'created_at': '2026-08-14T01:55:00.000'}),
      '2026-08-01',
      reason: 'رجّع يوم الكتابة بدل تاريخ الاستلام اللي المندوب اختاره',
    );
  });

  test('استلام قديم من غير تاريخ بيرجع ليوم ما اتكتب', () {
    expect(receiptDate({'received_date': null, 'created_at': '2026-08-14T01:55:00.000'}),
        '2026-08-14');
    expect(receiptDate({'received_date': '', 'created_at': '2026-08-14T01:55:00.000'}),
        '2026-08-14',
        reason: 'نص فاضي زي null بالظبط');
  });

  test('صف مالوش أي تاريخ بيرجع null مش نص مكسور', () {
    expect(receiptDate({'created_at': ''}), isNull);
    expect(receiptDate({}), isNull);
  });
}
