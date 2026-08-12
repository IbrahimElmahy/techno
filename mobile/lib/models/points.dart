/// عرض النقاط والكميات — مكان واحد.
///
/// Ten of the thirty-two inspection item types are worth LESS than a point each: «قطعه لحام اخضر
/// او معزول 20"» is 0.25, the 25"/32" one is 0.5. Anything that renders those with `toInt()` shows
/// them as **0 نقطة**, so the rep picking an item is told it is worth nothing — which is what
/// «نقاط المعاينات مش موجودة» meant.
///
/// A whole number still reads as a whole number: 2.0 is «2», not «2.0». Only the fraction that is
/// actually there survives.
///
/// Lives here rather than in a screen because three screens were each carrying their own copy —
/// two identical and one that truncated.
String points(double value) =>
    value == value.roundToDouble() ? value.toInt().toString() : value.toString();
