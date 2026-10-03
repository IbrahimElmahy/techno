/// المبلغ بالحروف — «فقط ألف ومائتان وخمسون جنيه مصري وخمسون قرش لا غير».
///
/// نفس `frontend/src/utils/arabicNumberWords.ts` بالحرف — السند المكتوب بالحروف جنب
/// الرقم هو اللي بيصعّب تعديله بعد التوقيع.
library;

const _ones = [
  '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر',
  'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
];
const _tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const _hundreds = [
  '', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة',
  'ثمانمائة', 'تسعمائة',
];

/// (مفرد، مثنى، جمع) لكل مرتبة.
const _scales = [
  ['', '', ''],
  ['ألف', 'ألفان', 'آلاف'],
  ['مليون', 'مليونان', 'ملايين'],
  ['مليار', 'ملياران', 'مليارات'],
];

String _under1000(int n) {
  final parts = <String>[];
  final h = n ~/ 100;
  final rest = n % 100;
  if (h > 0) parts.add(_hundreds[h]);
  if (rest > 0) {
    if (rest < 20) {
      parts.add(_ones[rest]);
    } else {
      final unit = rest % 10;
      final ten = rest ~/ 10;
      parts.add(unit > 0 ? '${_ones[unit]} و${_tens[ten]}' : _tens[ten]);
    }
  }
  return parts.join(' و');
}

String _scaled(int count, int level) {
  final s = _scales[level];
  if (level == 0) return _under1000(count);
  if (count == 1) return s[0];
  if (count == 2) return s[1];
  if (count <= 10) return '${_under1000(count)} ${s[2]}';
  return '${_under1000(count)} ${s[0]}';
}

/// عدد صحيح بالحروف.
String integerToArabicWords(num value) {
  var n = value.abs().floor();
  if (n == 0) return 'صفر';
  final groups = <int>[];
  while (n > 0 && groups.length < _scales.length) {
    groups.add(n % 1000);
    n ~/= 1000;
  }
  final parts = <String>[];
  for (var level = groups.length - 1; level >= 0; level--) {
    if (groups[level] > 0) parts.add(_scaled(groups[level], level));
  }
  return parts.join(' و');
}

/// جملة «فقط … لا غير» اللي بتتكتب على السندات.
String amountToArabicWords(num amount, {String currency = 'جنيه مصري'}) {
  final v = amount.abs();
  final pounds = v.floor();
  final piastres = ((v - pounds) * 100).round();
  final parts = ['${integerToArabicWords(pounds)} $currency'];
  if (piastres > 0) parts.add('${integerToArabicWords(piastres)} قرش');
  return 'فقط ${parts.join(' و')} لا غير';
}
