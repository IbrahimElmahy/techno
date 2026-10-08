import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../api/api_client.dart';
import '../theme.dart';
import '../utils/format.dart';
import 'session_drawer.dart';

enum PeriodPreset {
  today('اليوم'),
  yesterday('أمس'),
  week('الأسبوع'),
  month('الشهر'),
  custom('فترة');

  const PeriodPreset(this.label);
  final String label;
}

class SupPeriod {
  final PeriodPreset preset;
  final DateTime from;
  final DateTime to;

  const SupPeriod._(this.preset, this.from, this.to);

  factory SupPeriod.of(PeriodPreset p, {DateTimeRange? range, DateTime? now}) {
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
      case PeriodPreset.month:
        return SupPeriod._(p, DateTime(today.year, today.month, 1), today);
      case PeriodPreset.custom:
        final r = range ?? DateTimeRange(start: today, end: today);
        return SupPeriod._(p, DateTime(r.start.year, r.start.month, r.start.day),
            DateTime(r.end.year, r.end.month, r.end.day));
    }
  }

  String get fromIso => isoDate(from);
  String get toIso => isoDate(to);

  String get key => '$fromIso|$toIso';

  String get rangeText =>
      from == to ? fmtDate(from) : 'من ${fmtDate(from)} إلى ${fmtDate(to)}';
}

class PeriodChips extends StatelessWidget {
  const PeriodChips({super.key, required this.period, required this.onChanged});

  final SupPeriod period;
  final ValueChanged<SupPeriod> onChanged;

  Future<void> _pick(BuildContext context, PeriodPreset p) async {
    if (p != PeriodPreset.custom) {
      if (p != period.preset) onChanged(SupPeriod.of(p));
      return;
    }
    final now = DateTime.now();
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(now.year, now.month, now.day),
      initialDateRange: DateTimeRange(start: period.from, end: period.to),
      helpText: 'اختر الفترة',
      saveText: 'تم',
    );
    if (r != null) onChanged(SupPeriod.of(PeriodPreset.custom, range: r));
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
                    avatar: p == PeriodPreset.custom
                        ? const Icon(Icons.date_range_outlined, size: 18)
                        : null,
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
                    onSelected: (_) => _pick(context, p),
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
  });

  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  final Color color;

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
          ],
        ),
      ),
    );
  }
}

class MiniStat extends StatelessWidget {
  const MiniStat({super.key, required this.label, required this.value, this.color});

  final String label;
  final String value;
  final Color? color;

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
      ],
    );
  }
}
