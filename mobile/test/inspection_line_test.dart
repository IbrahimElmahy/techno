// سطر المعاينة مايبعتش رقم منتج.
//
// «أصناف المعاينة» is a points catalogue of its own — «قطعه بسن 32"», «محبس دفن 20"» — numbered
// from 1. The products table is numbered from 1 too, and eight of the thirty-two inspection ids
// land on a real, completely unrelated product.
//
// `item_id` on the server is a foreign key to PRODUCTS, and carrying one is not cosmetic:
// `inspection_service` overwrites the line's name with that product's name and posts an
// `inspection_out` stock movement deducting that product from the rep's custody. So a rep adding
// «قطعه لحام 20"» would quietly draw down some unrelated product from his van — or, where the
// custody has none, have the whole inspection refused with «الرصيد غير كافٍ في عهدتك».
//
// The screens used to send `null` with a comment saying why. A redesign replaced it with the
// catalogue id. Nothing about that reads as wrong at the call site, which is why it is pinned here.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final screens = [
    'lib/screens/inspection_form_screen.dart',
    'lib/screens/regular_visit_form_screen.dart',
  ];

  for (final path in screens) {
    test('${path.split('/').last} مابيحطش رقم الصنف في itemId', () {
      final src = File(path).readAsStringSync();
      expect(src, isNot(contains('itemId: item.id')),
          reason: 'بيبعت رقم نوع صنف المعاينة في خانة مفتاحها أجنبي على المنتجات — '
              'ده بيخصم منتج تاني من عهدة المندوب أو بيرفض المعاينة كلها');
      expect(src, contains('itemId: null'),
          reason: 'السطر مش بيبعت null — يبقى بيبعت إيه؟');
    });
  }
}
