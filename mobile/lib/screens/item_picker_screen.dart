import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// Searchable catalog picker. Tapping an item asks for the quantity (points come from the
/// catalog's configured point value) and returns an [InspectionLine].
class ItemPickerScreen extends StatefulWidget {
  const ItemPickerScreen({super.key});

  @override
  State<ItemPickerScreen> createState() => _ItemPickerScreenState();
}

class _ItemPickerScreenState extends State<ItemPickerScreen> {
  final _search = TextEditingController();
  List<CatalogItem> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load([String q = '']) async {
    final items = await LocalDb.instance.catalog(query: q);
    if (mounted) {
      setState(() {
        _items = items;
        _loading = false;
      });
    }
  }

  static String _fmt(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  Future<void> _pick(CatalogItem item) async {
    final qty = TextEditingController(text: '1');
    final points = TextEditingController(text: _fmt(item.points));
    final result = await showDialog<InspectionLine>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: Text(item.name),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: qty,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'الكمية'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: points,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'النقاط للوحدة'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () {
                final q = double.tryParse(qty.text) ?? 0;
                final p = double.tryParse(points.text) ?? 0;
                if (q <= 0) return;
                Navigator.pop(
                    c,
                    InspectionLine(
                        itemId: item.id, itemName: item.name, quantity: q, points: p));
              },
              child: const Text('تم'),
            ),
          ],
        ),
      ),
    );
    if (result != null && mounted) Navigator.pop(context, result);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('اختيار صنف')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _search,
              onChanged: _load,
              decoration: InputDecoration(
                hintText: 'ابحث بإسم الصنف...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _search.clear();
                          _load();
                        },
                      ),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _items.isEmpty
                    ? const Center(
                        child: Text('مفيش أصناف — اعمل «تحديث الأصناف» من القائمة الجانبية'))
                    : ListView.separated(
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (c, i) {
                          final it = _items[i];
                          return ListTile(
                            title: Text(it.name),
                            subtitle: it.category == null ? null : Text(it.category!),
                            trailing: it.points > 0
                                ? Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 10, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: AppColors.accent.withOpacity(0.15),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Text('${_fmt(it.points)} نقطة',
                                        style: const TextStyle(
                                            fontSize: 12, fontWeight: FontWeight.w700)),
                                  )
                                : null,
                            onTap: () => _pick(it),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
