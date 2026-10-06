import 'package:intl/intl.dart' as intl;

/// تنسيق الأرقام والتواريخ للشاشات اللي بتقرا من السيرفر (متابعة المناديب).
///
/// **أرقام إنجليزي** زي باقي التطبيق والورق المطبوع، **وبفواصل الآلاف** — مبالغ المشرف
/// بتوصل لمئات الآلاف، و«250000.00» من غير فواصل بتتقرا غلط من أول نظرة.

final _money = intl.NumberFormat('#,##0.00', 'en_US');
final _plain = intl.NumberFormat('#,##0.###', 'en_US');

/// قيمة فلوس جاية من JSON — السيرفر بيبعتها نص («1234.50») عشان الكسور ماتتلخبطش.
double? parseMoney(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString().trim());
}

/// «12,345» أو «1,234.50» — الكسر بيبان بس لو فيه كسر فعلاً.
String fmtMoney(Object? v) {
  final d = parseMoney(v);
  if (d == null) return '—';
  final s = _money.format(d);
  return s.endsWith('.00') ? s.substring(0, s.length - 3) : s;
}

/// كمية: «3.000» ⇒ «3»، «2.500» ⇒ «2.5».
String fmtQty(Object? v) {
  final d = parseMoney(v);
  if (d == null) return '—';
  return _plain.format(d);
}

/// `YYYY-MM-DD` للسيرفر.
String isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

/// `2026/10/06` للعرض — نفس اللي باقي الشاشات بتعرضه.
String fmtDate(DateTime d) => intl.DateFormat('yyyy/MM/dd', 'en_US').format(d);

/// «10:22 ص».
String fmtTime(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final m = d.minute.toString().padLeft(2, '0');
  return '$h:$m ${d.hour < 12 ? 'ص' : 'م'}';
}

/// تاريخ/وقت من JSON — `null` لو فاضي أو مش مفهوم.
DateTime? parseDateTime(Object? v) {
  if (v == null) return null;
  final s = v.toString().trim();
  if (s.isEmpty) return null;
  return DateTime.tryParse(s);
}

/// «من ٥ دقايق» بالإنجليزي: «من 5 دقايق»، «من ساعتين»، «امبارح 10:22 م»…
String fmtRelative(DateTime? t, {DateTime? now}) {
  if (t == null) return 'مافيش نشاط';
  final n = now ?? DateTime.now();
  final diff = n.difference(t);
  if (diff.isNegative || diff.inMinutes < 1) return 'دلوقتي';
  if (diff.inMinutes < 60) {
    final m = diff.inMinutes;
    return m == 1 ? 'من دقيقة' : (m == 2 ? 'من دقيقتين' : 'من $m دقيقة');
  }
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(t.year, t.month, t.day);
  if (day == today) {
    final h = diff.inHours;
    return h == 1 ? 'من ساعة' : (h == 2 ? 'من ساعتين' : 'من $h ساعات');
  }
  final days = today.difference(day).inDays;
  if (days == 1) return 'امبارح ${fmtTime(t)}';
  if (days < 7) return 'من $days أيام';
  return fmtDate(t);
}
