// اتجاه التطبيق ولغته — الأساس اللي لو اتكسر كل شاشة بتبان غلط.
//
// This file used to be the Flutter template's counter test, referring to a `MyApp` this project
// never had. It did not compile, so `flutter test` failed before running anything — which meant the
// app had no tests at all while appearing to have one.
//
// What replaces it guards the things a right-to-left Arabic app gets wrong quietly: the direction
// itself and the locale that drives date and number formatting. Neither throws when it is wrong;
// the app just renders subtly foreign and nobody can say why.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:techno_inspections/main.dart';

void main() {
  testWidgets('التطبيق كله بيتكتب من اليمين للشمال', (tester) async {
    await tester.pumpWidget(const TechnoInspectionsApp(home: Scaffold()));
    await tester.pump();

    // Read the direction from INSIDE the tree, below the builder that sets it — asserting on the
    // MaterialApp's own properties would still pass if the wrapper stopped being applied.
    final context = tester.element(find.byType(Scaffold).first);
    expect(Directionality.of(context), TextDirection.rtl,
        reason: 'الشاشة بتترسم من الشمال — كل الحشو والأسهم هيبقوا في الناحية الغلط');
  });

  testWidgets('اللغة عربي مصري ومعاها ترجمات المواد', (tester) async {
    await tester.pumpWidget(const TechnoInspectionsApp(home: Scaffold()));
    await tester.pump();

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.locale, const Locale('ar', 'EG'));
    // Without the delegates the Material widgets keep their English labels — «Cancel» on a dialog
    // in an otherwise Arabic screen — and no individual screen can fix that locally.
    expect(app.localizationsDelegates, isNotNull);
    expect(app.localizationsDelegates!.length, greaterThanOrEqualTo(3));
  });
}
