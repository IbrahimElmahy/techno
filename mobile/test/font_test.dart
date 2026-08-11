// الخط اللي الثيم بيطلبه لازم يكون متحمّل فعلاً.
//
// The theme asked for «Cairo» and nothing bundled it. Flutter does not complain about that — it
// quietly falls back to the platform's default font — so the app shipped in a typeface nobody
// chose, looking nothing like the web system, which does load Cairo. There is no error to find,
// no warning in the build, and the code reads as though the font is set.
//
// This compares what the theme NAMES against what the pubspec DECLARES, and checks the file is
// really there. A font can go missing three ways — the family renamed in the theme, the entry
// dropped from the pubspec, the file not committed — and all three are silent.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final pubspec = File('pubspec.yaml').readAsStringSync();
  final theme = File('lib/theme.dart').readAsStringSync();

  /// كل خط الثيم بينده عليه بالاسم.
  Set<String> familiesNamedIn(String source) => RegExp(r"fontFamily: '([^']+)'")
      .allMatches(source)
      .map((m) => m.group(1)!)
      // A generic CSS-style family is resolved by the platform, not bundled by us.
      .where((f) => !const {'serif', 'sans-serif', 'monospace'}.contains(f))
      .toSet();

  test('كل خط الثيم بيطلبه معلَن في pubspec', () {
    final declared = RegExp(r'- family: (\S+)')
        .allMatches(pubspec)
        .map((m) => m.group(1)!)
        .toSet();

    for (final family in familiesNamedIn(theme)) {
      expect(declared, contains(family),
          reason: 'الثيم بيطلب «$family» ومحدش محمّله — Flutter هيرجع لخط النظام في صمت');
    }
  });

  test('ملفات الخط موجودة فعلاً على القرص', () {
    // Declared in the pubspec but never committed is the same silent fallback, one step later.
    final assets = RegExp(r'- asset: (\S+)').allMatches(pubspec).map((m) => m.group(1)!);
    expect(assets, isNotEmpty, reason: 'مفيش ولا ملف خط معلَن');
    for (final path in assets) {
      final file = File(path);
      expect(file.existsSync(), isTrue, reason: 'معلَن في pubspec ومش موجود: $path');
      expect(file.lengthSync(), greaterThan(10000),
          reason: 'الملف صغير أوي عشان يبقى خط — يمكن يكون صفحة خطأ اتحفظت بالغلط: $path');
    }
  });

  test('الترخيص شايل مع الخط', () {
    // Cairo ships under the SIL Open Font License, which requires the licence to travel with it.
    expect(File('assets/fonts/OFL.txt').existsSync(), isTrue,
        reason: 'الخط متحمّل من غير نص الترخيص بتاعه');
  });
}
