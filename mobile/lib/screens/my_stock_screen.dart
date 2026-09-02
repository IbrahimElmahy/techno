import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// بضاعتي — اللي في العربية دلوقتي، **مقسّمة بالفئات**.
///
/// السؤال اللي المندوب بيسأله قبل ما ينزل وبعد كل بيعة: «معايا كام؟». وقبل الشاشة دي
/// الإجابة كانت في دماغه أو في ورقة.
///
/// **الفئة الأول والصنف جوّاها** — ٣٢٦ صنف في قايمة واحدة مش قايمة، دي كومة. المندوب
/// اللي بيدوّر على سخان بيعرف فئته وهو بيدوّر، فالمستوى ده بيقصّر الطريق بدل ما يفضل
/// ينزّل. نفس القسمة اللي في منتقي الأصناف بالظبط، عشان الشاشتين يقولوا نفس الحاجة.
///
/// **والبحث بيدوّر في الكل** — لو كتب اسم، الفئات بتتشال والنتايج بتنزل مسطّحة. اللي
/// بيكتب اسم صنف عايز يلاقيه، مش عايز يفتكر هو تحت أنهي فئة.
///
/// **والمتاح هنا ناقص اللي اتباع ولسه ما اترفعش** — نفس القاعدة اللي في شاشة اختيار
/// الصنف. الرقمين بيبانوا مع بعض لما يختلفوا، عشان المندوب يعرف إن فيه بضاعة اتحجزت
/// لفواتير لسه في الطابور، مش إن رصيده نقص من غير سبب.
class MyStockScreen extends StatefulWidget {
  const MyStockScreen({super.key});

  @override
  State<MyStockScreen> createState() => _MyStockScreenState();
}

/// اللمّة اللي بتتحط فيها الأصناف اللي مالهاش فئة — **مابتختفيش**: صنف ناقصة عنه
/// بيانات على السيرفر مش صنف مش موجود في العربية.
const _noCategory = 'بدون فئة';

class _MyStockScreenState extends State<MyStockScreen> {
  final _search = TextEditingController();
  List<SaleItem> _items = [];
  Map<int, double> _free = {};
  bool _loading = true;
  String? _lastPull;

  /// الفئات المفتوحة. الشاشة بتفتح والكل مقفول — نظرة واحدة بتوريه فئاته وعدد كل
  /// واحدة، وهو بيفتح اللي عايزه.
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
    // استعلامين لكل الأصناف بدل اتنين لكل صنف — ٣٢٦ صنف كانوا ٦٥٢ استعلام على القرص
    // قبل ما أول سطر يبان على شاشة تليفون.
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

  /// الفئات ومعاها أصنافها، مرتبة — و«بدون فئة» في الآخر دايماً.
  List<MapEntry<String, List<SaleItem>>> get _byCategory {
    final m = <String, List<SaleItem>>{};
    for (final it in _items) {
      m.putIfAbsent(_categoryOf(it), () => []).add(it);
    }
    final entries = m.entries.toList()
      ..sort((a, b) {
        if ((a.key == _noCategory) != (b.key == _noCategory)) {
          return a.key == _noCategory ? 1 : -1;
        }
        return a.key.compareTo(b.key);
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
                // **«قيمة البضاعة» اتشالت** بطلب صاحب النظام. الرقم كان بيتحسب من
                // سعر القايمة × المتاح، وده مش قيمة العربية: البيع بيمشي بخصم، وفيه
                // أصناف سعرها صفر لسه ماتسعّرتش. رقم كبير على راس الشاشة بيتقري كأنه
                // حقيقة، والمندوب مالوش دعوة بقيمة بضاعته أصلاً — عنده الكميات.
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
                      hintText: 'دوّر باسم الصنف',
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
                                    ? 'مافيش صنف بالاسم ده في عربيتك.'
                                    : 'مافيش بضاعة على الجهاز.\n'
                                        'افتح «مزامنة البيانات» واعمل مزامنة.',
                                textAlign: TextAlign.center),
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          // البحث بيسطّح القايمة: اللي بيكتب اسم صنف عايز يلاقيه، مش
                          // عايز يفتكر هو تحت أنهي فئة.
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

  /// الفئة: اسمها، وعدد أصنافها، ومجموع الكميات اللي فيها. بتتفتح بضغطة.
  Widget _categoryTile(String name, List<SaleItem> items) {
    final open = _open.contains(name);
    // مجموع الكميات مش قيمة — كام قطعة في الفئة دي. ده الرقم اللي بيفيد المندوب وهو
    // بيبص على العربية، والوحدات بتختلف من صنف لصنف فمافيش وحدة واحدة تتكتب جنبه.
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
            if (out > 0) '$out خلص',
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
    // الفرق بين اللي في العربية واللي متاح = بضاعة محجوزة لفواتير في الطابور.
    // بتتقال بدل ما الرقم ينقص في صمت.
    final held = it.onHand - free;
    return ListTile(
      contentPadding: EdgeInsetsDirectional.only(
          start: inset ? 34 : 16, end: 16),
      dense: inset,
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
