// كروت الأرقام مكانتش بتبان كاملة — كان الهيدر بيقصّها.
//
// The two stat cards were pulled 30 pixels up with `Transform.translate` so they would overlap the
// green header, the way a hero card sits half over a banner. That works when the card is inside the
// banner's own stack. Here the banner is a `SliverAppBar` with `pinned: true`, and a pinned header
// paints ON TOP of everything that scrolls under it — so the top of both cards was simply covered.
//
// On the rep's phone the numbers sat with their tops sliced off. Nothing errors, nothing logs; it
// just looks broken, and only on a device.
//
// This measures it instead of describing it: whatever the header ends up being, the cards have to
// start below where it ends.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:techno_inspections/screens/home_screen.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  testWidgets('الكروت بتبدأ تحت الهيدر مش وراه', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      locale: Locale('ar', 'EG'),
      home: Directionality(textDirection: TextDirection.rtl, child: HomeScreen()),
    ));
    // Let the screen's own start-up settle without waiting on anything that needs a network.
    await tester.pump(const Duration(milliseconds: 100));

    final header = find.byType(SliverAppBar);
    expect(header, findsOneWidget, reason: 'الهيدر مش موجود — الشاشة اتغيّرت؟');

    // The CARD, not the label inside it. The label sits low behind its own padding, so measuring
    // it passed happily while the card's top edge was cut off — which is the whole bug.
    final cards = find.ancestor(
      of: find.text('الزيارات المنجزة'),
      matching: find.byType(Container),
    ).first;
    expect(cards, findsOneWidget, reason: 'كارت الزيارات مش ظاهر خالص');

    // A sliver is not a box and cannot be measured directly. At scroll offset zero the pinned
    // header covers exactly [0, expandedHeight], so that IS its bottom edge.
    final bar = tester.widget<SliverAppBar>(header);
    final headerBottom = bar.expandedHeight!;
    final cardTop = tester.getRect(cards).top;

    expect(cardTop, greaterThanOrEqualTo(headerBottom),
        reason: 'الكارت بيبدأ عند $cardTop والهيدر بينتهي عند $headerBottom — '
            'يعني الهيدر المثبّت بيرسم فوق أوله');
  });
}
