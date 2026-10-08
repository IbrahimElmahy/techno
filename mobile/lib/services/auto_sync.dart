import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import 'app_updater.dart';
import 'task_progress.dart';

enum AutoSyncState { idle, running, done, failed }

class AutoSync extends ChangeNotifier {
  AutoSync._();
  static final AutoSync instance = AutoSync._();

  AutoSyncState state = AutoSyncState.idle;
  String? message;

  DateTime? _lastRun;

  Completer<void>? _inflight;

  bool get _running => _inflight != null;

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

  static const _cooldown = Duration(minutes: 10);

  Future<void> maybeRun({bool force = false}) async {
    if (_running) return;
    if (!force && _lastRun != null &&
        DateTime.now().difference(_lastRun!) < _cooldown) {
      return;
    }
    if (await LocalDb.instance.getKv('token') == null) return;
    if (!force && !await _online()) return;
    if (_running) return;
    await run(includeSales: false);
  }

  Future<void> run({bool includeSales = true}) async {
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
      final errors = <String>[];
      Future<int> step(String label, Future<int> Function(CountProgress p) f) async {
        show(label);
        try {
          return await f((done, total) => show(label, done, total));
        } on ApiException catch (e) {
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
      final invoices = includeSales
          ? await step('بيرفع الفواتير',
              (p) => ApiClient.instance.pushSaleInvoices(refreshStock: false, onProgress: p))
          : 0;
      final collected = await step(
          'بيرفع التحصيلات', (p) => ApiClient.instance.pushReceipts(onProgress: p));
      final permits = await step(
          'بيرفع أذون التحويل', (p) => ApiClient.instance.pushTransfers(onProgress: p));

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
      if (!failed) unawaited(AppUpdater.instance.check());
    } catch (e) {
      final m = _short(e);
      _set(AutoSyncState.failed, m);
      tr.finish(BgTask.sync, 'المزامنة مانفعتش: $m', error: true);
    } finally {
      _release();
    }
  }

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

    var items = 0;
    String? note;
    onBundle();
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
