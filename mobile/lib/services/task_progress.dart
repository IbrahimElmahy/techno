import 'dart:async';

import 'package:flutter/foundation.dart';

enum BgTask {
  update,

  sync,

  lists,

  upload,
}

class TaskAction {
  const TaskAction(this.label, this.onTap);
  final String label;
  final VoidCallback onTap;
}

class TaskState {
  TaskState(this.kind, this.label);

  final BgTask kind;
  String label;

  double? progress;
  bool running = true;
  bool error = false;
  TaskAction? action;
  Timer? _hide;
}

class TaskTracker extends ChangeNotifier {
  TaskTracker._();
  static final TaskTracker instance = TaskTracker._();

  final Map<BgTask, TaskState> _tasks = {};

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

  void start(BgTask kind, String label, {double? progress, TaskAction? action}) {
    _tasks.remove(kind)?._hide?.cancel();
    _tasks[kind] = TaskState(kind, label)
      ..progress = progress
      ..action = action;
    notifyListeners();
  }

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

  void clear(BgTask kind) {
    final t = _tasks.remove(kind);
    if (t == null) return;
    t._hide?.cancel();
    notifyListeners();
  }

  void dismiss(BgTask kind) {
    final t = _tasks[kind];
    if (t == null || t.running) return;
    t._hide?.cancel();
    _tasks.remove(kind);
    notifyListeners();
  }
}
