library;

const double kMaxDiscountPct = 99.99;

double _pct(double? v) {
  final n = v ?? 0;
  if (!n.isFinite || n <= 0) return 0;
  return n > 100 ? 100 : n;
}

double _round2(double n) => (n * 100).roundToDouble() / 100;

double combineDiscounts(List<double?> percentages) {
  var remaining = 1.0;
  for (final p in percentages) {
    remaining *= (1 - _pct(p) / 100);
  }
  final pct = _round2(100 * (1 - remaining));
  return pct > kMaxDiscountPct ? kMaxDiscountPct : pct;
}

double applyDiscounts(double amount, List<double?> percentages) =>
    amount * (1 - combineDiscounts(percentages) / 100);

double netOf(double amount, double? percentage) =>
    amount * (1 - _pct(percentage) / 100);
