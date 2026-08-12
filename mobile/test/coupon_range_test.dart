// نطاق سريالات الكوبونات «من – إلى» — كان اتشال.
//
// Coupons are issued as serially numbered books, so a rep taking twenty back from one customer is
// taking twenty consecutive numbers. The screen that shipped had a single optional serial box and
// nothing else, which meant typing them one at a time — and that is why the client asked «سريال
// الكوبونات بيتكتب فين، اللي هو من إلى».
//
// The range had existed and was lost in a redesign. These check the rules it came with, because
// each of them is a way a rep can lose an evening: a reversed range silently adding nothing, a
// typo in the end number adding a million rows, or the same book counted twice.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// نفس قواعد `_addRange` في الشاشة.
///
/// The screen's own method is private and bound to widget state; this is the arithmetic it runs,
/// checked directly. The source guard below is what keeps the two from drifting apart.
List<String> expand(String from, String to, {int max = 100}) {
  final first = int.tryParse(from.trim());
  final last = int.tryParse(to.trim());
  if (first == null || last == null) throw ArgumentError('النطاق لازم يكون أرقام');
  if (last < first) throw ArgumentError('رقم النهاية أصغر من البداية');
  if (last - first + 1 > max) throw ArgumentError('النطاق كبير');
  return [for (var n = first; n <= last; n++) n.toString()];
}

void main() {
  test('النطاق بيتفك لكل رقم جواه', () {
    expect(expand('101', '105'), ['101', '102', '103', '104', '105']);
  });

  test('رقم واحد لوحده نطاق من عنصر', () {
    expect(expand('7', '7'), ['7']);
  });

  test('نطاق مقلوب بيترفض مش بيرجع فاضي', () {
    // Returning nothing would look like it worked and add no coupons at all.
    expect(() => expand('105', '101'), throwsArgumentError);
  });

  test('نطاق ضخم بيترفض', () {
    // A typo in the end number would otherwise build millions of rows and freeze the screen.
    expect(() => expand('1', '100000'), throwsArgumentError);
  });

  test('حروف مش نطاق', () {
    expect(() => expand('abc', '105'), throwsArgumentError);
  });

  test('الشاشة نفسها لسه شايلة النطاق', () {
    // The rules above are only worth anything while the screen still offers the feature at all —
    // it was removed once already.
    final src = File('lib/screens/coupon_receipt_screen.dart').readAsStringSync();
    expect(src, contains('_addRange'), reason: 'النطاق اتشال من الشاشة تاني');
    expect(src, contains('_fromCtrl'));
    expect(src, contains('_toCtrl'));
    expect(src, contains('رقم النهاية أصغر من البداية'),
        reason: 'النطاق موجود من غير الحارس اللي بيمنع المقلوب');
  });
}
