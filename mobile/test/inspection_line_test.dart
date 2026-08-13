// سطر المعاينة مايبعتش رقم منتج — وده قرار شغل مش تفصيلة تقنية.
//
// أصناف المعاينة **بتتعدّ للنقاط بس**؛ المندوب مش بيركّبها من عربيته، فالمعاينة مالهاش أي أثر على
// المخزون. اتأكدنا من ده مع صاحب النظام.
//
// The server treats a line carrying an `item_id` as a real movement: `inspection_service` renames
// the line after that product and posts an `inspection_out` deducting it from the rep's custody.
// «أصناف المعاينة» is a points catalogue numbered from 1, and the products table is numbered from 1
// too — eight of the thirty-two inspection ids land on a real, completely unrelated product. So a
// rep adding «قطعه لحام 20"» would quietly draw down something he never touched, or have the whole
// inspection refused with «الرصيد غير كافٍ في عهدتك».
//
// That is not hypothetical: a redesign replaced the deliberate `null` with the catalogue id, and
// nothing about `itemId: item.id` reads as wrong at the call site. Hence this.
//
// If the business ever changes and these items ARE fitted from the van, the fix is NOT to send the
// id — the inspection catalogue would first have to point at real products.
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
