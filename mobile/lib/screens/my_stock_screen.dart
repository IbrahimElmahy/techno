import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// بضاعتي — اللي في العربية دلوقتي.
///
/// السؤال اللي المندوب بيسأله قبل ما ينزل وبعد كل بيعة: «معايا كام؟». وقبل الشاشة دي
/// الإجابة كانت في دماغه أو في ورقة.
///
/// **والمتاح هنا ناقص اللي اتباع ولسه ما اترفعش** — نفس القاعدة اللي في شاشة اختيار
/// الصنف. الرقمين بيبانوا مع بعض لما يختلفوا، عشان المندوب يعرف إن فيه بضاعة اتحجزت
/// لفواتير لسه في الطابور، مش إن رصيده نقص من غير سبب.
class MyStockScreen extends StatefulWidget {
  const MyStockScreen({super.key});

  @override
  State<MyStockScreen> createState() => _MyStockScreenState();
}

class _MyStockScreenState extends State<MyStockScreen> {
  final _search = TextEditingController();
  List<SaleItem> _items = [];
  Map<int, double> _free = {};
  bool _loading = true;
  String? _lastPull;

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
    final free = <int, double>{};
    for (final it in items) {
      free[it.itemId] = await LocalDb.instance.availableForSale(it.itemId);
    }
    final pull = await LocalDb.instance.getKv('last_sales_pull');
    if (!mounted) return;
    setState(() {
      _items = items;
      _free = free;
      _lastPull = pull;
      _loading = false;
    });
  }

  double get _value => _items.fold(
      0.0, (t, i) => t + (_free[i.itemId] ?? 0) * (i.basePrice ?? 0));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('بضاعتي')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Card(
                  color: const Color(0xFFF3F8FB),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _stat('أصناف', '${_items.length}'),
                        _stat('قيمة البضاعة', _money(_value)),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => _load(),
                    decoration: const InputDecoration(
                      hintText: 'دوّر باسم الصنف',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                ),
                if (_lastPull != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                    child: Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text('آخر تحديث: ${_lastPull!.substring(0, 16).replaceAll('T', ' ')}',
                          style: const TextStyle(fontSize: 12, color: Colors.black54)),
                    ),
                  ),
                Expanded(
                  child: _items.isEmpty
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: Text('مافيش بضاعة على الجهاز.\nاسحب البيانات الأول.',
                                textAlign: TextAlign.center),
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.separated(
                            itemCount: _items.length,
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (_, i) {
                              final it = _items[i];
                              final free = _free[it.itemId] ?? 0;
                              // الفرق بين اللي في العربية واللي متاح = بضاعة محجوزة
                              // لفواتير في الطابور. بتتقال بدل ما الرقم ينقص في صمت.
                              final held = it.onHand - free;
                              return ListTile(
                                title: Text(it.name,
                                    style: const TextStyle(fontWeight: FontWeight.w600)),
                                subtitle: Text([
                                  'المتاح: ${_qty(free)}${it.unit != null ? ' ${it.unit}' : ''}',
                                  if (held > 0.0001) 'محجوز لفواتير مستنية: ${_qty(held)}',
                                  if (it.basePrice != null) 'السعر: ${_money(it.basePrice!)}',
                                ].join(' · ')),
                                trailing: Text(_qty(free),
                                    style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w800,
                                      color: free <= 0 ? AppColors.danger : AppColors.primary,
                                    )),
                              );
                            },
                          ),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _stat(String label, String value) => Column(
        children: [
          Text(value,
              style: const TextStyle(
                  fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.primary)),
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.black54)),
        ],
      );
}

String _money(double v) => v.toStringAsFixed(2);

String _qty(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}
