import 'package:intl/intl.dart' as intl;

final _money = intl.NumberFormat('#,##0.00', 'en_US');
final _plain = intl.NumberFormat('#,##0.###', 'en_US');

double? parseMoney(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString().trim());
}

String fmtMoney(Object? v) {
  final d = parseMoney(v);
  if (d == null) return '—';
  final s = _money.format(d);
  return s.endsWith('.00') ? s.substring(0, s.length - 3) : s;
}

String fmtQty(Object? v) {
  final d = parseMoney(v);
  if (d == null) return '—';
  return _plain.format(d);
}

String isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

String fmtDate(DateTime d) => intl.DateFormat('yyyy/MM/dd', 'en_US').format(d);

String fmtTime(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final m = d.minute.toString().padLeft(2, '0');
  return '$h:$m ${d.hour < 12 ? 'ص' : 'م'}';
}

DateTime? parseDateTime(Object? v) {
  if (v == null) return null;
  final s = v.toString().trim();
  if (s.isEmpty) return null;
  return DateTime.tryParse(s);
}

String fmtRelative(DateTime? t, {DateTime? now}) {
  if (t == null) return 'لا يوجد نشاط';
  final n = now ?? DateTime.now();
  final diff = n.difference(t);
  if (diff.isNegative || diff.inMinutes < 1) return 'الآن';
  if (diff.inMinutes < 60) {
    final m = diff.inMinutes;
    return m == 1 ? 'منذ دقيقة' : (m == 2 ? 'منذ دقيقتين' : 'منذ $m دقيقة');
  }
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(t.year, t.month, t.day);
  if (day == today) {
    final h = diff.inHours;
    return h == 1 ? 'منذ ساعة' : (h == 2 ? 'منذ ساعتين' : 'منذ $h ساعات');
  }
  final days = today.difference(day).inDays;
  if (days == 1) return 'أمس ${fmtTime(t)}';
  if (days < 7) return 'منذ $days أيام';
  return fmtDate(t);
}
