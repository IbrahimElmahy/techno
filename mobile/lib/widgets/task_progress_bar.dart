import 'package:flutter/material.dart';

import '../services/task_progress.dart';
import '../theme.dart';

class TaskBarHost extends StatelessWidget {
  const TaskBarHost({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: TaskTracker.instance,
      builder: (context, _) {
        final mq = MediaQuery.of(context);
        final task = TaskTracker.instance.current;
        final show = task != null && mq.viewInsets.bottom == 0;
        return Column(
          children: [
            Expanded(
              child: MediaQuery(
                data: show ? mq.removePadding(removeBottom: true) : mq,
                child: child,
              ),
            ),
            if (show) _TaskBar(task: task, bottomInset: mq.padding.bottom),
          ],
        );
      },
    );
  }
}

class _TaskBar extends StatelessWidget {
  const _TaskBar({required this.task, required this.bottomInset});
  final TaskState task;
  final double bottomInset;

  @override
  Widget build(BuildContext context) {
    final running = task.running;
    final error = task.error;
    final fg = running
        ? AppColors.primary
        : error
            ? AppColors.danger
            : AppColors.success;
    final bg = running
        ? const Color(0xFFE8F1FB)
        : error
            ? const Color(0xFFFDECEA)
            : const Color(0xFFE9F7EF);

    return Material(
      color: bg,
      elevation: 8,
      child: InkWell(
        onTap: running ? null : () => TaskTracker.instance.dismiss(task.kind),
        child: Padding(
          padding: EdgeInsets.only(bottom: bottomInset),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (running)
                LinearProgressIndicator(
                  value: task.progress,
                  minHeight: 3,
                  color: fg,
                  backgroundColor: fg.withValues(alpha: 0.15),
                )
              else
                Container(height: 3, color: fg),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
                child: Row(
                  children: [
                    if (running)
                      SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: fg),
                      )
                    else
                      Icon(error ? Icons.error_outline : Icons.check_circle_outline,
                          size: 20, color: fg),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        task.label,
                        maxLines: error ? 4 : 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w600, color: fg),
                      ),
                    ),
                    if (task.action != null)
                      TextButton(
                        onPressed: task.action!.onTap,
                        style: TextButton.styleFrom(
                          foregroundColor: fg,
                          visualDensity: VisualDensity.compact,
                        ),
                        child: Text(task.action!.label,
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                      )
                    else if (!running)
                      Icon(Icons.close, size: 18, color: fg.withValues(alpha: 0.7)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
