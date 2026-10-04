import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import 'app_updater.dart';
import 'task_progress.dart';

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

  /// الشغلانة اللي ماسكة القاعدة دلوقتي (مزامنة أو تحديث قوائم) — `null` = مافيش.
  ///
  /// **«مزامنة الآن» كانت بتتبلع لو التلقائية شغّالة.** `run()` كان بيرجع على طول لو
  /// فيه واحدة شغّالة، والتلقائية مابترفعش الفواتير — فالمندوب اللي داس وهي شغّالة كان
  /// بيشوف «تم» وفواتيره لسه على الجهاز. دلوقتي الدوسة بتستنى اللي شغّال يخلص وبعدين
  /// بتشتغل هي، وتحديث القوائم كمان بيقف في نفس الطابور (الاتنين بيبدّلوا نفس الجداول).
  Completer<void>? _inflight;

  bool get _running => _inflight != null;

  /// بتستنى لحد ما مايبقاش فيه حاجة شغّالة، وبعدين بتمسك القفل.
  Future<void> _acquire() async {
    while (_inflight != null) {
      await _inflight!.future;
    }
    _inflight = Completer<void>();
  }

  void _release() {
    final c = _inflight;
    _inflight = null;
    c?.complete();
  }

  /// أقل مدة بين تشغيلتين تلقائيتين. الدخول والرجوع لشاشة البداية بيحصلوا كتير في
  /// الدقيقة الواحدة، ومافيش داعي كل واحدة تروح للسيرفر.
  static const _cooldown = Duration(minutes: 10);

  /// بتشتغل أول ما الشاشة الرئيسية تفتح. بتتخطى بهدوء لو:
  /// مافيش نت، أو واحدة شغّالة، أو واحدة نجحت من أقل من [_cooldown].
  /// المزامنة اللي بتحصل لوحدها — بتفتح الشاشة، بتسحب لتحت، بيعدّي وقت.
  ///
  /// **مابترفعش فواتير البيع.** الفاتورة بتترفع لما المندوب يدوس «مزامنة الآن» وبس —
  /// شوف [run].
  Future<void> maybeRun({bool force = false}) async {
    if (_running) return;
    if (!force && _lastRun != null &&
        DateTime.now().difference(_lastRun!) < _cooldown) {
      return;
    }
    if (await LocalDb.instance.getKv('token') == null) return; // مش داخل
    if (!force && !await _online()) return;
    if (_running) return; // اتبدأت واحدة واحنا بنسأل عن النت
    await run(includeSales: false);
  }

  /// بترفع الطابور وبعدين بتسحب.
  ///
  /// [includeSales] = ترفع فواتير البيع كمان. **`false` في المزامنة التلقائية بقرار
  /// صاحب النظام:** الفاتورة مابترفعش لوحدها، بترفع لما المندوب يدوس «مزامنة الآن».
  ///
  /// السبب إن الرفع قرار مش خلفية: الفاتورة اللي وصلت السيرفر بقت مستند بقيد ومخزون
  /// اتحرّك، ومابتتعدّلش من الجهاز بعدها. فالمندوب اللي لسه بيراجع فاتورته كان بيلاقيها
  /// اترفعت من ورا ضهره وقفلت في وشّه. لما الرفع يبقى بدوسة، اللحظة دي بتبقى بإيده.
  ///
  /// والباقي (المعاينات · التحصيلات · الكوبونات · أذون التحويل) بيفضل بيترفع لوحده —
  /// دول مالهمش نفس القفل، وتأخيرهم بيضيّع شغل.
  Future<void> run({bool includeSales = true}) async {
    // التلقائية مابتستناش — لو فيه حاجة شغّالة يبقى البيانات بتتحدّث أصلاً.
    // «مزامنة الآن» بتستنى وتشتغل بعدها، عشان الفواتير ماتتنساش (شوف [_inflight]).
    if (_running && !includeSales) return;
    await _acquire();
    _set(AutoSyncState.running, 'بيزامن...');
    final tr = TaskTracker.instance;
    final totalSteps = includeSales ? 7 : 6;
    var stepNo = 0;
    void show(String label, [int done = 0, int total = 0]) {
      final frac = total > 0 ? done / total : 0.0;
      tr.update(BgTask.sync, total > 1 ? '$label ${done + 1}/$total' : label,
          progress: ((stepNo + frac) / totalSteps).clamp(0.0, 1.0));
    }

    tr.start(BgTask.sync, 'بيزامن…', progress: 0);
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
      Future<int> step(String label, Future<int> Function(CountProgress p) f) async {
        show(label);
        try {
          return await f((done, total) => show(label, done, total));
        } on ApiException catch (e) {
          // ٤٠١ معناها الجلسة خلصت — دي بتوقّف كل حاجة فعلاً، مافيش فايدة من إن
          // الطوابير التانية تحاول بنفس التوكن الميّت.
          if (e.statusCode == 401) rethrow;
          errors.add(e.message);
          return 0;
        } catch (e) {
          errors.add(_short(e));
          return 0;
        } finally {
          stepNo++;
        }
      }

      final pushed = await step('بيرفع المعاينات', (_) => ApiClient.instance.pushInspections());
      final coupons = await step('بيرفع استلامات الكوبونات',
          (p) => ApiClient.instance.pushCouponReceipts(onProgress: p));
      // الرفع قبل السحب: الرفع بيخصم من العهدة على السيرفر، والسحب اللي بعده بيجيب
      // الرصيد بعد الخصم. العكس بيرجّع أرقام قديمة على طول.
      // `refreshStock: false` — السحب بيحصل تحت على طول، فمافيش لزوم لندائين.
      final invoices = includeSales
          ? await step('بيرفع الفواتير',
              (p) => ApiClient.instance.pushSaleInvoices(refreshStock: false, onProgress: p))
          : 0;
      final collected = await step(
          'بيرفع التحصيلات', (p) => ApiClient.instance.pushReceipts(onProgress: p));
      final permits = await step(
          'بيرفع أذون التحويل', (p) => ApiClient.instance.pushTransfers(onProgress: p));

      // **السحب بيتحاسب لوحده هو كمان.** كان برّه `step`، فأي وقعة فيه (الملّاك مثلاً)
      // كانت بترمي المزامنة كلها في «فشل» — حتى لو الفواتير اترفعت — وحزمة البيع
      // (الأصناف والأرصدة والعملاء) ماكانتش بتتسحب خالص.
      final pulled = await _pullAll(errors,
          onStep: (label) => show(label), onBundle: () => show('بيجيب بضاعتك وعملاءك…'),
          afterReference: () => stepNo++);
      final items = pulled.items;
      final note = pulled.note;

      final parts = <String>[
        if (pushed > 0) 'اترفعت $pushed معاينة',
        if (coupons > 0) 'اترفع $coupons استلام كوبونات',
        if (invoices > 0) 'اترفعت $invoices فاتورة',
        if (collected > 0) 'اترفع $collected تحصيل',
        if (permits > 0) 'اترفع $permits إذن تحويل',
        if (items > 0) '$items صنف في عربيتك',
      ];
      final done =
          parts.isEmpty ? 'كل حاجة محدّثة ✔' : '${parts.join(' و')} ✔';
      final warn = <String>[if (note != null) note, ...errors];
      // **اللي رفع ووقع بيتقال الاتنين.** المزامنة اللي رفعت ٣ فواتير وفشلت في
      // واحدة نجحت جزئياً، وعلامة صح لوحدها بتكدب وعلامة غلط لوحدها بتخوّف.
      // الحالة بتبقى «فشل» لو مافيش أي حاجة عدّت، وإلا «تم» ومعاها التحذير.
      final failed = parts.isEmpty && errors.isNotEmpty;
      if (!failed) _lastRun = DateTime.now();
      _set(
        failed ? AutoSyncState.failed : AutoSyncState.done,
        warn.isEmpty ? done : '$done\n⚠ ${warn.join('\n⚠ ')}',
      );
      if (failed) {
        tr.finish(BgTask.sync, 'المزامنة مانفعتش: ${errors.join(' · ')}', error: true);
      } else if (warn.isNotEmpty) {
        tr.finish(BgTask.sync, '$done — ⚠ ${warn.join(' · ')}',
            error: errors.isNotEmpty, hold: const Duration(seconds: 12));
      } else {
        tr.finish(BgTask.sync, done);
      }
      // المزامنة اللي نجحت معناها إن فيه نت والسيرفر بيرد — لحظة كويسة نسأل فيها عن
      // تحديث. السؤال متقنّن جوّه `check` (مرة كل نص ساعة)، والنسخة اللي المندوب قال
      // عليها «بعدين» بتتأجّل جوّاه برضه.
      if (!failed) unawaited(AppUpdater.instance.check());
    } catch (e) {
      final m = _short(e);
      _set(AutoSyncState.failed, m);
      tr.finish(BgTask.sync, 'المزامنة مانفعتش: $m', error: true);
    } finally {
      _release();
    }
  }

  /// «تحديث الأصناف والقوائم» — **كل** اللي بينزل من السيرفر، من غير رفع.
  ///
  /// الزرار كان بينادي السحب في الشاشة نفسها من غير أي علامة إنه شغّال: سحب العملاء
  /// والملّاك (٧٬٨٠٠ صف على صفحات) بياخد دقيقة على نت موبايل، والمندوب بيدوس ومايشوفش
  /// حاجة فيفتكره بايظ. وأول وقعة (أصناف المعاينة مثلاً) كانت بتوقّف الباقي — حزمة البيع
  /// (أصناف العربية وأسعارها وأقل سعر والعملاء والأرصدة) ماكانتش بتتسحب.
  ///
  /// دلوقتي كل خطوة بتبان في الشريط اللي تحت، والوقعة في خطوة مابتوقّفش اللي بعدها.
  Future<void> refreshLists() async {
    final tr = TaskTracker.instance;
    if (_running) tr.start(BgTask.lists, 'مستني المزامنة اللي شغّالة تخلص…');
    await _acquire();
    var stepNo = 0;
    const totalSteps = 2;
    void show(String label) => tr.update(BgTask.lists, label,
        progress: ((stepNo + 0.15) / totalSteps).clamp(0.0, 1.0));
    tr.start(BgTask.lists, 'بيجيب الأصناف والقوائم…', progress: 0);
    try {
      final errors = <String>[];
      final pulled = await _pullAll(errors,
          onStep: show,
          onBundle: () => show('بيجيب أصناف عربيتك وأسعارها وعملاءك…'),
          afterReference: () => stepNo++);
      final items = pulled.items;
      final ok = items > 0
          ? 'اتحدّثت القوائم و$items صنف في عربيتك ✔'
          : 'اتحدّثت القوائم ✔';
      final warn = <String>[if (pulled.note != null) pulled.note!, ...errors];
      if (errors.isNotEmpty && !pulled.anyOk) {
        tr.finish(BgTask.lists, 'التحديث مانفعش: ${errors.join(' · ')}', error: true);
      } else if (warn.isNotEmpty) {
        tr.finish(BgTask.lists, '$ok — ⚠ ${warn.join(' · ')}',
            error: errors.isNotEmpty, hold: const Duration(seconds: 12));
      } else {
        tr.finish(BgTask.lists, ok);
      }
      // الأرقام اللي في الرئيسية (العملاء والأصناف) بتتقري تاني.
      if (pulled.anyOk) {
        _lastRun = DateTime.now();
        notifyListeners();
      }
    } catch (e) {
      tr.finish(BgTask.lists, 'التحديث مانفعش: ${_short(e)}', error: true);
    } finally {
      _release();
    }
  }

  /// السحب كله: القوائم (أصناف المعاينة · القوائم · العملاء · الملّاك) وحزمة البيع.
  ///
  /// كل جزء بيتحاسب لوحده. ٤٠١ بس اللي بيوقّف (الجلسة خلصت). الأخطاء بتتجمّع في [errors].
  Future<({int items, String? note, bool anyOk})> _pullAll(
    List<String> errors, {
    required void Function(String label) onStep,
    required void Function() onBundle,
    required void Function() afterReference,
  }) async {
    var anyOk = false;
    try {
      await ApiClient.instance.pullReferenceData(onStep: onStep);
      anyOk = true;
    } on ApiException catch (e) {
      if (e.statusCode == 401) rethrow;
      errors.add(e.message);
    } catch (e) {
      errors.add(_short(e));
    }
    afterReference();

    // حزمة البيع — ٤٠٣ (مش مندوب) و٤٠٤ (مالوش مخزن) مش أعطال. أي حاجة تانية عطل
    // وبتتقال، مش بتتبلع تحت علامة صح.
    var items = 0;
    String? note;
    onBundle();
    // صلاحيات التطبيق (الكروت) بتتحدّث مع كل مزامنة — اللي اتقفل من شاشة صلاحيات المستخدمين
    // بيختفي من غير ما المندوب يخرج ويدخل. فشلها مايوقفش حاجة.
    try {
      await ApiClient.instance.refreshAppCapabilities();
    } catch (_) {}
    try {
      await ApiClient.instance.pullSalesBundle();
      items = (await LocalDb.instance.saleItems()).length;
      anyOk = true;
    } on ApiException catch (e) {
      if (e.statusCode == 401) rethrow;
      if (e.statusCode == 404) {
        note = 'مالكش مخزن ولا عهدة مسجّلة';
      } else if (e.statusCode != 403) {
        errors.add(e.message);
      }
    } catch (e) {
      errors.add(_short(e));
    }
    return (items: items, note: note, anyOk: anyOk);
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
  ///
  /// **بيسأل عن السيرفر بتاعنا نفسه**، مش عن `one.one.one.one`. السؤال عن دومين حد
  /// تاني كان بيقول «مافيش نت» على أي شبكة بتقفله أو DNS بتاعها بطيء عليه — والمزامنة
  /// التلقائية (ومعاها فحص التحديث اللي بعدها) كانت بتتخطّى في صمت والسيرفر شغّال.
  Future<bool> _online() async {
    try {
      final host = Uri.parse(await ApiClient.instance.baseUrl()).host;
      final r = await InternetAddress.lookup(host.isEmpty ? 'app.technothermeg.com' : host)
          .timeout(const Duration(seconds: 6));
      return r.isNotEmpty && r.first.rawAddress.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  String _short(Object e) {
    final s = e.toString().replaceFirst('Exception: ', '');
    if (e is SocketException ||
        s.contains('SocketException') ||
        s.contains('Failed host lookup') ||
        s.contains('Connection refused') ||
        s.contains('Network is unreachable')) {
      return 'مافيش نت — التطبيق شغّال بآخر بيانات نزلت';
    }
    if (e is TimeoutException || s.contains('TimeoutException')) {
      return 'السيرفر مارضيش يرد — جرّب تاني';
    }
    return s.length > 160 ? '${s.substring(0, 160)}…' : s;
  }
}
