library;

const _from = 'أإآٱؤئىة';
const _to = 'ااااوييه';

final _strip = RegExp('[ـً-ْٰ]');

const _digitsFrom = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
const _digitsTo = '01234567890123456789';

String asciiDigits(String text) {
  final b = StringBuffer();
  for (final ch in text.split('')) {
    final d = _digitsFrom.indexOf(ch);
    b.write(d >= 0 ? _digitsTo[d] : ch);
  }
  return b.toString();
}

String bare(String? text) {
  final s = (text ?? '').trim().toLowerCase().replaceAll(_strip, '');
  final b = StringBuffer();
  for (final ch in s.split('')) {
    final i = _from.indexOf(ch);
    if (i >= 0) {
      b.write(_to[i]);
      continue;
    }
    final d = _digitsFrom.indexOf(ch);
    b.write(d >= 0 ? _digitsTo[d] : ch);
  }
  return b.toString();
}

int compareArabic(String? a, String? b) => bare(a).compareTo(bare(b));

void sortByName<T>(List<T> rows, String? Function(T) name) {
  rows.sort((x, y) => compareArabic(name(x), name(y)));
}
