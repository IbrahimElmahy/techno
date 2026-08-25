import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// إضافة أصناف المعاينة — بوبابين ورا بعض، وبتفضل مفتوحة لحد ما تقول «تم».
///
/// It used to be a full screen: open it, search, tap an item, type a quantity, and you are dropped
/// back on the form. A rep recording a visit adds six or seven items in a row, so that is six or
/// seven round trips through a screen transition to add six lines.
///
/// Now it is two dialogs over the form: pick the item, then say how many. «التالي» records that one
/// and reopens the picker straight away, so the next item is one tap from the last. «تم» records it
/// and closes.
///
/// **The quantity box starts EMPTY on purpose.** It used to be pre-filled with «1», and a
/// pre-filled number in a box you are about to type in is a number waiting to be half-overwritten —
/// «1» plus a typed «2» is 12, or 21, depending on where the caret sat. The rep asked for it blank
/// so the figure on the line is the one he meant.
class AddItemFlow {
  const AddItemFlow._();

  /// بيفضل يفتح البوبابات لحد ما المستخدم يقفل. `onAdd` بتتنادى لكل صنف يتضاف.
  static Future<void> show(
    BuildContext context,
    void Function(InspectionLine line) onAdd,
  ) async {
    var keepGoing = true;
    while (keepGoing && context.mounted) {
      final item = await _pickItem(context);
      if (item == null) return; // خرج من اختيار الصنف

      if (!context.mounted) return;
      final answer = await _askQuantity(context, item);
      if (!context.mounted) return;
      if (answer == null) continue; // رجع يختار صنف تاني

      onAdd(answer.line);
      keepGoing = answer.another;
    }
  }
}

/// نتيجة بوباب الكمية: السطر، وهل المستخدم عايز يضيف صنف تاني.
class _QuantityAnswer {
  const _QuantityAnswer(this.line, {required this.another});
  final InspectionLine line;
  final bool another;
}

String _fmt(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  // Trim trailing zeros on fractional points (0.1667 → 0.1667, 0.5000 → 0.5).
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

/// بوباب اختيار الصنف — بحث وقايمة.
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
        // Tall enough to show a useful number of items, capped so the dialog never runs off a
        // small phone.
        height: MediaQuery.of(context).size.height * 0.55,
        child: Column(
          children: [
            TextField(
              controller: _search,
              autofocus: true,
              onChanged: _load,
              decoration: InputDecoration(
                hintText: 'ابحث بإسم الصنف...',
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
                              'مفيش أصناف — اعمل «تحديث الأصناف والقوائم» من القائمة',
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

/// بوباب الكمية — ومنه «التالي» أو «تم».
class _QuantityDialog extends StatefulWidget {
  const _QuantityDialog({required this.item});
  final CatalogItem item;

  @override
  State<_QuantityDialog> createState() => _QuantityDialogState();
}

class _QuantityDialogState extends State<_QuantityDialog> {
  // Empty, not «1» — see the note on AddItemFlow.
  final _qty = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  double get _typed => double.tryParse(_qty.text.trim()) ?? 0;

  /// بيقفل البوباب بالسطر — أو بيوقف ويقول الكمية غلط.
  void _finish({required bool another}) {
    final q = _typed;
    if (q <= 0) {
      setState(() => _error = 'اكتب الكمية');
      return;
    }
    Navigator.pop(
      context,
      _QuantityAnswer(
        // `item_id` بيفضل null — والقرار ده قرار شغل مش تفصيلة تقنية.
        //
        // أصناف المعاينة **بتتعدّ للنقاط بس**؛ المندوب مش بيركّبها من عربيته. اتأكدنا من ده
        // مع صاحب النظام.
        //
        // The server treats a line carrying an `item_id` as a real movement: it renames the line
        // after that product and posts an `inspection_out` deducting it from the rep's custody.
        // The two catalogues are numbered from 1 independently, so eight of the thirty-two
        // inspection ids land on an unrelated product — the line would draw down something the rep
        // never touched, or be refused outright with «الرصيد غير كافٍ في عهدتك».
        //
        // If the business ever changes and these items ARE fitted from the van, this is not the
        // place to fix it: the inspection catalogue would first have to point at real products.
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
          // The running total, so the rep sees what the line is worth before committing it.
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
        // «التالي» is the common case — a rep adding one item is the exception — so it is the
        // filled button and the one Enter triggers.
        OutlinedButton(onPressed: () => _finish(another: false), child: const Text('تم')),
        FilledButton(onPressed: () => _finish(another: true), child: const Text('التالي')),
      ],
    );
  }
}
