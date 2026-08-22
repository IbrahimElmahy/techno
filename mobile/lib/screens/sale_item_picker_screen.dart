import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// اختيار صنف من العربية.
///
/// **المتاح هنا مش رصيد العهدة.** ده رصيد العهدة ناقص اللي اتباع في فواتير لسه على الجهاز.
/// من غير الطرح ده، مندوب معاه خمسة يقدر يكتب تلات فواتير بخمسة كل واحدة وهو من غير شبكة،
/// ويكتشف عند المزامنة إن اتنين منهم اترفضوا — بعد ما يكون سلّم البضاعة وقال للعملاء إن
/// الفواتير اتعملت. الرقم اللي قدامه لازم يبقى صادق وهو في الشارع.
///
/// والصنف اللي خلص مابيتشالش من القايمة، بيتقفل ومكتوب عليه «خلص». الصنف اللي بيختفي
/// بيخلّي الواحد يفضل يدوّر عليه.
class SaleItemPickerScreen extends StatefulWidget {
  /// الأصناف اللي على الفاتورة دلوقتي — عشان المتاح يتحسب وهي في الحسبان.
  final Map<int, double> alreadyOnInvoice;

  /// فئة سعر العميل — بتحدّد السعر اللي بيتعرض جنب الصنف. لو لسه مااتحددش عميل،
  /// بيتعرض السعر الأساسي، وبيتظبط لوحده أول ما العميل يتحدّد.
  final String? priceTier;

  const SaleItemPickerScreen(
      {super.key, this.alreadyOnInvoice = const {}, this.priceTier});

  @override
  State<SaleItemPickerScreen> createState() => _SaleItemPickerScreenState();
}

class _SaleItemPickerScreenState extends State<SaleItemPickerScreen> {
  final _search = TextEditingController();
  List<SaleItem> _items = [];
  Map<int, double> _available = {};
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

  Future<void> _load() async {
    final items = await LocalDb.instance.saleItems(query: _search.text);
    final avail = <int, double>{};
    for (final it in items) {
      final free = await LocalDb.instance.availableForSale(it.itemId);
      avail[it.itemId] = free - (widget.alreadyOnInvoice[it.itemId] ?? 0);
    }
    if (!mounted) return;
    setState(() {
      _items = items;
      _available = avail;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('اختر صنف من العربية')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _search,
              onChanged: (_) => _load(),
              decoration: const InputDecoration(
                hintText: 'دوّر باسم الصنف',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_items.isEmpty)
            const Expanded(
              child: Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'مافيش أصناف في العربية.\nاسحب البيانات من شاشة المزامنة الأول.',
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: _items.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (_, i) {
                  final it = _items[i];
                  final free = _available[it.itemId] ?? 0;
                  final out = free <= 0;
                  return ListTile(
                    enabled: !out,
                    title: Text(it.name,
                        style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: out ? Colors.black38 : null)),
                    // السعر والخصم الثابت جنب الصنف — الاختيار بيتعمل على أساسهم، ومن
                    // غيرهم المندوب بيضيف الصنف عشان يشوف بكام وبعدين يشيله.
                    subtitle: Text(out
                        ? 'خلص من العربية'
                        : [
                            'المتاح: ${_qty(free)}${it.unit != null ? ' ${it.unit}' : ''}',
                            'السعر: ${_money(it.priceFor(widget.priceTier))}',
                            if (it.defaultDiscountPct > 0)
                              'خصم ثابت: ${_qty(it.defaultDiscountPct)}%',
                          ].join(' · ')),
                    trailing: out
                        ? const Chip(
                            label: Text('خلص'),
                            backgroundColor: Color(0xFFF1F1F1),
                            visualDensity: VisualDensity.compact)
                        : const Icon(Icons.add_circle_outline, color: AppColors.primary),
                    onTap: out ? null : () => Navigator.pop(context, it),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

/// كمية من غير أصفار مالهاش لازمة — «٣» أوضح من «٣٫٠٠٠» في قايمة بتتقرا بسرعة.
String _qty(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}

String _money(double v) => v.toStringAsFixed(2);
