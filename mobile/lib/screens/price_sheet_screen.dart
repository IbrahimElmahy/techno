import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../db/local_db.dart';
import '../models/arabic_sort.dart';
import '../models/models.dart';
import '../theme.dart';

const _noCategory = 'بدون فئة';

String _categoryOf(SaleItem it) {
  final c = it.category?.trim() ?? '';
  return c.isEmpty ? _noCategory : c;
}

/// كشف التسعير — **السعر اللي التاجر ده هيدفعه**، لكل أصناف النظام.
///
/// مش قايمة أسعار عامة. المندوب واقف قدام تاجر بيسأله «الصنف ده بكام؟»، والرقم
/// الصح يعتمد على فئة التاجر وخصم الصنف. الكشف اللي بيعرض سعر واحد للكل بيخلّي
/// المندوب يقول رقم والفاتورة تطلع برقم تاني — فيرجع يشرح، أو أوحش: يوعد بسعر
/// الشركة مابتبيعش بيه.
///
/// **والتنقّل زي منتقي البيع: فئات وبعدين أصنافها.** الكتالوج ٢٬٦٣٠ صنف، وقايمة
/// واحدة بالطول معناها إن المندوب يفضل يمرّر وهو واقف قدام التاجر. اللي اتعوّد على
/// خطوتين في الفاتورة بيلاقي نفس الخطوتين هنا — مش شاشة بتتعلّم من أول.
///
/// **وبيشتغل من غير شبكة.** الكتالوج بأسعاره بينزل مع المزامنة، فالمندوب في السوق
/// بيسعّر صنف مش معاه في العربية أصلاً.
///
/// **والرصيد مش معروض عن قصد.** دي أصناف النظام كله مش اللي في العربية؛ عرض رصيد
/// مخزن جنب السعر بيغرّي ببيع مالوش غطاء عنده. اللي عايز اللي معاه بيفتح «بضاعتي».
///
/// ## عرض السعر — اختيار زي الفاتورة، وأثر صفر
///
/// المندوب بيختار أصناف بكمياتها ويشوف الإجمالي، **زي ما بيعمل فاتورة بالظبط** —
/// بس ده مش مستند:
///
/// * **مابيأثّرش:** مافيش حركة مخزن، ولا قيد، ولا نقط، ولا مديونية على التاجر.
///   مافيش حاجة بتترفع للسيرفر أصلاً؛ العرض عايش في الشاشة وبيروح لما تقفلها.
/// * **ومابيتأثّرش:** مافيش سقف كمية. المندوب بيسعّر ٥٠٠ قطعة من صنف مش معاه ولا
///   قطعة — ده سؤال عن السعر مش عن المتاح. والرصيد والمديونية وحد الائتمان كلهم
///   خارج الحساب: **السعر والخصم بس.**
///
/// الفرق ده هو اللي بيخلّي الشاشة تنفع: اللي بيخاف يجرّب على الفاتورة عشان
/// «مايبوّظش حاجة» بيقدر يجرّب هنا براحته.
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

  /// عرض السعر: صنف ⇐ كمية. **في الذاكرة بس** — مابيتخزّنش ولا بيترفع، فقفل
  /// الشاشة بيمسحه. ده مقصود: العرض مش مستند، وتخزينه بيخلّيه يتلخبط مع الفواتير.
  final Map<int, double> _quote = {};

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
  String get _query => _search.text.trim();

  /// الفئات بعددها — نفس ترتيب منتقي البيع، و«بدون فئة» في الآخر.
  List<MapEntry<String, int>> get _categories {
    final counts = <String, int>{};
    for (final it in _all) {
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

  /// أصناف الفئة المفتوحة. **والبحث بيوسّع على الكل** — اللي بيكتب اسم صنف عايزه
  /// هو، مش عايز يفتكر تحت أنهي فئة اتسجّل.
  List<SaleItem> get _shown {
    final q = _query;
    if (q.isNotEmpty) {
      return _all.where((i) => i.name.contains(q)).toList();
    }
    if (_category == null) return const [];
    return _all.where((i) => _categoryOf(i) == _category).toList();
  }

  double _lineTotal(SaleItem i) => i.netPriceFor(_tier) * (_quote[i.itemId] ?? 0);

  double get _quoteTotal => _all.fold(0, (t, i) => t + _lineTotal(i));

  int get _quoteCount => _quote.length;

  /// بيسأل عن الكمية — **من غير سقف**. الفاتورة بتمنع أكتر من اللي في العربية،
  /// والعرض لأ: التاجر بيسأل «٥٠٠ قطعة بكام» وهو عارف إنها مش معاك دلوقتي.
  Future<void> _askQty(SaleItem item) async {
    final ctrl = TextEditingController(
        text: (_quote[item.itemId] ?? 1).toStringAsFixed(0));
    final qty = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(item.name, style: const TextStyle(fontSize: 16)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: 'الكمية',
            suffixText: item.unit,
            helperText: '${item.netPriceFor(_tier).toStringAsFixed(2)} ج للوحدة',
            border: const OutlineInputBorder(),
          ),
          onSubmitted: (v) =>
              Navigator.pop(ctx, double.tryParse(v.trim()) ?? 0),
        ),
        actions: [
          if (_quote.containsKey(item.itemId))
            TextButton(
              onPressed: () => Navigator.pop(ctx, 0),
              child: const Text('شيله'),
            ),
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
          FilledButton(
            onPressed: () =>
                Navigator.pop(ctx, double.tryParse(ctrl.text.trim()) ?? 0),
            child: const Text('تمام'),
          ),
        ],
      ),
    );
    if (qty == null) return;
    setState(() {
      if (qty > 0) {
        _quote[item.itemId] = qty;
      } else {
        _quote.remove(item.itemId);
      }
    });
  }

  /// نسخة نصية تتبعت للتاجر على واتساب — ده اللي المندوب بيعمله فعلاً بالورقة.
  void _copy() {
    final rows = _shown;
    if (rows.isEmpty) return;
    final head = _customer == null ? 'كشف أسعار' : 'كشف أسعار — ${_customer!.name}';
    final body = rows.map((i) {
      final net = i.netPriceFor(_tier);
      final price = i.priceFor(_tier) > 0 ? '${net.toStringAsFixed(2)} ج' : 'اسأل المكتب';
      return '${i.name}  $price${(i.unit ?? '').isEmpty ? '' : ' / ${i.unit}'}';
    }).join('\n');
    Clipboard.setData(ClipboardData(text: '$head\n\n$body'));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('اتنسخ ${rows.length} صنف — الزقه في أي مكان')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = _shown;
    final inCategory = _query.isEmpty && _category != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(inCategory ? _category! : 'كشف تسعير'),
        leading: inCategory
            // الرجوع من الأصناف للفئات — مش خروج من الشاشة. اللي فتح فئة عايز يغيّرها،
            // ولو الزرار خرّجه بره بيرجع يدخل من أول.
            ? IconButton(
                icon: const Icon(Icons.arrow_forward),
                tooltip: 'الفئات',
                onPressed: () => setState(() => _category = null),
              )
            : null,
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
                _header(),
                const Divider(height: 1),
                Expanded(child: _body(rows)),
              ],
            ),
      // شريط العرض — بيبان لما يبقى فيه أصناف متختارة بس، وبيقول **صراحةً** إنه
      // عرض سعر مش فاتورة. اللي بيقرا إجمالي في شاشة زي الفاتورة بيفتكره فاتورة،
      // والسطر ده هو اللي بيمنع اللبس ده.
      bottomNavigationBar: _quoteCount == 0
          ? null
          : SafeArea(
              child: Material(
                color: AppColors.primary,
                child: InkWell(
                  onTap: _copy,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                    child: Row(
                      children: [
                        IconButton(
                          icon: const Icon(Icons.delete_outline,
                              color: Colors.white70),
                          tooltip: 'فضّي العرض',
                          onPressed: () => setState(_quote.clear),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text('عرض سعر · $_quoteCount صنف',
                                  style: const TextStyle(
                                      color: Colors.white70, fontSize: 12)),
                              Text(
                                '${_quoteTotal.toStringAsFixed(2)} ج',
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 18),
                              ),
                            ],
                          ),
                        ),
                        const Icon(Icons.copy_all_outlined,
                            color: Colors.white, size: 20),
                        const SizedBox(width: 6),
                        const Text('انسخ',
                            style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                ),
              ),
            ),
    );
  }

  Widget _header() => Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
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
                isDense: true,
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
            const SizedBox(height: 8),
            TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'دوّر على صنف في كل الفئات',
                prefixIcon: const Icon(Icons.search),
                border: const OutlineInputBorder(),
                isDense: true,
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () => setState(() => _search.clear()),
                      ),
              ),
            ),
          ],
        ),
      );

  Widget _body(List<SaleItem> rows) {
    // مافيش فئة مفتوحة ومافيش بحث ⇒ شاشة الفئات.
    if (_query.isEmpty && _category == null) {
      final cats = _categories;
      if (cats.isEmpty) {
        return const _Empty(
          title: 'مافيش أصناف على الجهاز',
          hint: 'افتح «مزامنة البيانات» واعمل مزامنة.',
        );
      }
      return Column(
        children: [
          _note('${_all.length} صنف في ${cats.length} فئة · اختار فئة أو دوّر بالاسم'),
          Expanded(
            child: ListView.separated(
              itemCount: cats.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final e = cats[i];
                return ListTile(
                  title: Text(e.key,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text('${e.value}',
                            style: const TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w700)),
                      ),
                      const SizedBox(width: 4),
                      const Icon(Icons.chevron_left, size: 18),
                    ],
                  ),
                  onTap: () => setState(() => _category = e.key),
                );
              },
            ),
          ),
        ],
      );
    }

    if (rows.isEmpty) {
      return const _Empty(title: 'مافيش صنف بالاسم ده', hint: '');
    }
    return Column(
      children: [
        _note(_customer == null
            ? '${rows.length} صنف · السعر الأساسي — اختار تاجر عشان تشوف سعره هو'
            : '${rows.length} صنف · بفئة ${_customer!.name}'
                '${_tier == null ? ' (مالوش فئة — السعر الأساسي)' : ''}'),
        Expanded(
          child: ListView.separated(
            itemCount: rows.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (_, i) => _row(rows[i]),
          ),
        ),
      ],
    );
  }

  Widget _note(String text) => Container(
        width: double.infinity,
        color: AppColors.primary.withValues(alpha: 0.06),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Text(text,
            style: const TextStyle(fontSize: 12.5, color: Colors.black54)),
      );

  Widget _row(SaleItem item) {
    final gross = item.priceFor(_tier);
    final net = item.netPriceFor(_tier);
    final hasDiscount = item.defaultDiscountPct > 0;
    final qty = _quote[item.itemId];
    return ListTile(
      dense: true,
      selected: qty != null,
      selectedTileColor: AppColors.primary.withValues(alpha: 0.06),
      // **مافيش سقف كمية ومافيش فحص رصيد** — ده سؤال عن السعر مش عن المتاح.
      onTap: gross <= 0 ? null : () => _askQty(item),
      title:
          Text(item.name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text([
        if ((item.unit ?? '').isNotEmpty) item.unit!,
        // الفئة بتتعرض في البحث بس — جوّه الفئة هي مكتوبة فوق في العنوان.
        if (_query.isNotEmpty) _categoryOf(item),
        if (qty != null)
          '${qty.toStringAsFixed(0)} × ${net.toStringAsFixed(2)}'
              ' = ${_lineTotal(item).toStringAsFixed(2)} ج',
      ].join(' · ')),
      trailing: gross <= 0
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

class _Empty extends StatelessWidget {
  const _Empty({required this.title, required this.hint});
  final String title;
  final String hint;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title, textAlign: TextAlign.center),
              if (hint.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(hint,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.black45)),
              ],
            ],
          ),
        ),
      );
}
