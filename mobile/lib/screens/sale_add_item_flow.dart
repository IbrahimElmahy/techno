import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/arabic_sort.dart';
import '../models/models.dart';
import '../theme.dart';

class SaleAddItemFlow {
  const SaleAddItemFlow._();

  static Future<void> show(
    BuildContext context, {
    required Map<int, double> alreadyOnInvoice,
    required String? priceTier,
    required void Function(SaleItem item, double quantity) onAdd,
    bool capToAvailable = true,
    bool showAvailable = true,
    bool showPrice = true,
    bool showNetPrice = true,
    List<SaleItem>? source,
    int? exceptInvoiceLocalId,
  }) async {
    final items = source ?? await LocalDb.instance.saleItems();
    sortByName<SaleItem>(items, (i) => i.name);
    final free = await LocalDb.instance
        .availableForSaleAll(exceptInvoiceLocalId: exceptInvoiceLocalId);
    if (!context.mounted) return;

    if (items.isEmpty) {
      await showDialog<void>(
        context: context,
        builder: (dctx) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text('الأصناف لسه ما نزلتش على الجهاز'),
            content: Text(source == null
                ? 'افتح «مزامنة البيانات» من القايمة واعمل مزامنة — الأصناف بتنزل معاها '
                    'بأرصدة عربيتك وأسعارها.'
                    '\n\n'
                    'لو المزامنة تمّت وبرضه فاضية، يبقى مالكش مخزن ولا عهدة مسجّلة — '
                    'كلّم المخزن.'
                : 'المخزن ده مافيهوش أصناف على الجهاز.'
                    '\n\n'
                    'اعمل «مزامنة البيانات» — أصناف المخازن بتنزل معاها. ولو بعد '
                    'المزامنة برضه فاضي، يبقى المخزن نفسه مافيهوش رصيد.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(dctx),
                  child: const Text('تمام')),
            ],
          ),
        ),
      );
      return;
    }

    final onInvoice = Map<int, double>.from(alreadyOnInvoice);

    final hasCategoryLevel = _categoriesOf(items).length > 1;

    var keepGoing = true;
    String? category;
    final pickerMemory = _PickerMemory();
    while (keepGoing && context.mounted) {
      category ??= await _pickCategory(context, items);
      if (category == null) return;

      if (!context.mounted) return;
      final picked = await _pickItem(
        context, items, free, onInvoice, category, priceTier,
        capToAvailable: capToAvailable, showAvailable: showAvailable,
        showPrice: showPrice, showNetPrice: showNetPrice, memory: pickerMemory);
      if (picked == null) {
        if (!hasCategoryLevel) return;
        category = null;
        pickerMemory.reset();
        continue;
      }

      if (!context.mounted) return;
      final avail = (free[picked.itemId] ?? 0) - (onInvoice[picked.itemId] ?? 0);
      final answer = await _askQuantity(context, picked, avail, priceTier,
          capToAvailable: capToAvailable, showAvailable: showAvailable,
          showPrice: showPrice, showNetPrice: showNetPrice);
      if (!context.mounted) return;
      if (answer == null) continue;

      onAdd(picked, answer.quantity);
      onInvoice.update(picked.itemId, (q) => q + answer.quantity,
          ifAbsent: () => answer.quantity);
      keepGoing = answer.another;
    }
  }
}

class _QtyAnswer {
  const _QtyAnswer(this.quantity, {required this.another});
  final double quantity;
  final bool another;
}

const _noCategory = 'بدون فئة';

String _categoryOf(SaleItem it) {
  final c = it.category?.trim() ?? '';
  return c.isEmpty ? _noCategory : c;
}

String _fmt(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v.toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

String _money(double v) => v.toStringAsFixed(2);

List<MapEntry<String, int>> _categoriesOf(List<SaleItem> items) {
  final counts = <String, int>{};
  for (final it in items) {
    counts.update(_categoryOf(it), (n) => n + 1, ifAbsent: () => 1);
  }
  return counts.entries.toList()
    ..sort((a, b) {
      if ((a.key == _noCategory) != (b.key == _noCategory)) {
        return a.key == _noCategory ? 1 : -1;
      }
      return compareArabic(a.key, b.key);
    });
}

Future<String?> _pickCategory(BuildContext context, List<SaleItem> items) {
  final cats = _categoriesOf(items);
  if (cats.length <= 1) {
    return Future.value(cats.isEmpty ? _noCategory : cats.first.key);
  }
  return showDialog<String>(
    context: context,
    builder: (_) => Directionality(
      textDirection: TextDirection.rtl,
      child: _CategoryDialog(categories: cats),
    ),
  );
}

Future<SaleItem?> _pickItem(
  BuildContext context,
  List<SaleItem> items,
  Map<int, double> free,
  Map<int, double> onInvoice,
  String category,
  String? priceTier, {
  required bool capToAvailable,
  required bool showAvailable,
  required bool showPrice,
  required bool showNetPrice,
  required _PickerMemory memory,
}) =>
    showDialog<SaleItem>(
      context: context,
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: _SaleItemDialog(
          items: items,
          free: free,
          onInvoice: onInvoice,
          category: category,
          priceTier: priceTier,
          capToAvailable: capToAvailable,
          showAvailable: showAvailable,
          showPrice: showPrice,
          showNetPrice: showNetPrice,
          memory: memory,
        ),
      ),
    );

class _PickerMemory {
  String query = '';
  double scrollOffset = 0;
  bool searchAll = false;
  void reset() {
    query = '';
    scrollOffset = 0;
    searchAll = false;
  }
}

Future<_QtyAnswer?> _askQuantity(
        BuildContext context, SaleItem item, double available, String? priceTier,
        {required bool capToAvailable,
        required bool showAvailable,
        required bool showPrice,
        required bool showNetPrice}) =>
    showDialog<_QtyAnswer>(
      context: context,
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: _SaleQuantityDialog(
            item: item,
            available: available,
            priceTier: priceTier,
            capToAvailable: capToAvailable,
            showAvailable: showAvailable,
            showPrice: showPrice, showNetPrice: showNetPrice),
      ),
    );

class _CategoryDialog extends StatelessWidget {
  const _CategoryDialog({required this.categories});
  final List<MapEntry<String, int>> categories;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      titlePadding: const EdgeInsets.fromLTRB(20, 18, 12, 0),
      contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      title: Row(
        children: [
          const Expanded(
            child: Text('اختر الفئة',
                style: TextStyle(fontWeight: FontWeight.w800)),
          ),
          IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'إغلاق',
            onPressed: () => Navigator.pop(context),
          ),
        ],
      ),
      content: SizedBox(
        width: 420,
        height: MediaQuery.of(context).size.height * 0.55,
        child: ListView.separated(
          itemCount: categories.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (c, i) {
            final e = categories[i];
            return ListTile(
              title: Text(e.key),
              trailing: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text('${e.value}',
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w700)),
              ),
              onTap: () => Navigator.pop(context, e.key),
            );
          },
        ),
      ),
    );
  }
}

class _SaleItemDialog extends StatefulWidget {
  const _SaleItemDialog({
    required this.items,
    required this.free,
    required this.onInvoice,
    required this.category,
    required this.priceTier,
    required this.capToAvailable,
    required this.showAvailable,
    required this.showPrice,
    required this.showNetPrice,
    required this.memory,
  });

  final List<SaleItem> items;
  final _PickerMemory memory;
  final Map<int, double> free;
  final Map<int, double> onInvoice;
  final String category;
  final String? priceTier;
  final bool capToAvailable;
  final bool showAvailable;
  final bool showPrice;
  final bool showNetPrice;

  @override
  State<_SaleItemDialog> createState() => _SaleItemDialogState();
}

class _SaleItemDialogState extends State<_SaleItemDialog> {
  late final _search = TextEditingController(text: widget.memory.query);
  late final _scroll = ScrollController(initialScrollOffset: widget.memory.scrollOffset);

  late bool _searchAll = widget.memory.searchAll;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.hasClients) widget.memory.scrollOffset = _scroll.offset;
    });
  }

  @override
  void dispose() {
    if (_pickedFromSearch) {
      widget.memory.reset();
    } else {
      widget.memory
        ..query = _search.text
        ..searchAll = _searchAll;
    }
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  double _availableOf(SaleItem it) =>
      (widget.free[it.itemId] ?? 0) - (widget.onInvoice[it.itemId] ?? 0);

  String get _query => bare(_search.text);

  bool _matches(SaleItem it) {
    final name = bare(it.name);
    return _query.split(' ').where((w) => w.isNotEmpty).every(name.contains);
  }

  bool _pickedFromSearch = false;

  bool _inCategory(SaleItem it) => _categoryOf(it) == widget.category;

  List<SaleItem> get _visible {
    if (_query.isEmpty) {
      return [
        for (final it in widget.items)
          if (_inCategory(it)) it
      ];
    }
    return [
      for (final it in widget.items)
        if (_matches(it) && (_searchAll || _inCategory(it))) it
    ];
  }

  int get _elsewhere {
    if (_query.isEmpty || _searchAll) return 0;
    var n = 0;
    for (final it in widget.items) {
      if (_matches(it) && !_inCategory(it)) n++;
    }
    return n;
  }

  void _onSearchChanged() {
    if (_query.isEmpty) _searchAll = false;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final searching = _query.isNotEmpty;
    final rows = _visible;
    final elsewhere = _elsewhere;
    return AlertDialog(
      titlePadding: const EdgeInsets.fromLTRB(20, 18, 12, 0),
      contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      title: Row(
        children: [
          Expanded(
            child: Text(
                searching
                    ? (_searchAll
                        ? 'نتايج البحث في كل الأصناف'
                        : 'نتايج البحث في ${widget.category}')
                    : widget.category,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800)),
          ),
          IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'رجوع للفئات',
            onPressed: () => Navigator.pop(context),
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
              onChanged: (_) => _onSearchChanged(),
              decoration: InputDecoration(
                hintText: _searchAll
                    ? 'ابحث في كل الأصناف...'
                    : 'ابحث في ${widget.category}...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _search.clear();
                          _onSearchChanged();
                        },
                      ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: rows.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          searching
                              ? (_searchAll
                                  ? 'مفيش صنف بالاسم ده'
                                  : 'مفيش صنف بالاسم ده في ${widget.category}')
                              : 'مفيش أصناف هنا',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.separated(
                      controller: _scroll,
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (c, i) {
                        final it = rows[i];
                        final avail = _availableOf(it);
                        final out = widget.capToAvailable && avail <= 0;
                        final parts = <String>[
                          if (widget.showAvailable)
                            avail <= 0
                                ? 'خلص من العربية'
                                : 'عندك ${_fmt(avail)}',
                          if (it.unit != null && !widget.showAvailable)
                            '${it.unit}',
                          if (widget.showPrice)
                            widget.showNetPrice
                                ? '${_money(it.netPriceFor(widget.priceTier))}'
                                    '${it.defaultDiscountPct > 0
                                        ? ' (بعد خصم ${_fmt(it.defaultDiscountPct)}%)'
                                        : ''}'
                                : '${_money(it.priceFor(widget.priceTier))}',
                        ];
                        return ListTile(
                          enabled: !out,
                          title: Text(it.name),
                          subtitle: Text(
                            parts.join(' · '),
                            style: TextStyle(
                                fontSize: 12,
                                color: out ? AppColors.danger : Colors.black54),
                          ),
                          onTap: out
                              ? null
                              : () {
                                  _pickedFromSearch = _query.isNotEmpty;
                                  Navigator.pop(context, it);
                                },
                        );
                      },
                    ),
            ),
            if (elsewhere > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 4),
                child: SizedBox(
                  width: double.infinity,
                  child: TextButton.icon(
                    icon: const Icon(Icons.travel_explore, size: 18),
                    onPressed: () => setState(() => _searchAll = true),
                    label: Text(
                      elsewhere == 1
                          ? 'فيه نتيجة واحدة في فئة تانية — دوّر في كل الأصناف'
                          : 'فيه $elsewhere نتايج في فئات تانية — دوّر في كل الأصناف',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SaleQuantityDialog extends StatefulWidget {
  const _SaleQuantityDialog({
    required this.item,
    required this.available,
    required this.priceTier,
    required this.capToAvailable,
    required this.showAvailable,
    required this.showPrice,
    required this.showNetPrice,
  });

  final SaleItem item;
  final double available;
  final String? priceTier;
  final bool capToAvailable;
  final bool showAvailable;
  final bool showPrice;
  final bool showNetPrice;

  @override
  State<_SaleQuantityDialog> createState() => _SaleQuantityDialogState();
}

class _SaleQuantityDialogState extends State<_SaleQuantityDialog> {
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
    if (widget.capToAvailable && q > widget.available + 0.0001) {
      setState(() => _error = 'المتاح ${_fmt(widget.available)} بس');
      return;
    }
    Navigator.pop(context, _QtyAnswer(q, another: another));
  }

  @override
  Widget build(BuildContext context) {
    final price = widget.item.netPriceFor(widget.priceTier);
    final total = _typed * price;
    return AlertDialog(
      title: Text(widget.item.name,
          style: const TextStyle(fontWeight: FontWeight.w800)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.showPrice || widget.showAvailable ||
              widget.item.unit != null)
            Text(
                widget.showPrice
                    ? 'السعر: ${_money(widget.showNetPrice
                            ? price
                            : widget.item.priceFor(widget.priceTier))}'
                        '${widget.showNetPrice && widget.item.defaultDiscountPct > 0
                            ? ' (بعد خصم ${_fmt(widget.item.defaultDiscountPct)}%)'
                            : ''}'
                        '${widget.showAvailable ? ' · المتاح: ${_fmt(widget.available)}' : ''}'
                    : widget.showAvailable
                        ? 'عندك في العربية: ${_fmt(widget.available)}'
                        : 'الوحدة: ${widget.item.unit}',
                style: const TextStyle(
                    color: AppColors.primary, fontWeight: FontWeight.w700)),
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
              suffixText: widget.item.unit,
            ),
          ),
          const SizedBox(height: 10),
          if (widget.showPrice)
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(
                total > 0 ? 'الإجمالي: ${_money(total)}' : 'الإجمالي: —',
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
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('رجوع')),
        OutlinedButton(
            onPressed: () => _finish(another: false), child: const Text('تم')),
        FilledButton(
            onPressed: () => _finish(another: true), child: const Text('التالي')),
      ],
    );
  }
}
