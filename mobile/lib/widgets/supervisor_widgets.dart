import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../api/api_client.dart';
import '../theme.dart';
import '../utils/format.dart';
import 'session_drawer.dart';

enum PeriodPreset {
  today('اليوم', 'أمس'),
  yesterday('أمس', 'أول أمس'),
  week('الأسبوع', 'الأسبوع الماضي');

  const PeriodPreset(this.label, this.previousLabel);
  final String label;
  final String previousLabel;
}

class SupPeriod {
  final PeriodPreset preset;
  final DateTime from;
  final DateTime to;

  const SupPeriod._(this.preset, this.from, this.to);

  factory SupPeriod.of(PeriodPreset p, {DateTime? now}) {
    final n = now ?? DateTime.now();
    final today = DateTime(n.year, n.month, n.day);
    switch (p) {
      case PeriodPreset.today:
        return SupPeriod._(p, today, today);
      case PeriodPreset.yesterday:
        final y = today.subtract(const Duration(days: 1));
        return SupPeriod._(p, y, y);
      case PeriodPreset.week:
        final sinceSat = (today.weekday + 1) % 7;
        return SupPeriod._(p, today.subtract(Duration(days: sinceSat)), today);
    }
  }

  String get fromIso => isoDate(from);
  String get toIso => isoDate(to);

  int get _shiftDays => preset == PeriodPreset.week ? 7 : to.difference(from).inDays + 1;

  DateTime get previousFrom => from.subtract(Duration(days: _shiftDays));
  DateTime get previousTo => to.subtract(Duration(days: _shiftDays));

  String get previousFromIso => isoDate(previousFrom);
  String get previousToIso => isoDate(previousTo);

  String get key => '$fromIso|$toIso';

  String get rangeText =>
      from == to ? fmtDate(from) : 'من ${fmtDate(from)} إلى ${fmtDate(to)}';
}

class PeriodChips extends StatelessWidget {
  const PeriodChips({super.key, required this.period, required this.onChanged});

  final SupPeriod period;
  final ValueChanged<SupPeriod> onChanged;

  void _pick(PeriodPreset p) {
    if (p != period.preset) onChanged(SupPeriod.of(p));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              for (final p in PeriodPreset.values)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 8),
                  child: ChoiceChip(
                    label: Text(p.label),
                    selected: period.preset == p,
                    showCheckmark: false,
                    selectedColor: AppColors.primary,
                    labelStyle: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: period.preset == p ? Colors.white : AppColors.primary,
                    ),
                    backgroundColor: Colors.white,
                    side: BorderSide(color: AppColors.primary.withValues(alpha: 0.25)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                    onSelected: (_) => _pick(p),
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
          child: Row(
            children: [
              Icon(Icons.event_outlined, size: 16, color: Colors.grey.shade600),
              const SizedBox(width: 6),
              Text(period.rangeText,
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade700)),
            ],
          ),
        ),
      ],
    );
  }
}

bool isOfflineError(Object e) =>
    e is SocketException || e is TimeoutException || e is http.ClientException;

String friendlyError(Object e) {
  if (isOfflineError(e)) return 'لا يوجد اتصال بالخادم';
  if (e is ApiException) return e.message;
  return 'حدث خطأ: $e';
}

class OnlineErrorView extends StatelessWidget {
  const OnlineErrorView({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = isOfflineError(error);
    final expired = error is ApiException && (error as ApiException).statusCode == 401;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 48),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: (offline ? AppColors.accent : AppColors.danger).withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              offline ? Icons.wifi_off_rounded : Icons.error_outline,
              size: 44,
              color: offline ? AppColors.accent : AppColors.danger,
            ),
          ),
          const SizedBox(height: 16),
          Text(friendlyError(error),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(
            offline
                ? 'المتابعة تتطلب اتصالاً بالإنترنت — تأكد من الاتصال وحاول مرة أخرى.'
                : 'حاول مرة أخرى بعد قليل، وإذا استمرت المشكلة فتواصل مع الدعم.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13.5, color: Colors.grey.shade600),
          ),
          const SizedBox(height: 18),
          if (expired)
            FilledButton.icon(
              onPressed: () => forgetSession(context),
              icon: const Icon(Icons.login),
              label: const Text('سجّل الدخول'),
            )
          else
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('حاول مرة أخرى'),
            ),
        ],
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    this.sub,
    this.trend,
  });

  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  final Color color;
  final Widget? trend;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 20, color: color),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade700)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: AlignmentDirectional.centerStart,
              child: Text(value,
                  style: TextStyle(
                      fontSize: 22, fontWeight: FontWeight.w800, color: color)),
            ),
            if (sub != null) ...[
              const SizedBox(height: 2),
              Text(sub!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
            ],
            if (trend != null) ...[
              const SizedBox(height: 6),
              trend!,
            ],
          ],
        ),
      ),
    );
  }
}

class TrendBadge extends StatelessWidget {
  const TrendBadge({
    super.key,
    required this.current,
    required this.previous,
    this.previousLabel,
    this.higherIsBetter = true,
    this.compact = false,
  });

  final double current;
  final double previous;
  final String? previousLabel;
  final bool higherIsBetter;
  final bool compact;

  static const _up = Color(0xFF1E9E5A);
  static const _down = Color(0xFFD64545);

  @override
  Widget build(BuildContext context) {
    final diff = current - previous;
    final flat = diff.abs() < 0.005;
    final rising = diff > 0;
    final good = rising == higherIsBetter;
    final color = flat ? Colors.grey.shade600 : (good ? _up : _down);
    final icon = flat
        ? Icons.trending_flat
        : (rising ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded);
    String text;
    if (flat) {
      text = 'بلا تغيير';
    } else if (previous.abs() < 0.005) {
      text = '';
    } else {
      final pct = (diff / previous.abs() * 100).abs();
      final shown = pct >= 100 ? pct.toStringAsFixed(0) : pct.toStringAsFixed(1);
      text = '${shown.replaceFirst(RegExp(r'\.0$'), '')}%';
    }
    final badge = Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: compact ? 13 : 15, color: color),
          if (text.isNotEmpty) ...[
            const SizedBox(width: 2),
            Text(text,
                style: TextStyle(
                    fontSize: compact ? 11 : 12,
                    fontWeight: FontWeight.w800,
                    color: color)),
          ],
        ],
      ),
    );
    if (compact || previousLabel == null) return badge;
    return Row(
      children: [
        badge,
        const SizedBox(width: 6),
        Flexible(
          child: Text('${previousLabel!}: ${fmtMoney(previous)}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
        ),
      ],
    );
  }
}

class MiniStat extends StatelessWidget {
  const MiniStat(
      {super.key, required this.label, required this.value, this.color, this.trend});

  final String label;
  final String value;
  final Color? color;
  final Widget? trend;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 11.5, color: Colors.grey.shade600)),
        const SizedBox(height: 2),
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(value,
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: color ?? Colors.black87)),
        ),
        if (trend != null) ...[
          const SizedBox(height: 3),
          trend!,
        ],
      ],
    );
  }
}
