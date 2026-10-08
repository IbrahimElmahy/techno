import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/arabic_sort.dart';
import '../models/models.dart';
import '../theme.dart';

class MyStockScreen extends StatefulWidget {
  const MyStockScreen({super.key});

  @override
  State<MyStockScreen> createState() => _MyStockScreenState();
}

const _noCategory = 'بدون فئة';

class _MyStockScreenState extends State<MyStockScreen> {
  final _search = TextEditingController();
  List<SaleItem> _items = [];
  Map<int, double> _free = {};
  bool _loading = true;
  String? _lastPull;

  final Set<String> _open = {};

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
    final free = await LocalDb.instance.availableForSaleAll();
    final pull = await LocalDb.instance.getKv('last_sales_pull');
    if (!mounted) return;
    setState(() {
      _items = items;
      _free = free;
      _lastPull = pull;
      _loading = false;
    });
  }

  String _categoryOf(SaleItem it) {
    final c = it.category?.trim() ?? '';
    return c.isEmpty ? _noCategory : c;
  }

  List<MapEntry<String, List<SaleItem>>> get _byCategory {
    final m = <String, List<SaleItem>>{};
    for (final it in _items) {
      m.putIfAbsent(_categoryOf(it), () => []).add(it);
    }
    for (final e in m.entries) {
      sortByName<SaleItem>(e.value, (i) => i.name);
    }
    final entries = m.entries.toList()
      ..sort((a, b) {
        if ((a.key == _noCategory) != (b.key == _noCategory)) {
          return a.key == _noCategory ? 1 : -1;
        }
        return compareArabic(a.key, b.key);
      });
    return entries;
  }

  double _freeOf(SaleItem it) => _free[it.itemId] ?? 0;

  @override
  Widget build(BuildContext context) {
    final searching = _search.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text('بضاعتي')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Card(
                  color: const Color(0xFFF3F8FB),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _stat('أصناف', '${_items.length}'),
                        _stat('فئات', '${_byCategory.length}'),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => _load(),
                    decoration: InputDecoration(
                      hintText: 'ابحث باسم الصنف',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: searching
                          ? IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () {
                                _search.clear();
                                _load();
                              },
                            )
                          : null,
                    ),
                  ),
                ),
                if (_lastPull != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                    child: Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(
                          'آخر تحديث: '
                          '${_lastPull!.substring(0, 16).replaceAll('T', ' ')}',
                          style: const TextStyle(
                              fontSize: 12, color: Colors.black54)),
                    ),
                  ),
                Expanded(
                  child: _items.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(
                                searching
                                    ? 'لا يوجد صنف بهذا الاسم في سيارتك.'
                                    : 'لا توجد بضاعة على الجهاز.',
                                textAlign: TextAlign.center),
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: searching
                              ? ListView.separated(
                                  itemCount: _items.length,
                                  separatorBuilder: (_, __) =>
                                      const Divider(height: 1),
                                  itemBuilder: (_, i) => _itemTile(_items[i]),
                                )
                              : ListView.builder(
                                  itemCount: _byCategory.length,
                                  itemBuilder: (_, i) {
                                    final e = _byCategory[i];
                                    return _categoryTile(e.key, e.value);
                                  },
                                ),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _categoryTile(String name, List<SaleItem> items) {
    final open = _open.contains(name);
    final qty = items.fold<double>(0, (t, it) => t + _freeOf(it));
    final out = items.where((it) => _freeOf(it) <= 0).length;
    return Column(
      children: [
        ListTile(
          leading: Icon(open ? Icons.folder_open : Icons.folder_outlined,
              color: AppColors.primary),
          title: Text(name,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          subtitle: Text([
            '${items.length} صنف',
            'إجمالي ${_qty(qty)} قطعة',
            if (out > 0) '$out نفد',
          ].join(' · '), style: const TextStyle(fontSize: 12)),
          trailing: Icon(open ? Icons.expand_less : Icons.expand_more),
          onTap: () => setState(() {
            if (open) {
              _open.remove(name);
            } else {
              _open.add(name);
            }
          }),
        ),
        if (open)
          Container(
            color: const Color(0xFFF7FAFC),
            child: Column(
              children: [
                for (final it in items) ...[
                  const Divider(height: 1),
                  _itemTile(it, inset: true),
                ],
              ],
            ),
          ),
        const Divider(height: 1, thickness: 1),
      ],
    );
  }

  Widget _itemTile(SaleItem it, {bool inset = false}) {
    final free = _freeOf(it);
    final held = it.onHand - free;
    return ListTile(
      contentPadding: EdgeInsetsDirectional.only(
          start: inset ? 34 : 16, end: 16),
      dense: inset,
      title: Text(it.name,
          style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text([
        'المتاح: ${_qty(free)}${it.unit != null ? ' ${it.unit}' : ''}',
        if (held > 0.0001) 'محجوز لفواتير معلّقة: ${_qty(held)}',
        if (it.basePrice != null) 'السعر: ${_money(it.basePrice!)}',
      ].join(' · ')),
      trailing: Text(_qty(free),
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: free <= 0 ? AppColors.danger : AppColors.primary,
          )),
    );
  }

  Widget _stat(String label, String value) => Column(
        children: [
          Text(value,
              style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary)),
          Text(label,
              style: const TextStyle(fontSize: 12, color: Colors.black54)),
        ],
      );
}

String _money(double v) => v.toStringAsFixed(2);

String _qty(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}
