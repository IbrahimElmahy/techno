// الموبايل لازم يفضل على بلجن sqflite — مش محرّك الديسكتوب.
//
// `databaseFactoryFfi` is the DESKTOP engine: it opens a file by path itself instead of going
// through the Android plugin, and on a phone that path is not somewhere the app may write. It had
// been set for every non-web platform at once, inside a `catch (_) {}` that threw the evidence
// away — so the phone silently got the desktop engine and nothing said so.
//
// What reached the rep was the login screen refusing with «unable to open database file (code 14)».
// The app could not open its own storage, so it could do nothing at all — and none of this shows up
// on Windows or in a test run, because both of those genuinely want the FFI engine. It only appears
// on a real phone, after an APK is built and installed.
//
// So the rule is checked in the source: the selection has to name the desktop platforms, and must
// not hand the FFI engine to whatever is left over.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final raw = File('lib/main.dart').readAsStringSync();
  // Comments describe the bug on purpose, and matching prose would make these tests pass or fail on
  // how the explanation is worded rather than on what the code does.
  final source = raw
      .split(RegExp(r'\r?\n'))
      .where((l) => !l.trimLeft().startsWith('//'))
      .join(' ');

  test('محرّك الديسكتوب بيتحدد للديسكتوب بالاسم', () {
    for (final platform in ['windows', 'linux', 'macOS']) {
      expect(source, contains('TargetPlatform.$platform'),
          reason: 'الديسكتوب مش متحدد بالاسم — يبقى الاختيار بيشتغل بالاستبعاد');
    }
  });

  test('مش بيتحط لكل حاجة مش ويب', () {
    // The exact shape of the bug: «if web → web engine, else → FFI». Anything that assigns the FFI
    // factory in an unconditional `else` hands it to Android and iOS again.
    final elseBranch = RegExp(r'\}\s*else\s*\{[^}]*databaseFactoryFfi\b[^}]*\}');
    expect(elseBranch.hasMatch(source), isFalse,
        reason: 'محرّك الديسكتوب راجع تاني لكل اللي مش ويب — الموبايل داخل فيهم');
  });

  test('فشل التهيئة مايتبلعش', () {
    // `catch (_) {}` around the initialisation is what let the wrong engine be chosen in silence.
    expect(source, isNot(contains('catch (_) {}')),
        reason: 'في catch فاضي حوالين تهيئة قاعدة البيانات — بيخفي بالظبط اللي حصل');
  });
}
