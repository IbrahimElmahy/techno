import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';

/// حالة المزامنة اللي بتحصل لوحدها — الشاشات بتسمعها وبتعرض العلامة.
enum AutoSyncState { idle, running, done, failed }

/// **المزامنة بتحصل لوحدها أول ما التطبيق يفتح، لو فيه نت.**
///
/// المندوب ماكانش لازم يفتكر يعمل مزامنة. اللي بينسى بيفتح الفاتورة ويلاقيها ناقصة،
/// واللي فاكر بيدخل شاشة تانية كل صبح عشان يدوس زرار — والتطبيق يقدر يعمل ده لوحده.
///
/// **بس لوحدها مش معناها في السر.** فيه علامة بتلف فوق طول ما شغّالة، ورسالة بتقول
/// اتحدّث إيه أو فشل ليه. المزامنة الصامتة أوحش من مافيش مزامنة: الواحد مايعرفش لو
/// اللي شايفه جديد ولا بايت.
///
/// **والفشل مابيوقفش حد.** التطبيق شغّال offline بطبعه، فلو مافيش نت أو السيرفر واقع
/// بيفضل بآخر بيانات نزلت — بس بيقول.
class AutoSync extends ChangeNotifier {
  AutoSync._();
  static final AutoSync instance = AutoSync._();

  AutoSyncState state = AutoSyncState.idle;
  String? message;

  /// آخر مرة اشتغلت فيها بنجاح — عشان مانلفّش على السيرفر كل مرة الشاشة تترسم.
  DateTime? _lastRun;
  bool _running = false;

  /// أقل مدة بين تشغيلتين تلقائيتين. الدخول والرجوع لشاشة البداية بيحصلوا كتير في
  /// الدقيقة الواحدة، ومافيش داعي كل واحدة تروح للسيرفر.
  static const _cooldown = Duration(minutes: 10);

  /// بتشتغل أول ما الشاشة الرئيسية تفتح. بتتخطى بهدوء لو:
  /// مافيش نت، أو واحدة شغّالة، أو واحدة نجحت من أقل من [_cooldown].
  Future<void> maybeRun({bool force = false}) async {
    if (_running) return;
    if (!force && _lastRun != null &&
        DateTime.now().difference(_lastRun!) < _cooldown) {
      return;
    }
    if (await LocalDb.instance.getKv('token') == null) return; // مش داخل
    if (!force && !await _online()) return;
    await run();
  }

  /// نفس شغل زرار «مزامنة الآن» — بترفع الطابور وبعدين بتسحب.
  Future<void> run() async {
    if (_running) return;
    _running = true;
    _set(AutoSyncState.running, 'بيزامن...');
    try {
      // **كل طابور بيتحاسب لوحده.**
      //
      // كانوا مربوطين في سلسلة واحدة: أول `await` يرمي بيوقّف اللي بعده. يعني فاتورة
      // واحدة السيرفر رافضها بتقفل الطابور كله — التحصيلات وأذون التحويل بتفضل على
      // الجهاز والمكتب مايشوفش حاجة، والمندوب شايف رسالة عن الفاتورة بس فمش عارف إن
      // في حاجات تانية واقفة وراها. (ده اللي خلّى أذون التحويل «مش بتوصل».)
      //
      // دلوقتي كل واحد بيتنفّذ ويتجمّع خطأه، والباقي بيكمّل. الأخطاء بتتقال كلها في
      // الآخر — مش بتتبلع.
      final errors = <String>[];
      Future<int> step(Future<int> Function() f) async {
        try {
          return await f();
        } on ApiException catch (e) {
          // ٤٠١ معناها الجلسة خلصت — دي بتوقّف كل حاجة فعلاً، مافيش فايدة من إن
          // الطوابير التانية تحاول بنفس التوكن الميّت.
          if (e.statusCode == 401) rethrow;
          errors.add(e.message);
          return 0;
        } catch (e) {
          errors.add('$e');
          return 0;
        }
      }

      final pushed = await step(ApiClient.instance.pushInspections);
      final coupons = await step(ApiClient.instance.pushCouponReceipts);
      // الرفع قبل السحب: الرفع بيخصم من العهدة على السيرفر، والسحب اللي بعده بيجيب
      // الرصيد بعد الخصم. العكس بيرجّع أرقام قديمة على طول.
      final invoices = await step(ApiClient.instance.pushSaleInvoices);
      final collected = await step(ApiClient.instance.pushReceipts);
      final permits = await step(ApiClient.instance.pushTransfers);
      await ApiClient.instance.pullReferenceData();

      // حزمة البيع — ٤٠٣ (مش مندوب) و٤٠٤ (مالوش مخزن) مش أعطال. أي حاجة تانية عطل
      // وبتتقال، مش بتتبلع تحت علامة صح.
      var items = 0;
      String? note;
      try {
        await ApiClient.instance.pullSalesBundle();
        items = (await LocalDb.instance.saleItems()).length;
      } on ApiException catch (e) {
        if (e.statusCode == 404) {
          note = 'مالكش مخزن ولا عهدة مسجّلة';
        } else if (e.statusCode != 403) {
          rethrow;
        }
      }

      final parts = <String>[
        if (pushed > 0) 'اترفعت $pushed معاينة',
        if (coupons > 0) 'اترفع $coupons استلام كوبونات',
        if (invoices > 0) 'اترفعت $invoices فاتورة',
        if (collected > 0) 'اترفع $collected تحصيل',
        if (permits > 0) 'اترفع $permits إذن تحويل',
        if (items > 0) '$items صنف في عربيتك',
      ];
      _lastRun = DateTime.now();
      final done =
          parts.isEmpty ? 'كل حاجة محدّثة ✔' : '${parts.join(' و')} ✔';
      final warn = <String>[if (note != null) note, ...errors];
      // **اللي رفع ووقع بيتقال الاتنين.** المزامنة اللي رفعت ٣ فواتير وفشلت في
      // واحدة نجحت جزئياً، وعلامة صح لوحدها بتكدب وعلامة غلط لوحدها بتخوّف.
      // الحالة بتبقى «فشل» لو مافيش أي حاجة عدّت، وإلا «تم» ومعاها التحذير.
      _set(
        parts.isEmpty && errors.isNotEmpty
            ? AutoSyncState.failed
            : AutoSyncState.done,
        warn.isEmpty ? done : '$done\n⚠ ${warn.join('\n⚠ ')}',
      );
    } catch (e) {
      _set(AutoSyncState.failed, _short(e));
    } finally {
      _running = false;
    }
  }

  /// بتخلي العلامة تختفي بعد ما الرسالة تتقري.
  void clear() {
    if (state == AutoSyncState.running) return;
    state = AutoSyncState.idle;
    message = null;
    notifyListeners();
  }

  void _set(AutoSyncState s, String? m) {
    state = s;
    message = m;
    notifyListeners();
  }

  /// فيه نت؟ — سؤال رخيص قبل ما نفتح اتصال كامل. الفشل هنا معناه «لأ» مش عطل.
  Future<bool> _online() async {
    try {
      final r = await InternetAddress.lookup('one.one.one.one')
          .timeout(const Duration(seconds: 4));
      return r.isNotEmpty && r.first.rawAddress.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  String _short(Object e) {
    final s = e.toString().replaceFirst('Exception: ', '');
    if (e is SocketException || s.contains('SocketException')) {
      return 'مافيش نت — التطبيق شغّال بآخر بيانات نزلت';
    }
    if (s.contains('TimeoutException')) return 'السيرفر مارضيش يرد — هنعيد بعدين';
    return s.length > 120 ? '${s.substring(0, 120)}…' : s;
  }
}
