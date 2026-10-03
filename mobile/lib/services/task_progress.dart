import 'dart:async';

import 'package:flutter/foundation.dart';

/// الشغل اللي بيبان في الشريط اللي تحت.
enum BgTask {
  /// تحديث التطبيق — البحث والتنزيل.
  update,

  /// المزامنة — «مزامنة الآن» والتلقائية.
  sync,

  /// «تحديث الأصناف والقوائم».
  lists,

  /// رفع من شاشة («فواتيري» · «تحصيلاتي»).
  upload,
}

/// زرار جنب الرسالة في الشريط («إلغاء» · «افتح الإعدادات»).
class TaskAction {
  const TaskAction(this.label, this.onTap);
  final String label;
  final VoidCallback onTap;
}

/// حالة شغلانة واحدة.
class TaskState {
  TaskState(this.kind, this.label);

  final BgTask kind;
  String label;

  /// من ٠ لـ١ لو معروف، `null` = شريط بيلف من غير نسبة.
  double? progress;
  bool running = true;
  bool error = false;
  TaskAction? action;
  Timer? _hide;
}

/// **شريط واحد تحت لكل الشغل اللي بيحصل في الخلفية** — التحديث والمزامنة والقوائم.
///
/// كل واحدة من التلاتة كانت بتقول نتيجتها بطريقة: رسالة صغيرة بتختفي، أو علامة فوق في
/// الرئيسية بس، أو ولا حاجة لحد ما تخلص بعد دقيقة. المندوب كان بيدوس ومايشوفش حاجة
/// بتحصل فيفتكر الزرار بايظ. دلوقتي أي شغلانة بتقول هي فين («بيرفع الفواتير ٣/٧»)
/// وخلصت على إيه، في نفس المكان، فوق أي شاشة.
///
/// الشريط نفسه في `widgets/task_progress_bar.dart` — متركّب مرة في `MaterialApp.builder`.
class TaskTracker extends ChangeNotifier {
  TaskTracker._();
  static final TaskTracker instance = TaskTracker._();

  /// بالترتيب — آخر واحدة بدأت في الآخر.
  final Map<BgTask, TaskState> _tasks = {};

  /// اللي يتعرض دلوقتي: آخر شغلانة شغّالة، ولو مافيش، آخر نتيجة لسه ماختفتش.
  TaskState? get current {
    TaskState? running;
    TaskState? finished;
    for (final t in _tasks.values) {
      if (t.running) {
        running = t;
      } else {
        finished = t;
      }
    }
    return running ?? finished;
  }

  bool isRunning(BgTask kind) => _tasks[kind]?.running ?? false;

  /// بداية شغلانة (أو بدايتها من جديد). بتطلع في الآخر عشان تبقى هي اللي باينة.
  void start(BgTask kind, String label, {double? progress, TaskAction? action}) {
    _tasks.remove(kind)?._hide?.cancel();
    _tasks[kind] = TaskState(kind, label)
      ..progress = progress
      ..action = action;
    notifyListeners();
  }

  /// خطوة جديدة في شغلانة شغّالة. لو مكانتش بدأت، بتبدأها.
  void update(BgTask kind, String label, {double? progress, TaskAction? action}) {
    final t = _tasks[kind];
    if (t == null || !t.running) {
      start(kind, label, progress: progress, action: action);
      return;
    }
    t
      ..label = label
      ..progress = progress
      ..action = action;
    notifyListeners();
  }

  /// النتيجة — بتفضل شوية وتختفي. الغلط بيفضل أطول: ده اللي محتاج يتقري.
  void finish(BgTask kind, String message,
      {bool error = false, Duration? hold, TaskAction? action}) {
    _tasks.remove(kind)?._hide?.cancel();
    final t = TaskState(kind, message)
      ..running = false
      ..error = error
      ..progress = null
      ..action = action;
    _tasks[kind] = t;
    t._hide = Timer(hold ?? Duration(seconds: error ? 10 : 4), () {
      if (identical(_tasks[kind], t)) {
        _tasks.remove(kind);
        notifyListeners();
      }
    });
    notifyListeners();
  }

  /// شيل الشغلانة من الشريط حتى لو لسه «شغّالة» — لما اللي بدأها خلص من غير نتيجة
  /// تتقال (المندوب قفل حوار التحديث مثلاً).
  void clear(BgTask kind) {
    final t = _tasks.remove(kind);
    if (t == null) return;
    t._hide?.cancel();
    notifyListeners();
  }

  /// قفل الرسالة بإيد المندوب (دوسة على الشريط). الشغّالة مابتتقفلش.
  void dismiss(BgTask kind) {
    final t = _tasks[kind];
    if (t == null || t.running) return;
    t._hide?.cancel();
    _tasks.remove(kind);
    notifyListeners();
  }
}
