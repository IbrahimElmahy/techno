import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'sale_add_item_flow.dart';
import 'sale_invoice_screen.dart';

double _netOf(double gross, double pct) =>
    gross * (1 - pct.clamp(0, 99.99) / 100);

String _money(double v) => v.toStringAsFixed(2);

String _unitPrice(double v) =>
    v.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');

String _trim(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v
      .toStringAsFixed(2)
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
}

String _blank(double v) => v == 0 ? '' : _trim(v);

class PriceSheetScreen extends StatefulWidget {
  const PriceSheetScreen({super.key, this.existingLocalId});

  final int? existingLocalId;

  @override
  State<PriceSheetScreen> createState() => _PriceSheetScreenState();
}

class _PriceSheetScreenState extends State<PriceSheetScreen> {
  final List<SaleDraftLine> _lines = [];
  final Map<int, TextEditingController> _qtyCtl = {};
  final Map<int, TextEditingController> _priceCtl = {};
  final Map<int, TextEditingController> _discCtl = {};
  final _titleCtl = TextEditingController();

  int? _localId;
  bool _saving = false;

  bool _dirty = false;

  List<SaleItem> _catalog = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _localId = widget.existingLocalId;
    _load();
  }

  @override
  void dispose() {
    for (final c in [
      ..._qtyCtl.values,
      ..._priceCtl.values,
      ..._discCtl.values,
      _titleCtl,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      await ApiClient.instance
          .refreshPriceSheetHidden(timeout: const Duration(seconds: 4));
    } catch (_) {}
    final hidden = await LocalDb.instance.priceSheetHiddenCategories();
    final items = [
      for (final it in await LocalDb.instance.catalogItems())
        if (!hidden.contains(it.category?.trim() ?? '')) it
    ];
    final head = _localId == null
        ? null
        : await LocalDb.instance.priceSheet(_localId!);
    final saved = _localId == null
        ? const <SaleDraftLine>[]
        : await LocalDb.instance.priceSheetLines(_localId!);
    if (!mounted) return;
    setState(() {
      _catalog = items;
      if (head != null) {
        _titleCtl.text = (head['title'] as String?) ?? '';
        _lines
          ..clear()
          ..addAll(saved);
      }
      _loading = false;
    });
  }

  String get _title {
    final typed = _titleCtl.text.trim();
    if (typed.isNotEmpty) return typed;
    if (_lines.isEmpty) return 'عرض سعر';
    final first = _lines.first.itemName;
    return _lines.length == 1
        ? first
        : '$first و${_lines.length - 1} غيره';
  }

  Future<void> _save() async {
    if (_lines.isEmpty) {
      _say('لا توجد أصناف للحفظ.');
      return;
    }
    setState(() => _saving = true);
    try {
      final date = DateTime.now().toIso8601String().substring(0, 10);
      if (_localId == null) {
        _localId = await LocalDb.instance.savePriceSheet(
          title: _title, sheetDate: date, total: _total, lines: _lines);
      } else {
        await LocalDb.instance.updatePriceSheet(
          localId: _localId!, title: _title, sheetDate: date,
          total: _total, lines: _lines);
      }
      if (!mounted) return;
      setState(() => _dirty = false);
      _say('تم حفظ «$_title»');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<bool> _confirmLeave() async {
    if (!_dirty || _lines.isEmpty) return true;
    final leave = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('مغادرة الشيت؟'),
        content: Text(_localId == null
            ? 'يوجد ${_lines.length} صنف غير محفوظ وسيُفقد.'
            : 'يوجد تعديل غير محفوظ على «$_title» وسيُفقد.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('متابعة')),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx, true);
              await _save();
            },
            child: const Text('حفظ وخروج'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('خروج دون حفظ'),
          ),
        ],
      ),
    );
    return leave ?? false;
  }

  double get _gross => _lines.fold(0.0, (t, l) => t + l.gross);

  double get _discount => _gross - _total;

  double get _total => _lines.fold(0.0, (t, l) => t + l.net);

  Future<void> _addItem() async {
    if (_catalog.isEmpty) {
      _say('لا توجد أصناف على الجهاز — نفّذ «مزامنة البيانات».');
      return;
    }
    await SaleAddItemFlow.show(
      context,
      alreadyOnInvoice: {for (final l in _lines) l.itemId: l.quantity},
      priceTier: null,
      source: _catalog,
      capToAvailable: false,
      showAvailable: false,
      showNetPrice: false,
      onAdd: (picked, qty) {
        final existing = _lines.indexWhere((l) => l.itemId == picked.itemId);
        _edit(() {
          if (existing >= 0) {
            _lines[existing].quantity += qty;
            _qtyCtl[picked.itemId]?.text = _blank(_lines[existing].quantity);
          } else {
            _lines.add(SaleDraftLine(
              itemId: picked.itemId,
              itemName: picked.name,
              quantity: qty,
              unitPrice: picked.priceFor(null),
              fixedDiscountPct: 0,
              variableDiscountPct: 0,
            ));
          }
        });
      },
    );
  }

  void _removeLine(SaleDraftLine l) {
    _edit(() {
      _lines.remove(l);
      _qtyCtl.remove(l.itemId)?.dispose();
      _priceCtl.remove(l.itemId)?.dispose();
      _discCtl.remove(l.itemId)?.dispose();
    });
  }

  void _say(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _toInvoice() async {
    if (_lines.isEmpty) return;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تحويل إلى فاتورة'),
        content: Text('ستُفتح فاتورة بيع بـ${_lines.length} صنف من هذا العرض. '
            'ستختار التاجر هناك، وستُعاد الأسعار حسب فئته، وسيُتحقق من المتاح في سيارتك.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('إلغاء')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('متابعة')),
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

  void _copy() {
    if (_lines.isEmpty) return;
    final body = _lines
        .map((l) =>
            '${l.itemName}  ${_trim(l.quantity)} × '
            '${_money(_netOf(l.unitPrice, l.discountPct))} = ${_money(l.net)} ج')
        .join('\n');
    Clipboard.setData(ClipboardData(
      text: 'عرض سعر\n\n$body\n\nالإجمالي: ${_money(_total)} ج\n'
          '(عرض سعر — ليس فاتورة، والأسعار قابلة للتغيير)',
    ));
    _say('تم نسخ عرض بـ${_lines.length} صنف');
  }

  void _edit(VoidCallback change) {
    setState(() {
      change();
      _dirty = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_dirty || _lines.isEmpty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final nav = Navigator.of(context);
        if (await _confirmLeave()) nav.pop(true);
      },
      child: _scaffold(),
    );
  }

  Widget _scaffold() {
    return Scaffold(
      appBar: AppBar(
        title: Text(_localId == null ? 'كشف تسعير' : 'تعديل شيت'),
        actions: [
          IconButton(
            tooltip: _localId == null ? 'حفظ الشيت' : 'حفظ التعديل',
            icon: _saving
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Icon(_dirty ? Icons.save : Icons.save_outlined),
            onPressed: _lines.isEmpty || _saving ? null : _save,
          ),
          IconButton(
            tooltip: 'نسخ العرض',
            icon: const Icon(Icons.copy_all_outlined),
            onPressed: _lines.isEmpty ? null : _copy,
          ),
          if (_lines.isNotEmpty)
            IconButton(
              tooltip: 'تفريغ العرض',
              icon: const Icon(Icons.delete_sweep_outlined),
              onPressed: () => _edit(() {
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
        label: const Text('إضافة صنف'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _titleField(),
                Expanded(
                  child: _lines.isEmpty
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(28),
                            child: Text(
                              'لم تُضف أصناف بعد.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.black54),
                            ),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.only(bottom: 92),
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

  Widget _titleField() => Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 2),
        child: TextField(
          controller: _titleCtl,
          textInputAction: TextInputAction.done,
          onChanged: (_) => setState(() => _dirty = true),
          decoration: InputDecoration(
            labelText: 'اسم الشيت (اختياري)',
            hintText: _lines.isEmpty ? 'مثلاً: مخزن العبور' : _title,
            prefixIcon: const Icon(Icons.label_outline),
            isDense: true,
            border: const OutlineInputBorder(),
          ),
        ),
      );

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
          Text('$value',
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
                  tooltip: 'نسخ العرض',
                  icon: const Icon(Icons.copy_all_outlined,
                      color: Colors.white, size: 22),
                  onPressed: _copy,
                ),
                const SizedBox(width: 4),
                FilledButton.icon(
                  style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: AppColors.primary),
                  onPressed: _toInvoice,
                  icon: const Icon(Icons.receipt_long_outlined, size: 18),
                  label: const Text('تحويل إلى فاتورة'),
                ),
              ],
            ),
          ),
        ),
      );

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
                Text('${_money(l.net)}',
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
                    onChanged: (v) => _edit(() => l.quantity = v),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _field(
                    label: 'السعر',
                    controller: _priceCtl.putIfAbsent(l.itemId,
                        () => TextEditingController(text: _blank(l.unitPrice))),
                    onChanged: (v) => _edit(() => l.unitPrice = v),
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
                    onChanged: (v) => _edit(() => l.variableDiscountPct = v),
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
    if (netPrice != null) {
      return InputDecorator(
        decoration: InputDecoration(
          labelText: '$label (بعد الخصم)',
          isDense: true,
          border: const OutlineInputBorder(),
        ),
        child: Text(_unitPrice(netPrice),
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
