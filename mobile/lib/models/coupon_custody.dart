library;

import 'dart:convert';

import 'arabic_sort.dart';

class SerialRange {
  const SerialRange(this.from, this.to);

  final int from;
  final int to;

  int get count => to - from + 1;

  String get label => from == to ? '$from' : '$from–$to';
}

typedef CouponRowInput = ({String? kind, String from, String to});

class CouponHold {
  const CouponHold(this.range, this.customerName);

  final SerialRange range;
  final String customerName;
}

String kindKey(String? kind) =>
    bare(kind).split(RegExp(r'\s+')).where((w) => w.isNotEmpty).join(' ');

int? parseSerial(String? text) {
  final s = asciiDigits(text ?? '').replaceAll(RegExp(r'\s+'), '');
  if (!RegExp(r'^\d+$').hasMatch(s)) return null;
  return int.tryParse(s);
}

List<SerialRange> mergeRanges(Iterable<SerialRange> ranges) {
  final l = ranges.toList()..sort((a, b) => a.from.compareTo(b.from));
  final out = <SerialRange>[];
  for (final r in l) {
    if (out.isNotEmpty && r.from <= out.last.to + 1) {
      if (r.to > out.last.to) out[out.length - 1] = SerialRange(out.last.from, r.to);
    } else {
      out.add(r);
    }
  }
  return out;
}

List<SerialRange> subtractRanges(
    Iterable<SerialRange> a, Iterable<SerialRange> b) {
  var cur = mergeRanges(a);
  for (final cut in mergeRanges(b)) {
    final next = <SerialRange>[];
    for (final r in cur) {
      if (cut.to < r.from || cut.from > r.to) {
        next.add(r);
        continue;
      }
      if (cut.from > r.from) next.add(SerialRange(r.from, cut.from - 1));
      if (cut.to < r.to) next.add(SerialRange(cut.to + 1, r.to));
    }
    cur = next;
  }
  return cur;
}

List<SerialRange> intersectRanges(
        Iterable<SerialRange> a, Iterable<SerialRange> b) =>
    subtractRanges(a, subtractRanges(a, b));

int totalCount(Iterable<SerialRange> rs) => rs.fold(0, (t, r) => t + r.count);

String rangesLabel(List<SerialRange> rs, {int max = 3}) {
  final shown = rs.take(max).map((r) => r.label).join('، ');
  return rs.length > max ? '$shown، …' : shown;
}

String _serials(List<SerialRange> rs) {
  final one = rs.length == 1 && rs.first.count == 1;
  return '${one ? 'السريال' : 'السريالات'} ${rangesLabel(rs, max: 2)}';
}

String _theKind(String kind) => kind.startsWith('ال') ? kind : 'ال$kind';

class CouponCustody {
  CouponCustody._(this._names, this._custody, this._holds);

  static final none = CouponCustody._({}, {}, {});

  final Map<String, String> _names;

  final Map<String, List<SerialRange>> _custody;

  final Map<String, List<CouponHold>> _holds;

  factory CouponCustody.build(String? raw, List<Map<String, Object?>> queued) {
    if (raw == null || raw.trim().isEmpty) return none;
    Map<String, dynamic> body;
    try {
      body = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return none;
    }
    final names = <String, String>{};
    for (final k in (body['kinds'] as List? ?? const [])) {
      final key = kindKey('$k');
      if (key.isNotEmpty) names[key] = '$k'.trim();
    }
    if (names.isEmpty) return none;

    final custody = <String, List<SerialRange>>{};
    for (final e in (body['custody'] as List? ?? const [])) {
      if (e is! Map) continue;
      final key = kindKey('${e['kind'] ?? ''}');
      if (key.isEmpty) continue;
      final rs = custody.putIfAbsent(key, () => []);
      for (final pair in (e['ranges'] as List? ?? const [])) {
        if (pair is! List || pair.length < 2) continue;
        final f = parseSerial('${pair[0]}');
        final t = parseSerial('${pair[1]}');
        if (f == null || t == null || t < f) continue;
        rs.add(SerialRange(f, t));
      }
    }
    for (final k in custody.keys.toList()) {
      custody[k] = mergeRanges(custody[k]!);
    }

    final holds = <String, List<CouponHold>>{};
    for (final inv in queued) {
      final rawRows = inv['coupons'] as String?;
      if (rawRows == null || rawRows.trim().isEmpty) continue;
      List rows;
      try {
        rows = jsonDecode(rawRows) as List;
      } catch (_) {
        continue;
      }
      for (final c in rows) {
        if (c is! Map) continue;
        final key = kindKey(c['coupon_kind'] as String?);
        if (!names.containsKey(key)) continue;
        final f = parseSerial('${c['serial_from'] ?? ''}');
        final t = parseSerial('${c['serial_to'] ?? ''}');
        if (f == null || t == null || t < f) continue;
        holds.putIfAbsent(key, () => []).add(CouponHold(
            SerialRange(f, t), (inv['customer_name'] as String?) ?? ''));
      }
    }
    return CouponCustody._(names, custody, holds);
  }

  bool get known => _names.isNotEmpty;

  bool isEnforced(String? kind) => _names.containsKey(kindKey(kind));

  List<String> get kinds {
    final l = _names.values.toList();
    sortByName<String>(l, (k) => k);
    return l;
  }

  List<SerialRange> custodyOf(String? kind) =>
      _custody[kindKey(kind)] ?? const [];

  List<CouponHold> holdsOf(String? kind) => _holds[kindKey(kind)] ?? const [];

  List<SerialRange> availableOf(String? kind) =>
      subtractRanges(custodyOf(kind), holdsOf(kind).map((h) => h.range));

  String? hintFor(String? kind) {
    if (!isEnforced(kind)) return null;
    final name = _names[kindKey(kind)]!;
    final free = availableOf(kind);
    if (free.isEmpty) return 'نفدت عهدتك من ${_theKind(name)} — لا توجد سريالات متاحة';
    return 'عهدتك في ${_theKind(name)}: ${rangesLabel(free)} (${totalCount(free)})';
  }

  List<String?> check(List<CouponRowInput> rows, {bool requireComplete = false}) {
    final usedHere = <String, List<SerialRange>>{};
    return [
      for (final r in rows) _checkRow(r, usedHere, requireComplete),
    ];
  }

  String? _checkRow(CouponRowInput r, Map<String, List<SerialRange>> usedHere,
      bool requireComplete) {
    final key = kindKey(r.kind);
    if (!_names.containsKey(key)) return null;
    final name = (r.kind ?? '').trim();
    final fromText = r.from.trim();
    final toText = r.to.trim();
    if (fromText.isEmpty || toText.isEmpty) {
      return requireComplete
          ? '${_theKind(name)} في عهدتك — يجب كتابة «من» و«إلى» للسريالات'
          : null;
    }
    final f = parseSerial(fromText);
    final t = parseSerial(toText);
    if (f == null || t == null) {
      return 'السريال «${f == null ? fromText : toText}» ($name) يجب أن يكون أرقاماً فقط';
    }
    if (t < f) return 'المدى $f–$t ($name) معكوس — يجب أن تكون «من» هي الأصغر';
    final want = [SerialRange(f, t)];

    final dup = intersectRanges(want, usedHere[key] ?? const []);
    usedHere.putIfAbsent(key, () => []).add(want.first);
    if (dup.isNotEmpty) {
      return '${_serials(dup)} ($name) مكتوبة في صف آخر في الفاتورة نفسها';
    }
    final outside = subtractRanges(want, custodyOf(key));
    if (outside.isNotEmpty) return '${_serials(outside)} ($name) ليست في عهدتك';
    for (final h in holdsOf(key)) {
      final held = intersectRanges(want, [h.range]);
      if (held.isEmpty) continue;
      final who = h.customerName.trim();
      final one = held.length == 1 && held.first.count == 1;
      return '${_serials(held)} ($name) ${one ? 'مكتوب' : 'مكتوبة'} على فاتورة '
          '${who.isEmpty ? 'أخرى' : '«$who»'} ما زالت على الجهاز';
    }
    return null;
  }
}
