/// **عهدة الكوبونات** — السريالات اللي المكتب سلّمها للمندوب ولسه ما اتصرفتش.
///
/// المكتب بيسلّم المندوب دفاتر بالفئة ومدى أرقامها (فضي 1001–1050). المندوب مايسلّمش
/// عميل سريال مش في عهدته: الكوبون ده ممكن يكون في إيد مندوب تاني، أو لسه في المكتب،
/// وساعة المرتجع مابيبقاش معروف اتصرف في بيعة مين.
///
/// السيرفر بيفحص نفس الحاجة عند الرفع ويرفض — بس الرفض ساعتها بيجي بعد ما الدفتر
/// اتسلّم والعميل مشي، والفاتورة بتقف في الطابور وتوقّف اللي وراها. فالنسخة دي بتقول
/// للمندوب وهو واقف عند العميل، من غير شبكة. **مش بديل عن السيرفر**: الكاش ممكن يكون
/// قديم، والسيرفر هو اللي عنده الحقيقة ساعة الترحيل.
///
/// **والمنع على الفئات اللي في `coupon_custody_kinds` بس.** فئة مالهاش عهدة بتمشي زي
/// ما كانت بالظبط، وسيرفر قديم مابيبعتش المفتاحين أصلاً ⇒ مافيش منع خالص (زي
/// الصناديق: «مش عارف» غير «مالوش»).
library;

import 'dart:convert';

import 'arabic_sort.dart';

/// مدى سريالات شامل الطرفين — أرقام صحيحة مش نصوص.
///
/// المقارنة بالنص كانت هتقول إن «999» بعد «1000»، والمدى ممكن يعدّي من خانات لخانات.
class SerialRange {
  const SerialRange(this.from, this.to);

  final int from;
  final int to;

  int get count => to - from + 1;

  String get label => from == to ? '$from' : '$from–$to';
}

/// صف كوبونات زي ما هو مكتوب — الفئة والطرفين نص خام من الخانات.
typedef CouponRowInput = ({String? kind, String from, String to});

/// فاتورة لسه على الجهاز حاجزة مدى من فئة — عشان الرسالة تقول هو فين.
class CouponHold {
  const CouponHold(this.range, this.customerName);

  final SerialRange range;
  final String customerName;
}

/// الفئة موحّدة للمقارنة — «ذهبى» و«ذهبي» نفس الدفتر، ومسافة زيادة مش فئة تانية.
///
/// نفس فكرة `_norm_kind` في السيرفر (`coupon_receipt_service.py`): الفئات جاية من
/// مصدرين ماتفقوش على الإملا، والمقارنة الحرفية بتقول «مش في عهدتك» على دفتر في إيده.
String kindKey(String? kind) =>
    bare(kind).split(RegExp(r'\s+')).where((w) => w.isNotEmpty).join(' ');

/// السريال رقم صحيح، أو `null` لو مش أرقام بس.
///
/// المسافات بتتشال والأرقام العربية بتتحوّل — المندوب بيكتب باللوحة اللي تحت إيده،
/// و«١٠٥٠» هو هو «1050».
int? parseSerial(String? text) {
  final s = asciiDigits(text ?? '').replaceAll(RegExp(r'\s+'), '');
  if (!RegExp(r'^\d+$').hasMatch(s)) return null;
  return int.tryParse(s);
}

/// بترتّب المدايات وتلزق المتلامس والمتداخل — «1–5» و«6–9» مدى واحد «1–9».
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

/// `a` ناقص `b` — بالمدايات مش سريال سريال.
///
/// المندوب ممكن يكتب «من 1 إلى 1000000» بغلطة صباع؛ الحساب سريال سريال كان هيعلّق
/// التليفون. بالمدايات الحساب على عدد المدايات بس مهما كبرت.
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

/// المشترك بين `a` و`b`.
List<SerialRange> intersectRanges(
        Iterable<SerialRange> a, Iterable<SerialRange> b) =>
    subtractRanges(a, subtractRanges(a, b));

int totalCount(Iterable<SerialRange> rs) => rs.fold(0, (t, r) => t + r.count);

/// «1001–1050، 2001–2010، 3001–3005، …» — أول [max] مدايات وبعدها «…».
///
/// عهدة متقطّعة ممكن تبقى عشرين حتة؛ السطر اللي تحت الصف لازم يفضل سطر.
String rangesLabel(List<SerialRange> rs, {int max = 3}) {
  final shown = rs.take(max).map((r) => r.label).join('، ');
  return rs.length > max ? '$shown، …' : shown;
}

/// «السريال 1051» أو «السريالات 1051–1053» — والمدايات الزيادة بتتلم في «…».
String _serials(List<SerialRange> rs) {
  final one = rs.length == 1 && rs.first.count == 1;
  return '${one ? 'السريال' : 'السريالات'} ${rangesLabel(rs, max: 2)}';
}

/// «الفضي» من «فضي» — ومن غير «الال» لو الفئة أصلاً بـ«ال».
String _theKind(String kind) => kind.startsWith('ال') ? kind : 'ال$kind';

/// عهدة المندوب من الكوبونات زي ما الجهاز شايفها دلوقتي.
class CouponCustody {
  CouponCustody._(this._names, this._custody, this._holds);

  /// سيرفر قديم، أو ما اتسحبتش لسه — مافيش منع.
  static final none = CouponCustody._({}, {}, {});

  /// الفئات اللي عليها منع: المفتاح الموحّد ← الاسم زي ما السيرفر قاله.
  final Map<String, String> _names;

  /// عهدته من السيرفر لكل فئة — قبل طرح الطابور.
  final Map<String, List<SerialRange>> _custody;

  /// اللي فواتير الطابور حاجزاه لكل فئة.
  final Map<String, List<CouponHold>> _holds;

  /// بتتبني من الكاش (`coupon_custody` في kv) وفواتير الطابور.
  ///
  /// [raw] = `{"custody": [...], "kinds": [...]}` زي ما اتخزّن وقت السحب.
  /// [queued] = صفوف `sale_invoice` اللي لسه ما اترفعتش (`customer_name`، `coupons`)
  /// — **من غير الفاتورة اللي بتتعدّل**: صفوفها القديمة مش حاجزة حاجة، اللي بيتكتب
  /// دلوقتي بياخد مكانها (نفس فكرة `availableForSaleAll(exceptInvoiceLocalId:)`).
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

    // اللي اتكتب على فواتير لسه على الجهاز: السيرفر لسه شايفه في العهدة (الفاتورة
    // ما وصلتلوش)، فلو ماتطرحش هنا المندوب يقدر يكتب نفس الدفتر على فاتورتين وهو من غير
    // شبكة، والتانية تترفض ساعة المزامنة بعد ما الدفتر اتسلّم.
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

  /// الجهاز عارف عهدة كوبونات أصلاً؟
  bool get known => _names.isNotEmpty;

  bool isEnforced(String? kind) => _names.containsKey(kindKey(kind));

  /// الفئات اللي عليها عهدة — بالاسم اللي السيرفر قاله، مرتبة أبجدياً.
  List<String> get kinds {
    final l = _names.values.toList();
    sortByName<String>(l, (k) => k);
    return l;
  }

  /// عهدته في الفئة دي كاملة من آخر سحب — قبل طرح الطابور.
  List<SerialRange> custodyOf(String? kind) =>
      _custody[kindKey(kind)] ?? const [];

  /// اللي فواتير الطابور حاجزاه من الفئة دي.
  List<CouponHold> holdsOf(String? kind) => _holds[kindKey(kind)] ?? const [];

  /// المتاح يتكتب دلوقتي = العهدة ناقص الطابور.
  List<SerialRange> availableOf(String? kind) =>
      subtractRanges(custodyOf(kind), holdsOf(kind).map((h) => h.range));

  /// السطر اللي تحت الصف: «عهدتك في الفضي: 1001–1050 (50)». `null` لفئة من غير منع.
  String? hintFor(String? kind) {
    if (!isEnforced(kind)) return null;
    final name = _names[kindKey(kind)]!;
    final free = availableOf(kind);
    if (free.isEmpty) return 'عهدتك في ${_theKind(name)} خلصت — مافيش سريالات متاحة';
    return 'عهدتك في ${_theKind(name)}: ${rangesLabel(free)} (${totalCount(free)})';
  }

  /// رسالة لكل صف (بنفس الترتيب)، أو `null` لو الصف سليم أو فئته مالهاش منع.
  ///
  /// [requireComplete] = وقت الحفظ: الصف اللي ناقصه طرف بيتقال. وهو بيكتب لأ — لسه
  /// بيكتب، والأحمر على نص رقم بيزعّق على حاجة مش غلط.
  ///
  /// الصفوف اللي قبل الصف في نفس الفاتورة بتتحسب عليه كمان: صفين فضي متداخلين في
  /// فاتورة واحدة = نفس الكوبون متسلّم مرتين.
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
      // العدد لوحده مايكفيش: من غير السريالات مايتعرفش أنهي دفتر خرج من عهدته.
      return requireComplete
          ? '${_theKind(name)} في عهدتك — لازم تكتب «من» و«إلى» للسريالات'
          : null;
    }
    final f = parseSerial(fromText);
    final t = parseSerial(toText);
    if (f == null || t == null) {
      return 'السريال «${f == null ? fromText : toText}» ($name) لازم يبقى أرقام بس';
    }
    if (t < f) return 'المدى $f–$t ($name) مقلوب — «من» لازم يبقى الأصغر';
    final want = [SerialRange(f, t)];

    final dup = intersectRanges(want, usedHere[key] ?? const []);
    usedHere.putIfAbsent(key, () => []).add(want.first);
    if (dup.isNotEmpty) {
      return '${_serials(dup)} ($name) مكتوبة في صف تاني في نفس الفاتورة';
    }
    final outside = subtractRanges(want, custodyOf(key));
    if (outside.isNotEmpty) return '${_serials(outside)} ($name) مش في عهدتك';
    for (final h in holdsOf(key)) {
      final held = intersectRanges(want, [h.range]);
      if (held.isEmpty) continue;
      final who = h.customerName.trim();
      final one = held.length == 1 && held.first.count == 1;
      return '${_serials(held)} ($name) ${one ? 'اتكتب' : 'اتكتبوا'} على فاتورة '
          '${who.isEmpty ? 'تانية' : '«$who»'} لسه على الجهاز';
    }
    return null;
  }
}
