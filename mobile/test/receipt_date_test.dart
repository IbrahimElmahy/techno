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
