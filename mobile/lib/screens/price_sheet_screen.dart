import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'sale_add_item_flow.dart';
import 'sale_invoice_screen.dart';

double _netOf(double gross, double pct) =>
    gross * (1 - pct.clamp(0, 99.99) / 100);

String _money(double v) => v.toStringAsFixed(2);

String _trim(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v
      .toStringAsFixed(2)
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
}

String _blank(double v) => v == 0 ? '' : _trim(v);

/// كشف التسعير — **نفس شاشة فاتورة البيع، من غير عميل ومن غير مديونية**.
///
/// المندوب بيسعّر بنفس الحركات اللي بيبيع بيها: يزوّد صنف من نفس المنتقي (فئة ⇐
/// صنف ⇐ كمية)، ويعدّل السعر والخصم في نفس الخانات، ويشوف الإجمالي في نفس المكان.
/// شاشة بشكل تاني كانت هتخلّيه يتعلّم واجهة تانية عشان يجاوب سؤال هو بيجاوبه كل يوم.
///
/// **واللي اتشال مقصود:**
///
/// * **العميل.** التسعير مش لطرف بعينه؛ ربطه بعميل بيخلّيه محتاج اختيار قبل ما
///   يبدأ، والمندوب بيتسأل عن السعر قبل ما يعرف مين اللي بيسأل أصلاً.
/// * **المديونية والحساب السابق.** دول أرقام مستند على طرف، ومافيش طرف هنا.
/// * **النقدي والآجل والكوبونات.** دي طرق سداد لفاتورة، والعرض مابيتسددش.
/// * **حد الكمية والرصيد.** الفاتورة بتمنع أكتر من اللي في العربية؛ العرض لأ —
///   التاجر بيسأل «٥٠٠ قطعة بكام» وهو عارف إنها مش معاك دلوقتي.
///
/// **وأثره صفر:** مافيش حركة مخزن ولا قيد ولا نقط ولا مديونية، ومافيش حاجة بتترفع
/// للسيرفر. العرض عايش في الشاشة وبيروح مع قفلها — تخزينه كان هيخلّيه يتلخبط مع
/// الفواتير في «فواتيري».
class PriceSheetScreen extends StatefulWidget {
  const PriceSheetScreen({super.key});

  @override
  State<PriceSheetScreen> createState() => _PriceSheetScreenState();
}

class _PriceSheetScreenState extends State<PriceSheetScreen> {
  final List<SaleDraftLine> _lines = [];
  final Map<int, TextEditingController> _qtyCtl = {};
  final Map<int, TextEditingController> _priceCtl = {};
  final Map<int, TextEditingController> _discCtl = {};

  /// كتالوج النظام كله — مش عهدة المندوب. ده الفرق اللي بيخلّي الشاشة تنفع:
  /// بيسعّر صنف مش معاه في العربية.
  List<SaleItem> _catalog = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [
      ..._qtyCtl.values,
      ..._priceCtl.values,
      ..._discCtl.values
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final items = await LocalDb.instance.catalogItems();
    if (!mounted) return;
    setState(() {
      _catalog = items;
      _loading = false;
    });
  }

  /// الإجمالي قبل أي خصم — مجموع (كمية × سعر).
  double get _gross => _lines.fold(0.0, (t, l) => t + l.gross);

  /// الخصم بالجنيه — **محسوب من الفرق مش من نسبة واحدة**. كل سطر ليه خصمه
  /// (ثابت الصنف + اللي المندوب زوّده)، فمافيش نسبة واحدة تعبّر عن العرض كله،
  /// والرقم اللي بيهمّ اللي بيقرا هو «وفّرت كام».
  double get _discount => _gross - _total;

  double get _total => _lines.fold(0.0, (t, l) => t + l.net);

  Future<void> _addItem() async {
    if (_catalog.isEmpty) {
      _say('مافيش أصناف على الجهاز — افتح «مزامنة البيانات» واعمل مزامنة.');
      return;
    }
    await SaleAddItemFlow.show(
      context,
      alreadyOnInvoice: {for (final l in _lines) l.itemId: l.quantity},
      // مافيش عميل ⇒ مافيش فئة ⇒ السعر الأساسي. المندوب بيعدّله بإيده لو حب.
      priceTier: null,
      source: _catalog,
      // **مافيش حد ومافيش عرض للرصيد.** الحد كان هيمنع تسعير صنف مش معاه، والرصيد
      // معلومة مضلّلة هنا: دي أصناف النظام مش عربيته، والرقم اللي هيشوفه مش بتاعه.
      capToAvailable: false,
      showAvailable: false,
      onAdd: (picked, qty) {
        final existing = _lines.indexWhere((l) => l.itemId == picked.itemId);
        setState(() {
          if (existing >= 0) {
            _lines[existing].quantity += qty;
            _qtyCtl[picked.itemId]?.text = _blank(_lines[existing].quantity);
          } else {
            _lines.add(SaleDraftLine(
              itemId: picked.itemId,
              itemName: picked.name,
              quantity: qty,
              unitPrice: picked.priceFor(null),
              fixedDiscountPct: picked.defaultDiscountPct,
              variableDiscountPct: 0,
            ));
          }
        });
      },
    );
  }

  void _removeLine(SaleDraftLine l) {
    setState(() {
      _lines.remove(l);
      _qtyCtl.remove(l.itemId)?.dispose();
      _priceCtl.remove(l.itemId)?.dispose();
      _discCtl.remove(l.itemId)?.dispose();
    });
  }

  void _say(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  /// يحوّل العرض لفاتورة بسطوره — التاجر قال «تمام هاتهم».
  ///
  /// **والفاتورة هي صاحبة الكلمة بعدها.** اختيار التاجر بيعيد تسعير السطور على
  /// فئته، والمتاح في العربية بيتفحص زي أي فاتورة، والحفظ بيمرّ على نفس الفحوص.
  /// الكشف بيوفّر إعادة الكتابة — مش بيتخطّى قاعدة.
  Future<void> _toInvoice() async {
    if (_lines.isEmpty) return;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تحويل لفاتورة'),
        content: Text('هتفتح فاتورة بيع بـ${_lines.length} صنف من العرض ده. '
            'هتختار التاجر هناك، والأسعار هتترجع لفئته، والمتاح في عربيتك هيتفحص.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('إلغاء')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('كمّل')),
        ],
      ),
    );
    if (go != true || !mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
          builder: (_) => SaleInvoiceScreen(initialLines: _lines)),
    );
  }

  /// نص جاهز يتبعت على واتساب — ده اللي المندوب بيعمله بالورقة.
  void _copy() {
    if (_lines.isEmpty) return;
    final body = _lines
        .map((l) =>
            '${l.itemName}  ${_trim(l.quantity)} × '
            '${_money(_netOf(l.unitPrice, l.discountPct))} = ${_money(l.net)} ج')
        .join('\n');
    Clipboard.setData(ClipboardData(
      // **بيقول إنه عرض سعر صراحةً.** ورقة فيها أصناف وكميات وإجمالي بتتقرا
      // فاتورة، والتاجر اللي فهمها كده بيطالب بيها.
      text: 'عرض سعر\n\n$body\n\nالإجمالي: ${_money(_total)} ج\n'
          '(عرض سعر — مش فاتورة، والأسعار قابلة للتغيير)',
    ));
    _say('اتنسخ عرض بـ${_lines.length} صنف');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('كشف تسعير'),
        actions: [
          IconButton(
            tooltip: 'انسخ العرض',
            icon: const Icon(Icons.copy_all_outlined),
            onPressed: _lines.isEmpty ? null : _copy,
          ),
          if (_lines.isNotEmpty)
            IconButton(
              tooltip: 'فضّي العرض',
              icon: const Icon(Icons.delete_sweep_outlined),
              onPressed: () => setState(() {
                _lines.clear();
                _qtyCtl.clear();
                _priceCtl.clear();
                _discCtl.clear();
              }),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading ? null : _addItem,
        icon: const Icon(Icons.add),
        label: const Text('زوّد صنف'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _hint(),
                Expanded(
                  child: _lines.isEmpty
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(28),
                            child: Text(
                              'دوس «زوّد صنف» وابدأ تسعّر.\n'
                              'تقدر تسعّر أي صنف في النظام — حتى لو مش معاك في العربية.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.black54),
                            ),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.only(bottom: 92),
                          // سطر زيادة في الآخر: كارت الإجماليات.
                          itemCount: _lines.length + 1,
                          itemBuilder: (_, i) =>
                              i < _lines.length ? _lineTile(i) : _totalsCard(),
                        ),
                ),
              ],
            ),
      bottomNavigationBar: _lines.isEmpty ? null : _totalBar(),
    );
  }

  Widget _hint() => Container(
        width: double.infinity,
        color: AppColors.primary.withValues(alpha: 0.06),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Text(
          'عرض سعر — مش فاتورة. مافيش عميل ولا مديونية ولا خصم من المخزن، '
          'ومافيش حد للكمية. ${_catalog.length} صنف متاح للتسعير.',
          style: const TextStyle(fontSize: 12.5, color: Colors.black54),
        ),
      );

  /// كارت الإجماليات في آخر الشيت — زي الفاتورة بالظبط.
  ///
  /// **والشريط اللاصق تحت مش بديل عنه.** الشريط بيوري رقم واحد وانت بتزوّد، وده
  /// اللي بيلزمك وانت بتشتغل. أما اللي بيراجع العرض قبل ما يبعته فبيقرا من تحت
  /// لفوق: إجمالي، خصم، صافي — والتفصيلة دي هي اللي بتخلّيه يقدر يقول للتاجر
  /// «وفّرتلك كذا» بدل رقم واحد مالوش سياق.
  Widget _totalsCard() => Card(
        margin: const EdgeInsets.fromLTRB(8, 10, 8, 8),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(
            children: [
              _totalRow('إجمالي الأصناف', _money(_gross)),
              if (_discount > 0.004) ...[
                const SizedBox(height: 6),
                _totalRow('الخصم', '- ${_money(_discount)}',
                    color: AppColors.danger),
              ],
              const Divider(height: 18),
              _totalRow('صافي العرض', _money(_total),
                  big: true, color: AppColors.primary),
              const SizedBox(height: 8),
              const Text(
                'عرض سعر — مش فاتورة. مافيش خصم من المخزن ولا مديونية على حد.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11.5, color: Colors.black45),
              ),
            ],
          ),
        ),
      );

  Widget _totalRow(String label, String value, {bool big = false, Color? color}) =>
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: big ? 15 : 14,
                  fontWeight: big ? FontWeight.w700 : FontWeight.w400,
                  color: big ? Colors.black87 : Colors.black54)),
          Text('$value ج.م',
              style: TextStyle(
                  fontSize: big ? 22 : 16,
                  fontWeight: FontWeight.w800,
                  color: color ?? Colors.black87)),
        ],
      );

  Widget _totalBar() => SafeArea(
        child: Material(
          color: AppColors.primary,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('${_lines.length} صنف',
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 12)),
                      Text('${_money(_total)} ج',
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 19)),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'انسخ العرض',
                  icon: const Icon(Icons.copy_all_outlined,
                      color: Colors.white, size: 22),
                  onPressed: _copy,
                ),
                const SizedBox(width: 4),
                // **التحويل لفاتورة هو الزرار الأساسي.** المندوب بيسعّر عشان يبيع،
                // والنسخ للواتساب هو الحالة التانية — فالأوضح بياخد المساحة.
                FilledButton.icon(
                  style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: AppColors.primary),
                  onPressed: _toInvoice,
                  icon: const Icon(Icons.receipt_long_outlined, size: 18),
                  label: const Text('حوّله لفاتورة'),
                ),
              ],
            ),
          ),
        ),
      );

  /// نفس كارت سطر الفاتورة — رقم السطر، الاسم، شارة الخصم الثابت، الصافي، وتحتهم
  /// الكمية والسعر والخصم. **من غير تحذير المتاح**: مافيش حد هنا.
  Widget _lineTile(int i) {
    final l = _lines[i];
    final ctl = _qtyCtl.putIfAbsent(
        l.itemId, () => TextEditingController(text: _blank(l.quantity)));
    return Card(
      key: ValueKey(l.itemId),
      margin: const EdgeInsets.fromLTRB(8, 4, 8, 0),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
        child: Column(
          children: [
            Row(
              children: [
                SizedBox(
                  width: 22,
                  child: Text('${i + 1}',
                      style:
                          const TextStyle(fontSize: 11, color: Colors.black38)),
                ),
                Expanded(
                  child: Text(l.itemName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 14)),
                ),
                if (l.fixedDiscountPct > 0) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.accent.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text('ثابت ${_trim(l.fixedDiscountPct)}%',
                        style: const TextStyle(
                            fontSize: 10, color: Colors.black87)),
                  ),
                ],
                const SizedBox(width: 6),
                Text('${_money(l.net)} ج.م',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                        color: AppColors.primary)),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                SizedBox(
                  width: 92,
                  child: _field(
                    label: 'كمية',
                    controller: ctl,
                    onChanged: (v) => setState(() => l.quantity = v),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _field(
                    label: 'السعر',
                    controller: _priceCtl.putIfAbsent(l.itemId,
                        () => TextEditingController(text: _blank(l.unitPrice))),
                    onChanged: (v) => setState(() => l.unitPrice = v),
                    // نفس قاعدة الفاتورة: الصنف اللي عليه خصم ثابت سعره سعر
                    // القايمة ومايتكتبش فوقه — وإلا بيبقى خصمين على بعض. والتفاوض
                    // بيفضل في مكان واحد: الخصم المتغيّر.
                    readOnly: l.fixedDiscountPct > 0,
                    netPrice: l.fixedDiscountPct > 0
                        ? _netOf(l.unitPrice, l.discountPct)
                        : null,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: _field(
                    label: 'خصم %',
                    controller: _discCtl.putIfAbsent(
                        l.itemId,
                        () => TextEditingController(
                            text: _blank(l.variableDiscountPct))),
                    onChanged: (v) => setState(() => l.variableDiscountPct = v),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline,
                      size: 20, color: AppColors.danger),
                  tooltip: 'حذف السطر',
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints.tightFor(width: 32, height: 36),
                  visualDensity: VisualDensity.compact,
                  onPressed: () => _removeLine(l),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _field({
    required String label,
    required TextEditingController controller,
    required void Function(double) onChanged,
    bool readOnly = false,
    double? netPrice,
  }) {
    // الخانة اللي بتوري الصافي مش خانة كتابة — بتترسم عرض من غير كنترولر، زي
    // الفاتورة بالظبط.
    if (netPrice != null) {
      return InputDecorator(
        decoration: InputDecoration(
          labelText: '$label (بعد الخصم)',
          isDense: true,
          border: const OutlineInputBorder(),
        ),
        child: Text(_money(netPrice),
            style: const TextStyle(fontWeight: FontWeight.w600)),
      );
    }
    return TextField(
      controller: controller,
      readOnly: readOnly,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      onChanged: (v) => onChanged(double.tryParse(v.trim()) ?? 0),
    );
  }
}
