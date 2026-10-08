import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final review = File('lib/screens/review_screen.dart').readAsStringSync();
  final form = File('lib/screens/inspection_form_screen.dart').readAsStringSync();

  test('زرار التعديل بيظهر لما تكون متزامنتش بس', () {
    expect(review, contains('if (!insp.synced)'),
        reason: 'مافيش أي شرط على المزامنة — يبقى التعديل متاح على المتزامن كمان');
    final guard = review.indexOf('if (!insp.synced)');
    final edit = review.indexOf('existing: insp');
    expect(edit, greaterThan(guard),
        reason: 'التعديل برّه شرط «متزامنتش»');
  });

  test('المعاينة المتزامنة بتقول ليه مش بتتعدّل', () {
    expect(review, contains('اتزامنت — مش بتتعدّل من التطبيق'));
  });

  test('التعديل بيمسك نفس رقم المعاينة مش بيعمل واحدة جديدة', () {
    expect(form, contains('_uuid = e?.clientUuid ?? const Uuid().v4();'));
    expect(form, contains('clientUuid: _uuid,'));
    expect(form, isNot(contains('clientUuid: const Uuid().v4(),')),
        reason: 'لسه بيولّد رقم جديد عند الحفظ — التعديل هيبقى معاينة تانية');
  });

  test('الصف القديم بيتشال عند حفظ التعديل', () {
    expect(form, contains('deleteInspection(widget.existing!.localId!)'));
  });
}
