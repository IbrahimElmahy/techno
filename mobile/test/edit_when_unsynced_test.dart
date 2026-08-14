// التعديل مسموح طول ما المعاينة متزامنتش — وممنوع بعد ما تتزامن.
//
// A visit that has not reached the server exists on this phone and nowhere else, so correcting it
// is just correcting a form nobody has seen. Once it HAS synced it is a record the office may
// already have acted on — points credited, a customer told a figure — and the phone is no longer
// the place it gets corrected from.
//
// The dangerous direction is one-way: showing the edit button on a synced visit lets a rep quietly
// rewrite something the office is working from, and the phone would then re-upload it under the
// same `client_uuid` the server already has. So the guard is asserted positively AND negatively.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final review = File('lib/screens/review_screen.dart').readAsStringSync();
  final form = File('lib/screens/inspection_form_screen.dart').readAsStringSync();

  test('زرار التعديل بيظهر لما تكون متزامنتش بس', () {
    expect(review, contains('if (!insp.synced)'),
        reason: 'مافيش أي شرط على المزامنة — يبقى التعديل متاح على المتزامن كمان');
    // The edit route must sit inside the not-synced branch, not beside it.
    final guard = review.indexOf('if (!insp.synced)');
    final edit = review.indexOf('existing: insp');
    expect(edit, greaterThan(guard),
        reason: 'التعديل برّه شرط «متزامنتش»');
  });

  test('المعاينة المتزامنة بتقول ليه مش بتتعدّل', () {
    // A disabled button nobody can explain is worse than no button: the rep taps it, nothing
    // happens, and he decides the app is broken.
    expect(review, contains('اتزامنت — مش بتتعدّل من التطبيق'));
  });

  test('التعديل بيمسك نفس رقم المعاينة مش بيعمل واحدة جديدة', () {
    // `client_uuid` is what makes the sync idempotent. Minting a new one on edit would upload the
    // corrected visit as a SECOND visit and leave the wrong one standing.
    expect(form, contains('_uuid = e?.clientUuid ?? const Uuid().v4();'));
    expect(form, contains('clientUuid: _uuid,'));
    expect(form, isNot(contains('clientUuid: const Uuid().v4(),')),
        reason: 'لسه بيولّد رقم جديد عند الحفظ — التعديل هيبقى معاينة تانية');
  });

  test('الصف القديم بيتشال عند حفظ التعديل', () {
    // Same uuid on two local rows means the sync queue holds the visit twice.
    expect(form, contains('deleteInspection(widget.existing!.localId!)'));
  });
}
