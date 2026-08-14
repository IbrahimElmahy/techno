// بوباب تعديل الصنف — الأزرار لازم تتشاف والخانة لازم تشتغل.
//
// A `Spacer` was put into `AlertDialog.actions` to push «حذف» away from «تم» and «إلغاء». It reads
// perfectly well and it does not throw. What it does is render a large empty grey box where the
// quantity field should be and squash «تم» and «إلغاء» off the dialog entirely — because
// `AlertDialog` lays its actions out in an `OverflowBar`, which hands children UNBOUNDED width,
// and a `Spacer` is an `Expanded` that needs a bounded axis to divide.
//
// The failure is silent in every sense that matters: the analyzer is happy, no exception is
// thrown, and the only way to find it is to open the dialog and look. So the shape is held here
// instead.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final src = File('lib/screens/inspection_form_screen.dart').readAsStringSync();

  /// جسم `_editLine` بس — عشان `Spacer` في أي مكان تاني في الشاشة ما يكسرش الاختبار.
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
    // The whole reason this dialog gained a delete: the row was swipe-only and nothing said so.
    expect(editLineBody(), contains('_kDelete'));
  });

  test('«حذف» بترجّع إشارة مش رقم', () {
    // The dialog returns a quantity OR a delete signal down one channel. A sentinel `Object()`
    // cannot collide with any quantity a rep could type; a magic number like -1 could.
    expect(src, contains('const Object _kDelete = Object();'));
    expect(src, contains('if (answer == _kDelete)'));
  });
}
