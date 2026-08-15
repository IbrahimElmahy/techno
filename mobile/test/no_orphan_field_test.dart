// كل حقل بيتحفظ لازم يكون على الشاشة.
//
// «رقم تلفون مالك الشقه كان موجود» — and it was. Four fields (تليفون المالك، رقم البطاقة، عنوان
// المالك، رقم الدور) disappeared from «بيانات المالك» during a refactor that replaced the owner
// name box with a shared search widget: the edit sliced from the start of the section to its
// closing bracket, and everything after the name went with it.
//
// Nothing complained. The controllers were still declared, still read in `_save()`, still written
// to the database — so the analyzer saw them used, the tests passed, and the visit simply started
// saving four empty columns. The only signal was a rep noticing a box he used to type in.
//
// This is the shape of that bug, not the four fields: a controller that `_save()` reads and the
// build never renders is a field the app claims to collect and silently does not.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// كل الشاشات اللي بتجمّع بيانات في استمارة.
const _forms = [
  'lib/screens/inspection_form_screen.dart',
  'lib/screens/regular_visit_form_screen.dart',
  'lib/screens/coupon_receipt_screen.dart',
];

/// حقول بتتقري من مكان تاني مش من خانة على الشاشة، ومعاها السبب.
const _notOnScreen = <String, String>{
  // مراجعة الكوبونات بتفلتر بيه، والمستخدم بيكتبه في خانة البحث مش في الاستمارة.
  '_customerSearch': 'خانة بحث في قايمة العملاء، مش حقل بيتحفظ',
  '_serialCtrl': 'اتشال لما النطاق بقى الطريقة الوحيدة',
};

void main() {
  for (final path in _forms) {
    final file = File(path);
    if (!file.existsSync()) continue;
    final src = file.readAsStringSync();
    final name = path.split('/').last;

    test('$name — كل controller بيتحفظ له خانة على الشاشة', () {
      // كل `final _x = TextEditingController();`
      final declared = RegExp(r'final (_\w+) = TextEditingController\(\)')
          .allMatches(src)
          .map((m) => m.group(1)!)
          .where((n) => !_notOnScreen.containsKey(n))
          .toSet();
      expect(declared, isNotEmpty, reason: 'مالقاش أي حقول — الاختبار بيقرا حاجة غلط');

      final orphans = <String>[];
      for (final field in declared) {
        // «على الشاشة» يعني متبعت لودجت بتاخد controller — مش مجرد إن اسمه مذكور في الحفظ.
        final direct = RegExp('controller: $field\\s*[,)]').hasMatch(src);
        // و`Autocomplete` بيعمل controller بتاعه، فالحقل بتاعنا بيتزامن معاه بسطر
        // `controller.text = _x.text;` — ده رسم برضه، بس بطريق غير مباشر.
        final viaAutocomplete = RegExp('=\\s*$field\\.text\\s*;').hasMatch(src);
        if (!direct && !viaAutocomplete) orphans.add(field);
      }

      expect(orphans, isEmpty,
          reason: 'الحقول دي بتتحفظ ومفيش خانة ليها على الشاشة — التطبيق بيدّعي إنه '
              'بيجمّعها وهو بيحفظ فاضي');
    });
  }

  test('بيانات المالك فيها الأربعة اللي ضاعوا', () {
    // اللي حصل بالظبط، مكتوب باسمه عشان ما يتكررش.
    final src = File(_forms.first).readAsStringSync();
    for (final label in ['تليفون المالك', 'رقم البطاقة', 'عنوان المالك', 'رقم الدور']) {
      expect(src, contains(label), reason: '«$label» اتشال من الاستمارة تاني');
    }
  });
}
