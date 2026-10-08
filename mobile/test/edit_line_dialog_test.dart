import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final src = File('lib/screens/inspection_form_screen.dart').readAsStringSync();

  String editLineBody() {
    final start = src.indexOf('Future<void> _editLine(');
    expect(start, greaterThan(-1), reason: 'الدالة اتغيّر اسمها — الاختبار بيقرا حاجة مش موجودة');
    final next = src.indexOf('\n  /// ', start);
    return src.substring(start, next == -1 ? src.length : next);
  }

  test('مافيش Spacer في actions بتاعة البوباب', () {
    expect(editLineBody(), isNot(contains('Spacer()')),
        reason: 'Spacer جوه OverflowBar بيفجّر التخطيط — الخانة بتبقى مربع رمادي فاضي '
            'و«تم» و«إلغاء» بيتشالوا من الشاشة');
  });

  test('البوباب فيه إلغاء وتم', () {
    final body = editLineBody();
    expect(body, contains("Text('إلغاء')"));
    expect(body, contains("Text('تم')"));
  });

  test('الحذف موجود جوه البوباب', () {
    expect(editLineBody(), contains('_kDelete'));
  });

  test('«حذف» بترجّع إشارة مش رقم', () {
    expect(src, contains('const Object _kDelete = Object();'));
    expect(src, contains('if (answer == _kDelete)'));
  });
}
