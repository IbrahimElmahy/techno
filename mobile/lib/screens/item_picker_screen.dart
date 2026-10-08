import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

class AddItemFlow {
  const AddItemFlow._();

  static Future<void> show(
    BuildContext context,
    void Function(InspectionLine line) onAdd,
  ) async {
    var keepGoing = true;
    while (keepGoing && context.mounted) {
      final item = await _pickItem(context);
      if (item == null) return;

      if (!context.mounted) return;
      final answer = await _askQuantity(context, item);
      if (!context.mounted) return;
      if (answer == null) continue;

      onAdd(answer.line);
      keepGoing = answer.another;
    }
  }
}

class _QuantityAnswer {
  const _QuantityAnswer(this.line, {required this.another});
  final InspectionLine line;
  final bool another;
}

String _fmt(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v.toStringAsFixed(4).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

Future<CatalogItem?> _pickItem(BuildContext context) => showDialog<CatalogItem>(
      context: context,
      builder: (_) => const Directionality(
        textDirection: TextDirection.rtl,
        child: _ItemPickerDialog(),
      ),
    );

Future<_QuantityAnswer?> _askQuantity(BuildContext context, CatalogItem item) =>
    showDialog<_QuantityAnswer>(
      context: context,
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: _QuantityDialog(item: item),
      ),
    );

class _ItemPickerDialog extends StatefulWidget {
  const _ItemPickerDialog();

  @override
  State<_ItemPickerDialog> createState() => _ItemPickerDialogState();
}

class _ItemPickerDialogState extends State<_ItemPickerDialog> {
  final _search = TextEditingController();
  List<CatalogItem> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load([String q = '']) async {
    final items = await LocalDb.instance.itemTypes(query: q);
    if (mounted) setState(() { _items = items; _loading = false; });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      titlePadding: const EdgeInsets.fromLTRB(20, 18, 12, 0),
      contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      title: Row(
        children: [
          const Expanded(
            child: Text('اختيار صنف', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
          IconButton(
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.pop(context),
            tooltip: 'إغلاق',
          ),
        ],
      ),
      content: SizedBox(
        width: 420,
        height: MediaQuery.of(context).size.height * 0.55,
        child: Column(
          children: [
            TextField(
              controller: _search,
              autofocus: true,
              onChanged: _load,
              decoration: InputDecoration(
                hintText: 'ابحث باسم الصنف...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () { _search.clear(); _load(); },
                      ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _items.isEmpty
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(16),
                            child: Text(
                              'لا توجد أصناف',
                              textAlign: TextAlign.center,
                            ),
                          ),
                        )
                      : ListView.separated(
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (c, i) {
                            final it = _items[i];
                            return ListTile(
                              title: Text(it.name),
                              trailing: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: AppColors.accent.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text('${_fmt(it.points)} نقطة',
                                    style: const TextStyle(
                                        fontSize: 12, fontWeight: FontWeight.w700)),
                              ),
                              onTap: () => Navigator.pop(context, it),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuantityDialog extends StatefulWidget {
  const _QuantityDialog({required this.item});
  final CatalogItem item;

  @override
  State<_QuantityDialog> createState() => _QuantityDialogState();
}

class _QuantityDialogState extends State<_QuantityDialog> {
  final _qty = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  double get _typed => double.tryParse(_qty.text.trim()) ?? 0;

  void _finish({required bool another}) {
    final q = _typed;
    if (q <= 0) {
      setState(() => _error = 'اكتب الكمية');
      return;
    }
    Navigator.pop(
      context,
      _QuantityAnswer(
        InspectionLine(
          itemId: null,
          itemName: widget.item.name,
          quantity: q,
          points: widget.item.points,
        ),
        another: another,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final total = _typed * widget.item.points;
    return AlertDialog(
      title: Text(widget.item.name, style: const TextStyle(fontWeight: FontWeight.w800)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('نقاط الوحدة: ${_fmt(widget.item.points)}',
              style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          TextField(
            controller: _qty,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _error = null),
            onSubmitted: (_) => _finish(another: true),
            decoration: InputDecoration(
              labelText: 'الكمية',
              hintText: 'اكتب الكمية',
              errorText: _error,
            ),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              total > 0 ? 'الإجمالي: ${_fmt(total)} نقطة' : 'الإجمالي: —',
              style: TextStyle(
                color: total > 0 ? AppColors.success : Colors.blueGrey,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
      actionsPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('رجوع')),
        OutlinedButton(onPressed: () => _finish(another: false), child: const Text('تم')),
        FilledButton(onPressed: () => _finish(another: true), child: const Text('التالي')),
      ],
    );
  }
}
