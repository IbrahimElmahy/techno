import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const _forms = [
  'lib/screens/inspection_form_screen.dart',
  'lib/screens/regular_visit_form_screen.dart',
  'lib/screens/coupon_receipt_screen.dart',
];

const _notOnScreen = <String, String>{
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
      final declared = RegExp(r'final (_\w+) = TextEditingController\(\)')
          .allMatches(src)
          .map((m) => m.group(1)!)
          .where((n) => !_notOnScreen.containsKey(n))
          .toSet();
      expect(declared, isNotEmpty, reason: 'مالقاش أي حقول — الاختبار بيقرا حاجة غلط');

      final orphans = <String>[];
      for (final field in declared) {
        final direct = RegExp('controller: $field\\s*[,)]').hasMatch(src);
        final viaAutocomplete = RegExp('=\\s*$field\\.text\\s*;').hasMatch(src);
        if (!direct && !viaAutocomplete) orphans.add(field);
      }

      expect(orphans, isEmpty,
          reason: 'الحقول دي بتتحفظ ومفيش خانة ليها على الشاشة — التطبيق بيدّعي إنه '
              'بيجمّعها وهو بيحفظ فاضي');
    });
  }

  test('بيانات المالك فيها الأربعة اللي ضاعوا', () {
    final src = File(_forms.first).readAsStringSync();
    for (final label in ['تليفون المالك', 'رقم البطاقة', 'عنوان المالك', 'رقم الدور']) {
      expect(src, contains(label), reason: '«$label» اتشال من الاستمارة تاني');
    }
  });
}
