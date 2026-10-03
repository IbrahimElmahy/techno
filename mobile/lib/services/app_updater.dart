import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:ota_update/ota_update.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../theme.dart';
import 'task_progress.dart';

/// النسخة اللي متثبّتة على الموبايل.
class InstalledVersion {
  const InstalledVersion(this.name, this.rawCode);

  final String name;

  /// الرقم زي ما أندرويد شايفه — `2006` لو المتثبّت ملف arm64، `6` لو العام.
  final int rawCode;

  /// **الرقم الأساسي** — اللي في `pubspec.yaml` وفي `latest.json`.
  ///
  /// `flutter build apk --split-per-abi` بيحط كود المعمارية قدّام الرقم (`كود × ١٠٠٠ + الرقم`)
  /// عشان كل ملف ياخد رقم مختلف. من غير القسمة دي، التليفون اللي عليه 2005 كان هيشوف
  /// النسخة 6 على السيرفر «أقدم» منه ومايتحدّثش أبداً.
  int get code => rawCode % 1000;

  /// كود المعمارية اللي متثبّتة — `0` للعام، `1` armeabi-v7a، `2` arm64، `4` x86_64.
  int get abiCode => rawCode ~/ 1000;

  /// «0.3.3 (6)» — اللي بيتقال للدعم في التليفون.
  String get label => '$name ($code)';
}

/// اللي السيرفر بيقوله في `/app-update/latest`.
class AppRelease {
  AppRelease._(this.code, this.name, this.notes, this.force, this.urls, this.files,
      this.sha256, this.size);

  final int code;
  final String name;
  final String notes;
  final bool force;
  final Map<String, String> urls;
  final Map<String, String> files;
  final Map<String, String> sha256;
  final Map<String, int> size;

  static Map<String, String> _strings(Object? v) => v is Map
      ? {for (final e in v.entries) if (e.value != null) '${e.key}': '${e.value}'}
      : const {};

  factory AppRelease.fromJson(Map<String, dynamic> j) => AppRelease._(
        (j['version_code'] as num?)?.toInt() ?? 0,
        (j['version_name'] ?? '').toString(),
        (j['notes'] ?? '').toString().trim(),
        j['force'] == true,
        _strings(j['download_url']),
        _strings(j['files']),
        _strings(j['sha256']),
        {
          for (final e in _strings(j['size']).entries)
            if (int.tryParse(e.value) != null) e.key: int.parse(e.value)
        },
      );
}

/// بتقول السؤال للسيرفر وقع ليه — بالعربي، للشريط اللي تحت.
class _FetchError implements Exception {
  _FetchError(this.message);
  final String message;
}

/// الفحص واقف فين — عشان نعرف «مشغول» حقيقي ولا عالق.
enum _Phase { idle, fetching, dialog, downloading }

/// **التطبيق بيحدّث نفسه من السيرفر** — «التطبيق يتحدث مباشر، مش كل شوية نبعت update».
///
/// التطبيق مش على المتجر، فكل نسخة كانت بتتبعت APK لكل مندوب في الشارع. دلوقتي بيسأل
/// السيرفر (`backend/src/api/app_update.py`)، ولو فيه أحدث بينزّله ويفتح شاشة التثبيت.
/// دوسة «تثبيت» بتاعة أندرويد مالهاش حل — التطبيق مش مالك الجهاز — وكل اللي قبلها
/// بيحصل لوحده.
///
/// **الشغل اللي على الجهاز مابيضيعش.** التثبيت فوق نفس الباكدج بنفس مفتاح التوقيع بيحتفظ
/// بداتا التطبيق (القاعدة المحلية والطابور كله). والمفتاح هو مفتاح الـdebug على جهاز
/// البناء — لو اتغيّر، أندرويد هيرفض التحديث ويطلب مسح التطبيق، وده اللي بيضيّع الطابور.
/// فالتوقيع مايتلمسش.
///
/// **إمتى بيسأل.** أول ما التطبيق يفتح، وكل ما يرجع من الخلفية (مرة كل نص ساعة بالكتير)،
/// وبعد أي مزامنة أو رفع نجح. ودوسة «تحديث التطبيق» في القايمة بتسأل **دايماً** —
/// من غير تقنين ولا تأجيل — وبتقول النتيجة في الشريط اللي تحت أياً كانت.
///
/// قبل كده كان بيسأل عند الفتح من الصفر وبعد المزامنة التلقائية بس. أندرويد بيسيب
/// التطبيق شغّال في الخلفية أيام، والمندوب بيرفع فواتيره من «فواتيري» مش من المزامنة —
/// فالأجهزة الشغّالة ماكانتش بتسأل خالص (سجل السيرفر من ١ أكتوبر: ولا نداء).
///
/// **ومابيوقفش حد.** مافيش نت؟ السيرفر واقع؟ الفحص التلقائي بيفشل في صمت والمندوب
/// بيكمّل شغله.
class AppUpdater with WidgetsBindingObserver {
  AppUpdater._();
  static final AppUpdater instance = AppUpdater._();

  /// مفتاح الـNavigator بتاع التطبيق — الفحص بيتنادى من خدمات مالهاش `BuildContext`
  /// (المزامنة مثلاً)، والرسالة لازم تطلع فوق أي شاشة مفتوحة.
  static final navigatorKey = GlobalKey<NavigatorState>();

  /// قناة `MainActivity.kt` — إذن «التثبيت من مصادر غير معروفة» وفتح إعداداته.
  static const _installer = MethodChannel('techno/installer');

  static const _snoozeCodeKey = 'app_update_snooze_code';
  static const _snoozeAtKey = 'app_update_snooze_ms';

  /// **«بعدين» بتأجّل النسخة دي ٦ ساعات — مش الفحص.** المندوب بيفتح التطبيق ويقفله عشرات
  /// المرات في اليوم، ورسالة كل مرة بتتقفل من غير ما تتقري. بس التأجيل على الفحص نفسه كان
  /// بيخبّي نسخة اتنشرت بعد فحص لقى «مافيش جديد» — المندوب يستنى ٦ ساعات من غير سبب.
  /// فالسؤال للسيرفر بيحصل، والتأجيل بس للي المندوب قال عليه «بعدين».
  static const _snooze = Duration(hours: 6);

  /// أقل مدة بين فحصين تلقائيين (الرجوع من الخلفية وبعد المزامنة). الدوسة مش متقنّنة.
  static const _autoEvery = Duration(minutes: 30);

  /// كود المعمارية اللي Flutter بيحطه قدّام رقم النسخة (`FlutterPluginConstants.ABI_VERSION`).
  static const _abiCodes = {'armeabi-v7a': 1, 'arm64-v8a': 2, 'x86_64': 4};

  /// النسخة الأحدث اللي السيرفر قال عليها — القايمة بتعرض «متاح X» منها. `null` = مافيش.
  final available = ValueNotifier<AppRelease?>(null);

  _Phase _phase = _Phase.idle;

  /// الفحص الشغّال ده بيقول نتيجته؟ (اتبدأ بدوسة، أو اتداس عليه وهو شغّال)
  bool _manual = false;
  DateTime? _phaseSince;

  /// آخر فحص تلقائي وصل للسيرفر — للتقنين.
  DateTime? _lastAutoCheck;

  /// مستنيين المندوب يرجع من إعدادات «السماح بالتثبيت».
  Completer<void>? _resumeWaiter;
  bool _attached = false;

  /// المتصفح (نسخة التجربة) مالوش APK يتثبّت.
  static bool get supported => !kIsWeb && Platform.isAndroid;

  /// بيسمع رجوع التطبيق من الخلفية. بيتنادى مرة من `main()`.
  void attach() {
    if (_attached) return;
    _attached = true;
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final w = _resumeWaiter;
    _resumeWaiter = null;
    if (w != null && !w.isCompleted) w.complete();
    // متقنّن جوّه `check` — مرة كل نص ساعة بالكتير.
    unawaited(check(resume: true));
  }

  Future<InstalledVersion> installed() async {
    final p = await PackageInfo.fromPlatform();
    return InstalledVersion(p.version, int.tryParse(p.buildNumber) ?? 0);
  }

  bool get _busy {
    if (_phase == _Phase.idle) return false;
    // **السؤال للسيرفر مالوش إنه يطوّل** (مهلته ١٥ ثانية). لو الحالة لسه «بيسأل» بعد
    // دقيقتين يبقى حاجة وقعت من غير ما ترجّع الحالة — والفحص كان بيفضل «مشغول» للأبد
    // وكل دوسة بعدها بتتبلع. الحوار والتنزيل ليهم حالتهم ومابيتحسبوش عالقين.
    if (_phase == _Phase.fetching &&
        _phaseSince != null &&
        DateTime.now().difference(_phaseSince!) > const Duration(minutes: 2)) {
      _setPhase(_Phase.idle);
      return false;
    }
    return true;
  }

  void _setPhase(_Phase p) {
    _phase = p;
    _phaseSince = DateTime.now();
  }

  /// فيه نسخة أحدث؟ ولو فيه، اعرضها.
  ///
  /// [manual] = المندوب داس «تحديث التطبيق»: بيسأل السيرفر دايماً (مافيش تقنين ولا تأجيل)،
  /// والنتيجة بتتقال في الشريط اللي تحت أياً كانت.
  ///
  /// [atStart] = أول ما التطبيق يفتح — بيسأل دايماً، وبيسكت لو مافيش جديد.
  ///
  /// [resume] = التطبيق رجع من الخلفية. هو والفحص اللي بعد المزامنة متقنّنين بـ[_autoEvery].
  Future<void> check({bool manual = false, bool atStart = false, bool resume = false}) async {
    final tr = TaskTracker.instance;
    if (!supported) {
      if (manual) tr.finish(BgTask.update, 'التحديث من السيرفر على أندرويد بس', error: true);
      return;
    }
    if (_busy) {
      // التنزيل باين في الشريط أصلاً. البحث بيخلص في ثواني.
      // ولو لسه بيسأل، الدوسة بتتحسب: النتيجة هتتقال في الشريط زي ما تكون هي اللي بدأته.
      if (manual && _phase == _Phase.fetching) {
        _manual = true;
        tr.update(BgTask.update, 'بيدوّر على تحديث…');
      }
      return;
    }
    if (!manual && !atStart && _lastAutoCheck != null &&
        DateTime.now().difference(_lastAutoCheck!) < _autoEvery) {
      return;
    }
    _setPhase(_Phase.fetching);
    _manual = manual;
    try {
      if (manual) tr.start(BgTask.update, 'بيدوّر على تحديث…');
      final AppRelease latest;
      try {
        latest = await _fetch();
      } on _FetchError catch (e) {
        if (_manual) {
          tr.finish(BgTask.update, e.message,
              error: true, action: TaskAction('جرّب تاني', () => check(manual: true)));
        }
        return;
      }
      _lastAutoCheck = DateTime.now();
      final me = await installed();

      if (latest.code <= me.code) {
        available.value = null;
        if (_manual) tr.finish(BgTask.update, 'عندك آخر نسخة (${me.label}) ✔');
        return;
      }
      available.value = latest;

      final prefs = await SharedPreferences.getInstance();
      final now = DateTime.now().millisecondsSinceEpoch;
      final snoozed = !_manual && !latest.force &&
          prefs.getInt(_snoozeCodeKey) == latest.code &&
          now - (prefs.getInt(_snoozeAtKey) ?? 0) < _snooze.inMilliseconds;
      if (snoozed) return;

      if (_manual) {
        tr.update(BgTask.update, 'فيه نسخة جديدة (${latest.name})');
      }
      final later = await _offer(latest, me, manual: _manual);
      if (later) {
        await prefs.setInt(_snoozeCodeKey, latest.code);
        await prefs.setInt(_snoozeAtKey, now);
        if (_manual) {
          tr.finish(BgTask.update,
              'النسخة ${latest.name} مستنياك — دوس «تحديث التطبيق» من القايمة وقت ما تحب');
        }
      }
    } catch (e) {
      // الفحص التلقائي بيتنادى من غير `await` — خطأ هنا مالوش حد يمسكه، ومالوش لازمة
      // يوقّف المندوب في نص شغله. اليدوي بيقول.
      if (_manual || tr.isRunning(BgTask.update)) {
        tr.finish(BgTask.update, 'التحديث مانفعش — جرّب تاني',
            error: true, action: TaskAction('جرّب تاني', () => check(manual: true)));
      }
    } finally {
      // **دايماً**، في كل طريق — «مشغول» اللي مابيرجعش كان بيبلع كل دوسة بعده.
      _setPhase(_Phase.idle);
      // لو الشريط لسه بيقول «بيدوّر»/«فيه نسخة جديدة» (المندوب قفل الحوار)، يتقفل.
      if (tr.isRunning(BgTask.update)) tr.clear(BgTask.update);
    }
  }

  Future<AppRelease> _fetch() async {
    final base = await ApiClient.instance.baseUrl();
    final http.Response r;
    try {
      r = await http.get(
        Uri.parse('$base/api/v1/app-update/latest'),
        // أي proxy في السكة مايرجّعش رد قديم — النسخة الجديدة لازم تبان أول ما تتنشر.
        headers: const {'Cache-Control': 'no-cache'},
      ).timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw _FetchError('السيرفر مارضيش يرد — جرّب تاني كمان شوية');
    } catch (_) {
      throw _FetchError('مافيش نت — جرّب تاني لما يبقى فيه نت');
    }
    if (r.statusCode == 404) throw _FetchError('مافيش نسخة منشورة على السيرفر لسه');
    if (r.statusCode != 200) {
      throw _FetchError('السيرفر رد بخطأ (${r.statusCode}) — جرّب تاني كمان شوية');
    }
    try {
      return AppRelease.fromJson(
          jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>);
    } catch (_) {
      throw _FetchError('رد السيرفر مش مفهوم — كلّم الإدارة');
    }
  }

  /// أنهي ملف ينزل للموبايل ده.
  ///
  /// **أول معمارية الموبايل بيفضّلها** (`supportedAbis` مترتبة) ومنشورة — ملف arm64 حوالي
  /// ٢٨ ميجا والعام ٧٣، والفرق ده على نت موبايل في الشارع.
  ///
  /// **بس مش أي ملف ينفع.** رقم ملف المعمارية فيه كودها (arm64 = 2006، armeabi-v7a = 1006)
  /// وأندرويد بيرفض أي تثبيت برقم أقل من المتثبّت. فاللي عليه arm64 (2005) مايقدرش ياخد
  /// armeabi-v7a (1006) ولا العام (6). العام بينفع بس لو المتثبّت هو العام.
  String? _pickAbi(AppRelease r, InstalledVersion me, List<String> deviceAbis) {
    for (final abi in deviceAbis) {
      final code = _abiCodes[abi];
      if (code == null || !r.urls.containsKey(abi)) continue;
      if (code < me.abiCode) continue;
      return abi;
    }
    if (me.abiCode == 0 && r.urls.containsKey('universal')) return 'universal';
    return null;
  }

  /// بترجع `true` لو المندوب داس «بعدين» — الفحص بيأجّل النسخة دي بيها.
  Future<bool> _offer(AppRelease r, InstalledVersion me, {required bool manual}) async {
    final tr = TaskTracker.instance;
    final ctx = navigatorKey.currentContext;
    if (ctx == null) return false;

    final android = await DeviceInfoPlugin().androidInfo;
    final abi = _pickAbi(r, me, android.supportedAbis);
    if (abi == null) {
      // مابيحصلش غير لو النسخة اتنشرت ناقصة. التلقائي بيسكت — المندوب مايقدرش يعمل حاجة.
      if (manual || r.force) {
        tr.finish(BgTask.update,
            'فيه نسخة جديدة (${r.name}) بس مش منشورة لنوع موبايلك — كلّم الإدارة',
            error: true);
      }
      return false;
    }

    final pending = await LocalDb.instance.pendingByKind();
    final size = r.size[abi];
    if (!ctx.mounted) return false;

    _setPhase(_Phase.dialog);
    final go = await showDialog<bool>(
      context: ctx,
      barrierDismissible: !r.force,
      builder: (c) => PopScope(
        canPop: !r.force,
        child: AlertDialog(
          icon: const Icon(Icons.system_update, color: AppColors.primary, size: 36),
          title: Text('نسخة جديدة من التطبيق (${r.name})'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (r.notes.isNotEmpty) ...[
                  Text(r.notes),
                  const SizedBox(height: 10),
                ],
                Text(
                  [
                    'عندك ${me.label}',
                    if (size != null) 'الحجم ${(size / (1024 * 1024)).toStringAsFixed(1)} ميجا',
                  ].join(' · '),
                  style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 13),
                ),
                // **تنبيه مش منع.** التحديث مابيمسحش الطابور، بس المندوب اللي شايف رقم
                // فواتير مستنية هيقلق — فبنقوله إنها محفوظة، والأحسن يزامن الأول.
                if (pending.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF6E5),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      'عندك ${pending.entries.map((e) => '${e.value} ${e.key}').join(' · ')} '
                      'لسه ما اترفعتش. التحديث مابيمسحهاش — بتفضل على الجهاز — '
                      'بس الأحسن تعمل «مزامنة» الأول.',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                const Text(
                  'أول مرة، أندرويد هيطلب تسمح بالتثبيت من التطبيق ده — اسمح وارجع، '
                  'وبعدين دوس «تثبيت».',
                  style: TextStyle(fontSize: 13),
                ),
              ],
            ),
          ),
          actions: [
            if (!r.force)
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('بعدين')),
            FilledButton.icon(
              onPressed: () => Navigator.pop(c, true),
              icon: const Icon(Icons.download),
              label: const Text('تحديث الآن'),
            ),
          ],
        ),
      ),
    );
    if (go == true) await _download(r, abi);
    return go == false;
  }

  /// أندرويد سامح للتطبيق ده يثبّت تحديثاته؟ (إعداد «السماح من هذا المصدر»)
  Future<bool> _canInstall() async {
    try {
      return await _installer.invokeMethod<bool>('canInstall') ?? true;
    } catch (_) {
      // القناة مش موجودة (نسخة قديمة من الكود الأصلي) — نسيب أندرويد يسأل بنفسه.
      return true;
    }
  }

  Future<bool> _openInstallSettings() async {
    try {
      return await _installer.invokeMethod<bool>('openInstallSettings') ?? false;
    } catch (_) {
      return false;
    }
  }

  /// **الإذن قبل التنزيل، مش بعده.** من غيره المندوب كان بينزّل ٢٨ ميجا، وأندرويد يقوله
  /// «غير مسموح بالتثبيت من المصدر ده»، يروح الإعدادات ويرجع يلاقي التحديث ضاع ويبدأ من
  /// الأول. دلوقتي بنسأل الأول، بنفتح له الإعداد بنفسنا، ولما يرجع للتطبيق بنكمّل لوحدنا.
  Future<bool> _ensureInstallPermission() async {
    if (await _canInstall()) return true;
    while (true) {
      final ctx = navigatorKey.currentContext;
      if (ctx == null || !ctx.mounted) return false;
      final open = await showDialog<bool>(
        context: ctx,
        builder: (c) => AlertDialog(
          icon: const Icon(Icons.security_update_good_outlined,
              color: AppColors.primary, size: 36),
          title: const Text('اسمح بتثبيت التحديث'),
          content: const Text(
            'أندرويد محتاج تسمح للتطبيق ده إنه يثبّت تحديثاته.\n\n'
            'دوس «افتح الإعدادات»، فعّل «السماح من هذا المصدر»، وارجع للتطبيق — '
            'التحديث هيكمّل لوحده.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
            FilledButton.icon(
              onPressed: () => Navigator.pop(c, true),
              icon: const Icon(Icons.settings),
              label: const Text('افتح الإعدادات'),
            ),
          ],
        ),
      );
      if (open != true) return false;
      final back = Completer<void>();
      _resumeWaiter = back;
      if (!await _openInstallSettings()) {
        // الإعداد مافتحش (موبايل غريب) — نكمّل وأندرويد هيسأل بنفسه وقت التثبيت.
        _resumeWaiter = null;
        return true;
      }
      await back.future.timeout(const Duration(minutes: 10), onTimeout: () {});
      if (await _canInstall()) return true;
    }
  }

  /// بينزّل الملف ويسلّمه لشاشة التثبيت. بيرجع لما شاشة التثبيت تفتح أو التنزيل يقع.
  ///
  /// **التنزيل في الشريط اللي تحت مش في حوار قافل الشاشة** — المندوب يقدر يكمّل شغله
  /// وهو بينزل، و«إلغاء» جنب النسبة.
  Future<void> _download(AppRelease r, String abi) async {
    final tr = TaskTracker.instance;
    if (!await _ensureInstallPermission()) {
      tr.finish(BgTask.update, 'التحديث محتاج تسمح بالتثبيت من التطبيق ده',
          error: true,
          action: TaskAction('افتح الإعدادات', () => unawaited(_openInstallSettings())));
      return;
    }

    final base = await ApiClient.instance.baseUrl();
    final url = '$base${r.urls[abi]}';
    // الاسم بيتحط في `files/ota_update/`؛ المكتبة بترفض أي `/` فيه.
    final filename = (r.files[abi] ?? 'techno-${r.code}-$abi.apk').split('/').last;
    final checksum = r.sha256[abi];

    _setPhase(_Phase.downloading);
    final ota = OtaUpdate();
    final cancel = TaskAction('إلغاء', () => unawaited(ota.cancel()));
    tr.start(BgTask.update, 'بينزّل التحديث ${r.name}…', action: cancel);

    // آخر حالة — تثبيت اتفتح، أو خطأ، أو إلغاء. `null` = القناة اتقفلت من غير ما تقول.
    final done = Completer<OtaEvent?>();
    StreamSubscription<OtaEvent>? sub;
    // **حارس السكوت:** لو التنزيل بدأ وبعدين وقف يبعت أي حاجة دقيقتين، بنلغيه ونقول.
    // من غيره «مشغول» كان ممكن يفضل للأبد لو القناة سكتت (الموبايل نام في نص التنزيل).
    Timer? watchdog;
    void arm() {
      watchdog?.cancel();
      watchdog = Timer(const Duration(minutes: 2), () {
        unawaited(ota.cancel());
        if (!done.isCompleted) {
          done.complete(OtaEvent(OtaStatus.DOWNLOAD_ERROR, 'stalled'));
        }
      });
    }

    try {
      sub = ota
          .execute(url, destinationFilename: filename, sha256checksum: checksum)
          .listen((e) {
        if (e.status == OtaStatus.DOWNLOADING) {
          arm();
          final p = int.tryParse(e.value ?? '');
          tr.update(BgTask.update,
              p == null ? 'بينزّل التحديث ${r.name}…' : 'بينزّل التحديث $p٪',
              progress: p == null ? null : (p / 100).clamp(0.0, 1.0), action: cancel);
        } else if (!done.isCompleted) {
          done.complete(e);
        }
      }, onError: (Object e) {
        if (!done.isCompleted) done.complete(OtaEvent(OtaStatus.INTERNAL_ERROR, '$e'));
      }, onDone: () {
        if (!done.isCompleted) done.complete(null);
      });
    } catch (e) {
      if (!done.isCompleted) done.complete(OtaEvent(OtaStatus.INTERNAL_ERROR, '$e'));
    }

    final result = await done.future;
    watchdog?.cancel();
    await sub?.cancel();

    // ⚠ ota_update 7.1.0 مرقّم حالتين بالعكس بين جافا ودارت (INSTALLATION_ERROR و
    // ALREADY_RUNNING_ERROR) — فبنفرّقهم بالرسالة اللي جاية من جافا مش بالرقم.
    final value = result?.value ?? '';
    final alreadyRunning = value.toLowerCase().contains('already running');
    final String? error = switch (result?.status) {
      OtaStatus.INSTALLING || OtaStatus.INSTALLATION_DONE || null => null,
      OtaStatus.CANCELED => null,
      OtaStatus.CHECKSUM_ERROR => await _dropCorrupt(filename),
      OtaStatus.DOWNLOAD_ERROR => 'التنزيل وقف — اتأكد من النت وجرّب تاني.',
      OtaStatus.PERMISSION_NOT_GRANTED_ERROR =>
        'لازم تسمح بالتثبيت من التطبيق ده عشان التحديث يكمّل.',
      OtaStatus.ALREADY_RUNNING_ERROR || OtaStatus.INSTALLATION_ERROR => alreadyRunning
          ? 'فيه تنزيل شغّال بالفعل — استنى يخلص.'
          : 'التثبيت مانفعش — جرّب تاني.',
      _ => 'التحديث مانفعش — جرّب تاني.',
    };

    if (error == null) {
      if (result?.status == OtaStatus.CANCELED) {
        tr.finish(BgTask.update, 'اتلغى تنزيل التحديث — تقدر تبدأه تاني من القايمة');
      } else {
        // شاشة التثبيت بتاعة أندرويد اتفتحت (أو هتفتح دلوقتي).
        tr.finish(BgTask.update, 'جاهز للتثبيت — دوس «تثبيت» في الشاشة اللي طلعت ✔',
            hold: const Duration(seconds: 8));
      }
      return;
    }

    final permission = result?.status == OtaStatus.PERMISSION_NOT_GRANTED_ERROR;
    tr.finish(BgTask.update, error,
        error: true,
        action: permission
            ? TaskAction('افتح الإعدادات', () => unawaited(_openInstallSettings()))
            : null);

    final c2 = navigatorKey.currentContext;
    if (c2 == null || !c2.mounted) return;
    _setPhase(_Phase.dialog);
    final retry = await showDialog<bool>(
      context: c2,
      builder: (c) => AlertDialog(
        title: const Text('التحديث مانزلش'),
        content: Text(error),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إغلاق')),
          if (permission)
            TextButton(
              onPressed: () {
                unawaited(_openInstallSettings());
              },
              child: const Text('افتح الإعدادات'),
            ),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('جرّب تاني')),
        ],
      ),
    );
    // **حتى الإجباري بيتقفل هنا.** المندوب اللي نته ضعيف مايتحبسش على شاشة تنزيل بيفشل —
    // الرسالة بترجع أول ما يفتح التطبيق تاني.
    if (retry == true) await _download(r, abi);
  }

  /// الملف اللي بصمته مش مطابقة بيتمسح — نزل ناقص أو اتغيّر في السكة، ومايتثبّتش.
  Future<String> _dropCorrupt(String filename) async {
    try {
      // `getApplicationSupportDirectory` على أندرويد = `filesDir`، ونفس المجلد اللي
      // ota_update بينزّل فيه (`dataDir/files/ota_update`).
      final dir = await getApplicationSupportDirectory();
      final f = File('${dir.path}/ota_update/$filename');
      if (await f.exists()) await f.delete();
    } catch (_) {/* المكتبة بتمسحه قبل التنزيل الجاي على أي حال */}
    return 'الملف نزل ناقص أو متغيّر فاتمسح. جرّب تاني.';
  }
}
