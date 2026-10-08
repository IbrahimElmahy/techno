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

class InstalledVersion {
  const InstalledVersion(this.name, this.rawCode);

  final String name;

  final int rawCode;

  int get code => rawCode % 1000;

  int get abiCode => rawCode ~/ 1000;

  String get label => '$name ($code)';
}

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

class _FetchError implements Exception {
  _FetchError(this.message);
  final String message;
}

enum _Phase { idle, fetching, dialog, downloading }

class AppUpdater with WidgetsBindingObserver {
  AppUpdater._();
  static final AppUpdater instance = AppUpdater._();

  static final navigatorKey = GlobalKey<NavigatorState>();

  static const _installer = MethodChannel('techno/installer');

  static const _snoozeCodeKey = 'app_update_snooze_code';
  static const _snoozeAtKey = 'app_update_snooze_ms';

  static const _snooze = Duration(hours: 6);

  static const _autoEvery = Duration(minutes: 30);

  static const _abiCodes = {'armeabi-v7a': 1, 'arm64-v8a': 2, 'x86_64': 4};

  final available = ValueNotifier<AppRelease?>(null);

  _Phase _phase = _Phase.idle;

  bool _manual = false;
  DateTime? _phaseSince;

  DateTime? _lastAutoCheck;

  Completer<void>? _resumeWaiter;
  bool _attached = false;

  static bool get supported => !kIsWeb && Platform.isAndroid;

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
    unawaited(check(resume: true));
  }

  Future<InstalledVersion> installed() async {
    final p = await PackageInfo.fromPlatform();
    return InstalledVersion(p.version, int.tryParse(p.buildNumber) ?? 0);
  }

  bool get _busy {
    if (_phase == _Phase.idle) return false;
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

  Future<void> check({bool manual = false, bool atStart = false, bool resume = false}) async {
    final tr = TaskTracker.instance;
    if (!supported) {
      if (manual) tr.finish(BgTask.update, 'التحديث من الخادم متاح على أندرويد فقط', error: true);
      return;
    }
    if (_busy) {
      if (manual && _phase == _Phase.fetching) {
        _manual = true;
        tr.update(BgTask.update, 'جارٍ البحث عن تحديث…');
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
      if (manual) tr.start(BgTask.update, 'جارٍ البحث عن تحديث…');
      final AppRelease latest;
      try {
        latest = await _fetch();
      } on _FetchError catch (e) {
        if (_manual) {
          tr.finish(BgTask.update, e.message,
              error: true, action: TaskAction('إعادة المحاولة', () => check(manual: true)));
        }
        return;
      }
      _lastAutoCheck = DateTime.now();
      final me = await installed();

      if (latest.code <= me.code) {
        available.value = null;
        if (_manual) tr.finish(BgTask.update, 'لديك أحدث نسخة (${me.label}) ✔');
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
        tr.update(BgTask.update, 'توجد نسخة جديدة (${latest.name})');
      }
      final later = await _offer(latest, me, manual: _manual);
      if (later) {
        await prefs.setInt(_snoozeCodeKey, latest.code);
        await prefs.setInt(_snoozeAtKey, now);
        if (_manual) {
          tr.finish(BgTask.update,
              'النسخة ${latest.name} متاحة — اضغط «تحديث التطبيق» من القائمة');
        }
      }
    } catch (e) {
      if (_manual || tr.isRunning(BgTask.update)) {
        tr.finish(BgTask.update, 'تعذر التحديث — أعد المحاولة',
            error: true, action: TaskAction('إعادة المحاولة', () => check(manual: true)));
      }
    } finally {
      _setPhase(_Phase.idle);
      if (tr.isRunning(BgTask.update)) tr.clear(BgTask.update);
    }
  }

  Future<AppRelease> _fetch() async {
    final base = await ApiClient.instance.baseUrl();
    final http.Response r;
    try {
      r = await http.get(
        Uri.parse('$base/api/v1/app-update/latest'),
        headers: const {'Cache-Control': 'no-cache'},
      ).timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw _FetchError('لم يستجب الخادم — أعد المحاولة بعد قليل');
    } catch (_) {
      throw _FetchError('لا يوجد اتصال بالإنترنت — أعد المحاولة عند توفره');
    }
    if (r.statusCode == 404) throw _FetchError('لا توجد نسخة منشورة على الخادم بعد');
    if (r.statusCode != 200) {
      throw _FetchError('أعاد الخادم خطأً (${r.statusCode}) — أعد المحاولة بعد قليل');
    }
    try {
      return AppRelease.fromJson(
          jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>);
    } catch (_) {
      throw _FetchError('رد الخادم غير مفهوم — تواصل مع الإدارة');
    }
  }

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

  Future<bool> _offer(AppRelease r, InstalledVersion me, {required bool manual}) async {
    final tr = TaskTracker.instance;
    final ctx = navigatorKey.currentContext;
    if (ctx == null) return false;

    final android = await DeviceInfoPlugin().androidInfo;
    final abi = _pickAbi(r, me, android.supportedAbis);
    if (abi == null) {
      if (manual || r.force) {
        tr.finish(BgTask.update,
            'توجد نسخة جديدة (${r.name}) لكنها غير منشورة لنوع هاتفك — تواصل مع الإدارة',
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
                    'لديك ${me.label}',
                    if (size != null) 'الحجم ${(size / (1024 * 1024)).toStringAsFixed(1)} ميجابايت',
                  ].join(' · '),
                  style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 13),
                ),
                if (pending.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF6E5),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      'لديك ${pending.entries.map((e) => '${e.value} ${e.key}').join(' · ')} '
                      'لم تُرفع بعد. لا يحذفها التحديث — تبقى على الجهاز — '
                      'ويُفضَّل تنفيذ «مزامنة» أولاً.',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                const Text(
                  'في المرة الأولى سيطلب أندرويد السماح بالتثبيت من هذا التطبيق — اسمح ثم عُد '
                  'واضغط «تثبيت».',
                  style: TextStyle(fontSize: 13),
                ),
              ],
            ),
          ),
          actions: [
            if (!r.force)
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('لاحقاً')),
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

  Future<bool> _canInstall() async {
    try {
      return await _installer.invokeMethod<bool>('canInstall') ?? true;
    } catch (_) {
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
            'يتطلب أندرويد السماح لهذا التطبيق بتثبيت تحديثاته.\n\n'
            'اضغط «افتح الإعدادات»، وفعّل «السماح من هذا المصدر»، ثم عُد إلى التطبيق — '
            'وسيكتمل التحديث تلقائياً.',
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
        _resumeWaiter = null;
        return true;
      }
      await back.future.timeout(const Duration(minutes: 10), onTimeout: () {});
      if (await _canInstall()) return true;
    }
  }

  Future<void> _download(AppRelease r, String abi) async {
    final tr = TaskTracker.instance;
    if (!await _ensureInstallPermission()) {
      tr.finish(BgTask.update, 'يتطلب التحديث السماح بالتثبيت من هذا التطبيق',
          error: true,
          action: TaskAction('افتح الإعدادات', () => unawaited(_openInstallSettings())));
      return;
    }

    final base = await ApiClient.instance.baseUrl();
    final url = '$base${r.urls[abi]}';
    final filename = (r.files[abi] ?? 'techno-${r.code}-$abi.apk').split('/').last;
    final checksum = r.sha256[abi];

    _setPhase(_Phase.downloading);
    final ota = OtaUpdate();
    final cancel = TaskAction('إلغاء', () => unawaited(ota.cancel()));
    tr.start(BgTask.update, 'جارٍ تنزيل التحديث ${r.name}…', action: cancel);

    final done = Completer<OtaEvent?>();
    StreamSubscription<OtaEvent>? sub;
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
              p == null ? 'جارٍ تنزيل التحديث ${r.name}…' : 'جارٍ تنزيل التحديث $p٪',
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

    final value = result?.value ?? '';
    final alreadyRunning = value.toLowerCase().contains('already running');
    final String? error = switch (result?.status) {
      OtaStatus.INSTALLING || OtaStatus.INSTALLATION_DONE || null => null,
      OtaStatus.CANCELED => null,
      OtaStatus.CHECKSUM_ERROR => await _dropCorrupt(filename),
      OtaStatus.DOWNLOAD_ERROR => 'توقف التنزيل — تأكد من الاتصال وأعد المحاولة.',
      OtaStatus.PERMISSION_NOT_GRANTED_ERROR =>
        'يجب السماح بالتثبيت من هذا التطبيق لإكمال التحديث.',
      OtaStatus.ALREADY_RUNNING_ERROR || OtaStatus.INSTALLATION_ERROR => alreadyRunning
          ? 'يوجد تنزيل جارٍ بالفعل — انتظر حتى ينتهي.'
          : 'تعذر التثبيت — أعد المحاولة.',
      _ => 'تعذر التحديث — أعد المحاولة.',
    };

    if (error == null) {
      if (result?.status == OtaStatus.CANCELED) {
        tr.finish(BgTask.update, 'أُلغي تنزيل التحديث — يمكنك بدؤه مرة أخرى من القائمة');
      } else {
        tr.finish(BgTask.update, 'جاهز للتثبيت — اضغط «تثبيت» في الشاشة الظاهرة ✔',
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
        title: const Text('تعذر تنزيل التحديث'),
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
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('إعادة المحاولة')),
        ],
      ),
    );
    if (retry == true) await _download(r, abi);
  }

  Future<String> _dropCorrupt(String filename) async {
    try {
      final dir = await getApplicationSupportDirectory();
      final f = File('${dir.path}/ota_update/$filename');
      if (await f.exists()) await f.delete();
    } catch (_) {}
    return 'نُزّل الملف ناقصاً أو معدّلاً فحُذف. أعد المحاولة.';
  }
}
