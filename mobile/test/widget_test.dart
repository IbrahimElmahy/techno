import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:techno_inspections/main.dart';

void main() {
  testWidgets('التطبيق كله بيتكتب من اليمين للشمال', (tester) async {
    await tester.pumpWidget(const TechnoInspectionsApp(home: Scaffold()));
    await tester.pump();

    final context = tester.element(find.byType(Scaffold).first);
    expect(Directionality.of(context), TextDirection.rtl,
        reason: 'الشاشة بتترسم من الشمال — كل الحشو والأسهم هيبقوا في الناحية الغلط');
  });

  testWidgets('اللغة عربي مصري ومعاها ترجمات المواد', (tester) async {
    await tester.pumpWidget(const TechnoInspectionsApp(home: Scaffold()));
    await tester.pump();

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.locale, const Locale('ar', 'EG'));
    expect(app.localizationsDelegates, isNotNull);
    expect(app.localizationsDelegates!.length, greaterThanOrEqualTo(3));
  });
}
