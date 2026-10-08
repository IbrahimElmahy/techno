import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('شاشة اختيار الصنف مابتحطش رقم الصنف في itemId', () {
    final src = File('lib/screens/item_picker_screen.dart').readAsStringSync();
    expect(src, isNot(contains('itemId: item.id')),
        reason: 'بيبعت رقم نوع صنف المعاينة في خانة مفتاحها أجنبي على المنتجات — '
            'ده بيخصم منتج تاني من عهدة المندوب أو بيرفض المعاينة كلها');
    expect(src, contains('itemId: null'),
        reason: 'السطر مش بيبعت null — يبقى بيبعت إيه؟');
  });
}
