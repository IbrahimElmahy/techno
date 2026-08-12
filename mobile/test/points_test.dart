// نقاط المعاينات كانت بتتقطع لصفر.
//
// Ten of the thirty-two inspection item types are worth LESS than a point: «قطعه لحام اخضر او
// معزول 20"» is 0.25, the 25"/32" one is 0.5. The item picker rendered them with `toInt()`, so the
// rep choosing one was told «0 نقطة» — and the running total under it said 0 too. What the client
// reported was «نقاط المعاينات مش موجودة», and from where he was standing that is exactly what it
// looked like: a third of the catalogue worth nothing.
//
// The saved line was never wrong — only what the rep could see while deciding. That is worse than
// it sounds, because the number on screen is the whole reason he is picking one item over another.
import 'package:flutter_test/flutter_test.dart';

import 'package:techno_inspections/models/points.dart';

void main() {
  test('الكسور بتفضل زي ما هي', () {
    // The real values out of the catalogue.
    expect(points(0.25), '0.25');
    expect(points(0.5), '0.5');
    expect(points(0.25 * 4), '1');
  });

  test('الأرقام الصحيحة مابتجرش وراها أصفار', () {
    expect(points(2), '2');
    expect(points(12), '12');
    expect(points(0), '0');
  });

  test('صنف نقاطه أقل من واحد مابيبقاش صفر', () {
    // The bug in one line: `0.25.toInt()` is 0.
    expect(points(0.25), isNot('0'));
    expect(points(0.5), isNot('0'));
  });

  test('الإجمالي بيحافظ على كسوره', () {
    // Three quarter-point pieces are three quarters of a point, not zero and not one.
    expect(points(0.25 * 3), '0.75');
  });
}
