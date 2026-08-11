// الدخول من غير نت — كان مفتوح لأي حد.
//
// The offline branch of `ApiClient.login` used to end in `|| u.isNotEmpty`, so ANY username with
// ANY password — an empty one included — was let in the moment the server did not answer within
// three seconds. Whoever picked the phone up was inside: every cached customer readable, and any
// inspection they wrote would sync into the ERP under that name. Reaching it took no skill at all —
// turning the wifi off is enough.
//
// A rep genuinely has to work with no signal, so offline entry has to keep working. The rule that
// replaced it is «only somebody this device has already watched log in successfully, checked
// against what they typed then», and these tests hold both halves of that: the stranger is refused,
// and the person who logged in before still gets in.
//
// Every test here runs with no server reachable, which is the condition the bug lived in.
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:techno_inspections/api/api_client.dart';
import 'package:techno_inspections/db/local_db.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    // A clean device every time: the whole question is what this device remembers.
    final db = await LocalDb.instance.db;
    await db.delete('kv');
    // Point at an address nothing answers on, so `login` always falls through to the offline
    // branch — the same situation as a rep standing in a basement.
    await LocalDb.instance.setKv('api_base', 'http://127.0.0.1:9');
  });

  test('حد ما دخلش على الجهاز ده قبل كده — مايدخلش', () async {
    await expectLater(
      ApiClient.instance.login('حد غريب', 'أي كلمة'),
      throwsA(isA<ApiException>()),
    );
    expect(await LocalDb.instance.getKv('token'), isNull,
        reason: 'اتمنع من الدخول بس التوكن اتكتب برضه');
  });

  test('باسورد فاضية مش باسورد', () async {
    await expectLater(
      ApiClient.instance.login('rep', ''),
      throwsA(isA<ApiException>()),
    );
    expect(await LocalDb.instance.getKv('token'), isNull);
  });

  test('اللي دخل صح قبل كده بيقدر يدخل من غير نت', () async {
    // Stand in for a successful online login: that is the only thing that writes this record.
    await LocalDb.instance.setKv('api_base', 'http://127.0.0.1:9');
    await _rememberOnce('ahmed', 'S3cret!');

    await ApiClient.instance.login('ahmed', 'S3cret!');
    expect(await LocalDb.instance.getKv('token'), isNotNull);
    expect(await LocalDb.instance.getKv('username'), 'ahmed');
  });

  test('نفس الشخص بباسورد غلط — مايدخلش', () async {
    await _rememberOnce('ahmed', 'S3cret!');

    await expectLater(
      ApiClient.instance.login('ahmed', 'غلط'),
      throwsA(isA<ApiException>()),
    );
    expect(await LocalDb.instance.getKv('token'), isNull);
  });

  test('البصمة المتخزنة مش الباسورد نفسها', () async {
    await _rememberOnce('ahmed', 'S3cret!');
    final stored = await LocalDb.instance.getKv('offline_auth_ahmed');
    expect(stored, isNotNull);
    expect(stored, isNot(contains('S3cret!')),
        reason: 'الباسورد متخزنة زي ما هي على الجهاز');
  });
}

/// يعمل نفس اللي بيحصل بعد أول دخول ناجح وإنت أونلاين.
///
/// Goes through the client's own recorder rather than hand-writing a row, so the record is in
/// whatever format the app actually reads — a hand-built one could match a format the app no
/// longer uses and the test would pass on nothing.
Future<void> _rememberOnce(String username, String password) =>
    ApiClient.instance.rememberOfflineCredential(username, password);
