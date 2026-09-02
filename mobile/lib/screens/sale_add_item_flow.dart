import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// إضافة أصناف لفاتورة البيع — **بوبابات ورا بعض**، زي أصناف المعاينة بالظبط.
///
/// كانت شاشة كاملة: تفتحها، تختار فئة، تختار صنف، ترجع للفاتورة، والسطر بيتضاف بكمية
/// «١» وتعدّلها. المندوب اللي بيحط تمن أصناف كان بيعمل تمن دخلات وخرجات من شاشة، وتمن
/// تعديلات كمية بعدهم. دلوقتي: الفئة، الصنف، الكمية — و«التالي» بيرجّعه للأصناف على طول.
///
/// **خانة الكمية بتبتدي فاضية عن قصد.** كانت بتبتدي «١»، والرقم اللي مكتوب في خانة انت
/// جاي تكتب فيها هو رقم مستنّي نصّه يتمسح: «١» ومعاها «٢» بتطلع ١٢ أو ٢١ حسب مكان
/// المؤشر. نفس القاعدة اتطبّقت في أصناف المعاينة لما المندوب طلبها، ودي نفس الغلطة في
/// نفس الإيد على شاشة تانية.
///
/// **المتاح هنا مش رصيد العهدة**: ده الرصيد ناقص اللي اتحط على الفاتورة اللي بيكتبها
/// دلوقتي — من غير الطرح ده بيحط نفس الخمسة على تلات سطور وهو مطمّن.
class SaleAddItemFlow {
  const SaleAddItemFlow._();

  /// بيفضل يفتح البوبابات لحد ما المستخدم يقفل. `onAdd` بتتنادى لكل صنف يتضاف،
  /// وبترجّع الكمية اللي بقت على الفاتورة عشان المتاح يتحدّث للّي بعده.
  static Future<void> show(
    BuildContext context, {
    required Map<int, double> alreadyOnInvoice,
    required String? priceTier,
    required void Function(SaleItem item, double quantity) onAdd,
    // البيع بيتحد بالمتاح في العربية؛ طلب التحويل **من المخزن** لأ — المندوب بيطلب
    // حاجة مش معاه أصلاً، والمتاح عنده معلومة مش حد. المسؤول هو اللي بيراجع الكميات.
    bool capToAvailable = true,
    // السعر على إذن تحويل زحمة — مافيش فلوس في المستند ده.
    bool showPrice = true,
  }) async {
    final items = await LocalDb.instance.saleItems();
    final free = await LocalDb.instance.availableForSaleAll();
    if (!context.mounted) return;

    // **مافيش ولا صنف على الجهاز = مشكلة مزامنة، مش عربية فاضية.**
    //
    // من غير الفرق ده كان بيفتح بوباب «بدون فئة» فاضي مكتوب فيه «مفيش أصناف هنا» —
    // والمندوب يقفله ويفتحه تاني ويفضل مستني. الرسالة دي بتقول له اللي حصل فعلاً
    // وبتوديه للمكان اللي بيصلّحه. العربية الفاضية فعلاً بتبان في «مخزني» بأصنافها
    // على صفر، مش ببوباب صامت.
    if (items.isEmpty) {
      await showDialog<void>(
        context: context,
        builder: (dctx) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text('الأصناف لسه ما نزلتش على الجهاز'),
            content: const Text(
                'افتح «مزامنة البيانات» من القايمة واعمل مزامنة — الأصناف بتنزل معاها '
                'بأرصدة عربيتك وأسعارها.'
                '\n\n'
                'لو المزامنة تمّت وبرضه فاضية، يبقى مالكش مخزن ولا عهدة مسجّلة — '
                'كلّم المخزن.'),
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

    // نسخة شغّالة بتتظبط مع كل صنف يتضاف — البوباب اللي بعده بيقول المتاح الصح.
    final onInvoice = Map<int, double>.from(alreadyOnInvoice);

    // فئة واحدة (أو ولا واحدة) = مافيش مستوى فئات أصلاً — والرجوع من الأصناف
    // ساعتها لازم يقفل، مش يرجع لسؤال بيتجاوب لوحده. من غير الفرق ده البوباب كان
    // بيرجع يفتح نفسه للأبد: X ← فئات ← فئة واحدة بتتعدى أوتوماتيك ← نفس البوباب.
    // (اتصادت بالتجربة على جهاز أصنافه لسه ماتزامنتش.)
    final hasCategoryLevel = _categoriesOf(items).length > 1;

    var keepGoing = true;
    String? category;
    while (keepGoing && context.mounted) {
      // الفئة بتفضل زي ما هي بين الصنف والتاني: اللي بيحط تلات سخانات ورا بعض
      // مايرجعش لقايمة الفئات تلات مرات.
      category ??= await _pickCategory(context, items);
      if (category == null) return;

      if (!context.mounted) return;
      final picked = await _pickItem(
        context, items, free, onInvoice, category, priceTier,
        capToAvailable: capToAvailable, showPrice: showPrice);
      if (picked == null) {
        // رجوع من الأصناف بيرجّع للفئات — لو فيه فئات يترجع لها أصلاً.
        if (!hasCategoryLevel) return;
        category = null;
        continue;
      }

      if (!context.mounted) return;
      final avail = (free[picked.itemId] ?? 0) - (onInvoice[picked.itemId] ?? 0);
      final answer = await _askQuantity(context, picked, avail, priceTier,
          capToAvailable: capToAvailable, showPrice: showPrice);
      if (!context.mounted) return;
      if (answer == null) continue; // رجع يختار صنف تاني من نفس الفئة

      onAdd(picked, answer.quantity);
      onInvoice.update(picked.itemId, (q) => q + answer.quantity,
          ifAbsent: () => answer.quantity);
      keepGoing = answer.another;
    }
  }
}

/// نتيجة بوباب الكمية: الكمية، وهل هو عايز يضيف صنف تاني.
class _QtyAnswer {
  const _QtyAnswer(this.quantity, {required this.another});
  final double quantity;
  final bool another;
}

/// اللمّة اللي بتتحط فيها الأصناف اللي مالهاش فئة — **مابتختفيش**: صنف ناقصة عنه
/// بيانات على السيرفر مش صنف مش موجود في العربية.
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
      return a.key.compareTo(b.key);
    });
}

Future<String?> _pickCategory(BuildContext context, List<SaleItem> items) {
  final cats = _categoriesOf(items);
  // فئة واحدة مش سؤال — بتتعدّى على طول لقايمة الأصناف.
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
  required bool showPrice,
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
          showPrice: showPrice,
        ),
      ),
    );

Future<_QtyAnswer?> _askQuantity(
        BuildContext context, SaleItem item, double available, String? priceTier,
        {required bool capToAvailable, required bool showPrice}) =>
    showDialog<_QtyAnswer>(
      context: context,
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: _SaleQuantityDialog(
            item: item,
            available: available,
            priceTier: priceTier,
            capToAvailable: capToAvailable,
            showPrice: showPrice),
      ),
    );

/// بوباب الفئة — الفئات اللي معاه أصناف فيها فعلاً بس، ومعاها العدد.
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

/// بوباب الصنف — أصناف الفئة، والبحث بيدوّر في **كل** الأصناف.
///
/// اللي بيكتب اسم صنف عايز يلاقيه. لو البحث اتحبس في الفئة المفتوحة كان هيشوف «مافيش
/// نتيجة» على صنف موجود في عربيته تحت فئة تانية — وده أوحش من قايمة طويلة، لأنه بيكدب.
class _SaleItemDialog extends StatefulWidget {
  const _SaleItemDialog({
    required this.items,
    required this.free,
    required this.onInvoice,
    required this.category,
    required this.priceTier,
    required this.capToAvailable,
    required this.showPrice,
  });

  final List<SaleItem> items;
  final Map<int, double> free;
  final Map<int, double> onInvoice;
  final String category;
  final String? priceTier;
  final bool capToAvailable;
  final bool showPrice;

  @override
  State<_SaleItemDialog> createState() => _SaleItemDialogState();
}

class _SaleItemDialogState extends State<_SaleItemDialog> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  double _availableOf(SaleItem it) =>
      (widget.free[it.itemId] ?? 0) - (widget.onInvoice[it.itemId] ?? 0);

  List<SaleItem> get _visible {
    final q = _search.text.trim().toLowerCase();
    if (q.isNotEmpty) {
      return [
        for (final it in widget.items)
          if (it.name.toLowerCase().contains(q)) it
      ];
    }
    return [
      for (final it in widget.items)
        if (_categoryOf(it) == widget.category) it
    ];
  }

  @override
  Widget build(BuildContext context) {
    final searching = _search.text.trim().isNotEmpty;
    final rows = _visible;
    return AlertDialog(
      titlePadding: const EdgeInsets.fromLTRB(20, 18, 12, 0),
      contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      title: Row(
        children: [
          Expanded(
            child: Text(searching ? 'نتايج البحث' : widget.category,
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
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'ابحث في كل الأصناف...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () => setState(_search.clear),
                      ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: rows.isEmpty
                  ? const Center(child: Text('مفيش أصناف هنا'))
                  : ListView.separated(
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (c, i) {
                        final it = rows[i];
                        final avail = _availableOf(it);
                        // من غير حد بالمتاح، «خلص» مابتقفلش الصنف — بتتقال وخلاص.
                        final out = widget.capToAvailable && avail <= 0;
                        final parts = <String>[
                          avail <= 0 ? 'خلص من العربية' : 'عندك ${_fmt(avail)}',
                          if (widget.showPrice)
                            '${_money(it.priceFor(widget.priceTier))} ج.م',
                        ];
                        return ListTile(
                          enabled: !out,
                          title: Text(it.name),
                          // السعر والمتاح — الاتنين بيتسألوا وهو واقف، فبيتقالوا هنا.
                          subtitle: Text(
                            parts.join(' · '),
                            style: TextStyle(
                                fontSize: 12,
                                color: out ? AppColors.danger : Colors.black54),
                          ),
                          onTap: out ? null : () => Navigator.pop(context, it),
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

/// بوباب الكمية — ومنه «التالي» أو «تم». الخانة **فاضية**.
class _SaleQuantityDialog extends StatefulWidget {
  const _SaleQuantityDialog({
    required this.item,
    required this.available,
    required this.priceTier,
    required this.capToAvailable,
    required this.showPrice,
  });

  final SaleItem item;
  final double available;
  final String? priceTier;
  final bool capToAvailable;
  final bool showPrice;

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
    // المتاح بيتقاس هنا كمان مش وقت الحفظ بس: أحسن يعرف وهو بيكتب الرقم من إن
    // الفاتورة تترفض بعد ما يكون سلّم البضاعة. (طلب التحويل من المخزن مالوش الحد ده.)
    if (widget.capToAvailable && q > widget.available + 0.0001) {
      setState(() => _error = 'المتاح ${_fmt(widget.available)} بس');
      return;
    }
    Navigator.pop(context, _QtyAnswer(q, another: another));
  }

  @override
  Widget build(BuildContext context) {
    final price = widget.item.priceFor(widget.priceTier);
    final total = _typed * price;
    return AlertDialog(
      title: Text(widget.item.name,
          style: const TextStyle(fontWeight: FontWeight.w800)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
              widget.showPrice
                  ? 'السعر: ${_money(price)} ج.م · المتاح: ${_fmt(widget.available)}'
                  : 'عندك في العربية: ${_fmt(widget.available)}',
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
                total > 0 ? 'الإجمالي: ${_money(total)} ج.م' : 'الإجمالي: —',
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
