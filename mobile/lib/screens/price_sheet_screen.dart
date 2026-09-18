import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// كشف التسعير — **السعر اللي التاجر ده هيدفعه**، لكل أصناف النظام.
///
/// مش قايمة أسعار عامة. المندوب واقف قدام تاجر بيسأله «الصنف ده بكام؟»، والرقم
/// الصح يعتمد على فئة التاجر وخصم الصنف. الكشف اللي بيعرض سعر واحد للكل بيخلّي
/// المندوب يقول رقم والفاتورة تطلع برقم تاني — فيرجع يشرح، أو أوحش: يوعد بسعر
/// الشركة مابتبيعش بيه.
///
/// فالتاجر بيتختار الأول، وكل الأرقام بتتحسب على فئته. ومن غير اختيار بيعرض السعر
/// الأساسي وبيقول كده صراحةً.
///
/// **وبيشتغل من غير شبكة.** الكتالوج بأسعاره بينزل مع المزامنة، فالمندوب في السوق
/// بيسعّر صنف مش معاه في العربية أصلاً.
///
/// **والرصيد مش معروض عن قصد.** دي أصناف النظام كله مش اللي في العربية؛ عرض رصيد
/// مخزن جنب السعر بيغرّي ببيع مالوش غطاء عنده. اللي عايز يشوف اللي معاه بيفتح
/// «بضاعتي».
class PriceSheetScreen extends StatefulWidget {
  const PriceSheetScreen({super.key});

  @override
  State<PriceSheetScreen> createState() => _PriceSheetScreenState();
}

class _PriceSheetScreenState extends State<PriceSheetScreen> {
  final _search = TextEditingController();
  List<SaleItem> _all = const [];
  List<CustomerRef> _customers = const [];
  CustomerRef? _customer;
  String? _category;
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
    final items = await LocalDb.instance.catalogItems();
    final custs = await LocalDb.instance.customers(limit: 500);
    if (!mounted) return;
    setState(() {
      _all = items;
      _customers = custs;
      _loading = false;
    });
  }

  String? get _tier => _customer?.priceTier;

  List<String> get _categories {
    final set = <String>{
      for (final i in _all) if ((i.category ?? '').isNotEmpty) i.category!
    }.toList()
      ..sort();
    return set;
  }

  List<SaleItem> get _shown {
    final q = _search.text.trim();
    return _all.where((i) {
      if (_category != null && i.category != _category) return false;
      if (q.isEmpty) return true;
      return i.name.contains(q);
    }).toList();
  }

  /// نسخة نصية تتبعت للتاجر على واتساب — ده اللي المندوب بيعمله فعلاً بالورقة.
  void _copy() {
    final rows = _shown;
    if (rows.isEmpty) return;
    final head = _customer == null
        ? 'كشف أسعار'
        : 'كشف أسعار — ${_customer!.name}';
    final body = rows.map((i) {
      final net = i.netPriceFor(_tier);
      return '${i.name}  ${net.toStringAsFixed(2)} ج'
          '${i.unit != null ? ' / ${i.unit}' : ''}';
    }).join('\n');
    Clipboard.setData(ClipboardData(text: '$head\n\n$body'));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('اتنسخ ${rows.length} صنف — الزقه في أي مكان')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = _shown;
    return Scaffold(
      appBar: AppBar(
        title: const Text('كشف تسعير'),
        actions: [
          IconButton(
            tooltip: 'انسخ الكشف',
            icon: const Icon(Icons.copy_all_outlined),
            onPressed: rows.isEmpty ? null : _copy,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                  child: Column(
                    children: [
                      // التاجر الأول: كل الأرقام تحت بتتحسب على فئته.
                      DropdownButtonFormField<CustomerRef?>(
                        initialValue: _customer,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'التاجر (عشان السعر يطلع بفئته)',
                          prefixIcon: Icon(Icons.person_outline),
                          border: OutlineInputBorder(),
                        ),
                        items: [
                          const DropdownMenuItem<CustomerRef?>(
                            value: null,
                            child: Text('من غير تاجر — السعر الأساسي'),
                          ),
                          for (final c in _customers)
                            DropdownMenuItem<CustomerRef?>(
                              value: c,
                              child: Text(c.name, overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (v) => setState(() => _customer = v),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _search,
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          hintText: 'دوّر على صنف',
                          prefixIcon: const Icon(Icons.search),
                          border: const OutlineInputBorder(),
                          suffixIcon: _search.text.isEmpty
                              ? null
                              : IconButton(
                                  icon: const Icon(Icons.clear),
                                  onPressed: () =>
                                      setState(() => _search.clear()),
                                ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 38,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            _chip('الكل', _category == null,
                                () => setState(() => _category = null)),
                            for (final c in _categories)
                              _chip(c, _category == c,
                                  () => setState(() => _category = c)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                _banner(rows.length),
                const Divider(height: 1),
                Expanded(
                  child: rows.isEmpty
                      ? const Center(child: Text('مافيش أصناف'))
                      : ListView.separated(
                          itemCount: rows.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) => _row(rows[i]),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _chip(String label, bool on, VoidCallback onTap) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: ChoiceChip(
          label: Text(label),
          selected: on,
          onSelected: (_) => onTap(),
        ),
      );

  Widget _banner(int count) => Container(
        width: double.infinity,
        color: AppColors.primary.withValues(alpha: 0.06),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Text(
          _customer == null
              ? '$count صنف · السعر الأساسي — اختار تاجر عشان تشوف سعره هو'
              : '$count صنف · الأسعار بفئة ${_customer!.name}'
                  '${_tier == null ? ' (مالوش فئة — السعر الأساسي)' : ''}',
          style: const TextStyle(fontSize: 12.5, color: Colors.black54),
        ),
      );

  Widget _row(SaleItem item) {
    final gross = item.priceFor(_tier);
    final net = item.netPriceFor(_tier);
    final hasDiscount = item.defaultDiscountPct > 0;
    final priced = gross > 0;
    return ListTile(
      dense: true,
      title: Text(item.name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text([
        if ((item.unit ?? '').isNotEmpty) item.unit!,
        if ((item.category ?? '').isNotEmpty) item.category!,
      ].join(' · ')),
      trailing: !priced
          // السعر الفاضي مش صفر: «الصنف ده مالوش سعر مسجّل» غير «ببلاش». عرض
          // ٠٫٠٠ هنا بيخلّي المندوب يقوله رقم مالوش أصل.
          ? const Text('— مافيش سعر', style: TextStyle(color: Colors.black38))
          : Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${net.toStringAsFixed(2)} ج',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 15)),
                if (hasDiscount)
                  Text(
                    '${gross.toStringAsFixed(2)} − ${item.defaultDiscountPct.toStringAsFixed(0)}%',
                    style: const TextStyle(fontSize: 11, color: Colors.black45),
                  ),
              ],
            ),
    );
  }
}
