import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:ota_update/ota_update.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../theme.dart';

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
/// **ومابيوقفش حد.** مافيش نت؟ السيرفر واقع؟ السؤال بيفشل في صمت والمندوب بيكمّل شغله.
class AppUpdater {
  AppUpdater._();
  static final AppUpdater instance = AppUpdater._();

  /// مفتاح الـNavigator بتاع التطبيق — الفحص بيتنادى من خدمات مالهاش `BuildContext`
  /// (المزامنة مثلاً)، والرسالة لازم تطلع فوق أي شاشة مفتوحة.
  static final navigatorKey = GlobalKey<NavigatorState>();

  static const _snoozeCodeKey = 'app_update_snooze_code';
  static const _snoozeAtKey = 'app_update_snooze_ms';

  /// **«بعدين» بتأجّل النسخة دي ٦ ساعات — مش الفحص.** المندوب بيفتح التطبيق ويقفله عشرات
  /// المرات في اليوم، ورسالة كل مرة بتتقفل من غير ما تتقري. بس التأجيل على الفحص نفسه كان
  /// بيخبّي نسخة اتنشرت بعد فحص لقى «مافيش جديد» — المندوب يستنى ٦ ساعات من غير سبب.
  /// فالسؤال للسيرفر بيحصل كل مرة (رد صغير)، والتأجيل بس للي المندوب قال عليه «بعدين».
  static const _snooze = Duration(hours: 6);

  /// كود المعمارية اللي Flutter بيحطه قدّام رقم النسخة (`FlutterPluginConstants.ABI_VERSION`).
  static const _abiCodes = {'armeabi-v7a': 1, 'arm64-v8a': 2, 'x86_64': 4};

  bool _busy = false;

  /// المتصفح (نسخة التجربة) مالوش APK يتثبّت.
  static bool get supported => !kIsWeb && Platform.isAndroid;

  Future<InstalledVersion> installed() async {
    final p = await PackageInfo.fromPlatform();
    return InstalledVersion(p.version, int.tryParse(p.buildNumber) ?? 0);
  }

  /// فيه نسخة أحدث؟ ولو فيه، اعرضها.
  ///
  /// [manual] = المندوب داس «البحث عن تحديث»: مافيش تأجيل، والنتيجة بتتقال أياً كانت.
  ///
  /// [atStart] = أول ما التطبيق يفتح — نفس الفحص، والاسم بيوضّح مين نادى.
  Future<void> check({bool manual = false, bool atStart = false}) async {
    if (!supported) {
      if (manual) _say('التحديث من السيرفر على أندرويد بس');
      return;
    }
    if (_busy) {
      if (manual) _say('بيدوّر على تحديث بالفعل…');
      return;
    }
    _busy = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final now = DateTime.now().millisecondsSinceEpoch;

      if (manual) _say('بيدوّر على تحديث…', short: true);
      final AppRelease latest;
      try {
        latest = await _fetch();
      } catch (_) {
        if (manual) _say('مقدرناش نوصل للسيرفر — جرّب تاني لما يبقى فيه نت');
        return;
      }
      final me = await installed();

      if (latest.code <= me.code) {
        if (manual) _say('عندك آخر نسخة (${me.label}) ✔');
        return;
      }
      final snoozed = !manual && !latest.force &&
          prefs.getInt(_snoozeCodeKey) == latest.code &&
          now - (prefs.getInt(_snoozeAtKey) ?? 0) < _snooze.inMilliseconds;
      if (snoozed) return;
      final later = await _offer(latest, me, manual: manual);
      if (later) {
        await prefs.setInt(_snoozeCodeKey, latest.code);
        await prefs.setInt(_snoozeAtKey, now);
      }
    } catch (_) {
      // الفحص التلقائي بيتنادى من غير `await` — خطأ هنا مالوش حد يمسكه، ومالوش لازمة
      // يوقّف المندوب في نص شغله.
      if (manual) _say('التحديث مانفعش — جرّب تاني');
    } finally {
      _busy = false;
    }
  }

  Future<AppRelease> _fetch() async {
    final base = await ApiClient.instance.baseUrl();
    final r = await http
        .get(Uri.parse('$base/api/v1/app-update/latest'))
        .timeout(const Duration(seconds: 8));
    if (r.statusCode != 200) throw HttpException('app-update ${r.statusCode}');
    return AppRelease.fromJson(jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>);
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
    final ctx = navigatorKey.currentContext;
    if (ctx == null) return false;

    final android = await DeviceInfoPlugin().androidInfo;
    final abi = _pickAbi(r, me, android.supportedAbis);
    if (abi == null) {
      // مابيحصلش غير لو النسخة اتنشرت ناقصة. التلقائي بيسكت — المندوب مايقدرش يعمل حاجة.
      if (manual || r.force) {
        _say('فيه نسخة جديدة (${r.name}) بس مش منشورة لنوع موبايلك — كلّم الإدارة');
      }
      return false;
    }

    final pending = await LocalDb.instance.pendingByKind();
    final size = r.size[abi];
    if (!ctx.mounted) return false;

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

  /// بينزّل الملف ويسلّمه لشاشة التثبيت. بيرجع لما شاشة التثبيت تفتح أو التنزيل يقع.
  Future<void> _download(AppRelease r, String abi) async {
    final base = await ApiClient.instance.baseUrl();
    final url = '$base${r.urls[abi]}';
    // الاسم بيتحط في `files/ota_update/`؛ المكتبة بترفض أي `/` فيه.
    final filename = (r.files[abi] ?? 'techno-${r.code}-$abi.apk').split('/').last;
    final checksum = r.sha256[abi];

    final ctx = navigatorKey.currentContext;
    if (ctx == null || !ctx.mounted) return;

    final percent = ValueNotifier<int?>(null);
    final ota = OtaUpdate();
    BuildContext? progressCtx;
    unawaited(showDialog<void>(
      context: ctx,
      barrierDismissible: false,
      builder: (c) {
        progressCtx = c;
        return PopScope(
          canPop: false,
          child: AlertDialog(
            title: const Text('بينزّل التحديث…'),
            content: ValueListenableBuilder<int?>(
              valueListenable: percent,
              builder: (_, p, __) => Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  LinearProgressIndicator(value: p == null ? null : p / 100),
                  const SizedBox(height: 12),
                  Text(p == null ? 'بيبدأ…' : '$p٪',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => ota.cancel(), child: const Text('إلغاء')),
            ],
          ),
        );
      },
    ));
    // الشاشة لازم تكون اترسمت قبل ما التنزيل يبدأ: خطأ فوري (رابط غلط) كان بيرجع قبل ما
    // `progressCtx` يتعرف، فالشاشة تفضل مفتوحة ومابتتقفلش — ومفيهاش رجوع.
    await WidgetsBinding.instance.endOfFrame;

    // آخر حالة — تثبيت اتفتح، أو خطأ، أو إلغاء. `null` = القناة اتقفلت من غير ما تقول.
    final done = Completer<OtaEvent?>();
    StreamSubscription<OtaEvent>? sub;
    try {
      sub = ota
          .execute(url, destinationFilename: filename, sha256checksum: checksum)
          .listen((e) {
        if (e.status == OtaStatus.DOWNLOADING) {
          percent.value = int.tryParse(e.value ?? '');
        } else if (!done.isCompleted) {
          done.complete(e);
        }
      }, onDone: () {
        if (!done.isCompleted) done.complete(null);
      });
    } catch (e) {
      if (!done.isCompleted) done.complete(OtaEvent(OtaStatus.INTERNAL_ERROR, '$e'));
    }

    final result = await done.future;
    await sub?.cancel();
    final pc = progressCtx;
    if (pc != null && pc.mounted) Navigator.of(pc).pop();

    final String? error = switch (result?.status) {
      OtaStatus.INSTALLING || OtaStatus.INSTALLATION_DONE || OtaStatus.CANCELED => null,
      null => null,
      OtaStatus.CHECKSUM_ERROR => await _dropCorrupt(filename),
      OtaStatus.DOWNLOAD_ERROR => 'التنزيل وقف — اتأكد من النت وجرّب تاني.',
      OtaStatus.PERMISSION_NOT_GRANTED_ERROR =>
        'لازم تسمح بالتثبيت من التطبيق ده عشان التحديث يكمّل.',
      OtaStatus.ALREADY_RUNNING_ERROR => 'فيه تنزيل شغّال بالفعل — استنى يخلص.',
      _ => 'التحديث مانفعش: ${result?.value ?? ''}',
    };
    if (error == null) return;

    final c2 = navigatorKey.currentContext;
    if (c2 == null || !c2.mounted) return;
    final retry = await showDialog<bool>(
      context: c2,
      builder: (c) => AlertDialog(
        title: const Text('التحديث مانزلش'),
        content: Text(error),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إغلاق')),
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

  void _say(String text, {bool short = false}) {
    final ctx = navigatorKey.currentContext;
    if (ctx == null) return;
    final m = ScaffoldMessenger.maybeOf(ctx);
    if (m == null) return;
    m.hideCurrentSnackBar();
    m.showSnackBar(SnackBar(
      content: Text(text),
      duration: short ? const Duration(seconds: 2) : const Duration(seconds: 4),
    ));
  }
}
