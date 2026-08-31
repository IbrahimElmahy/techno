import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// اختيار صنف من العربية — **خطوتين: الفئة الأول، وبعدها أصناف الفئة**.
///
/// ٣٢٦ صنف في قايمة واحدة على شاشة تليفون كومة مش قايمة: المندوب بيفضل يسحب بإبهامه وهو
/// واقف عند العميل. الفئة بتقسم الكومة لحاجات قدها، والبحث بيفضل موجود لمين عارف اسم
/// اللي هو عايزه.
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
  /// اللمّة اللي بتتحط فيها الأصناف اللي مالهاش فئة. الأصناف دي **مابتختفيش** — صنف
  /// ناقصة عنه بيانات على السيرفر مش صنف مش موجود في العربية.
  static const _noCategory = 'بدون فئة';

  final _search = TextEditingController();
  List<SaleItem> _items = const [];
  Map<int, double> _available = const {};
  bool _loading = true;

  /// الفئة المفتوحة دلوقتي. `null` = واقفين على قايمة الفئات.
  String? _openCategory;

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

  /// القراءة من القرص بتحصل **مرة واحدة**، والفلترة بعد كده في الذاكرة.
  ///
  /// المتاح مابيتغيّرش والشاشة مفتوحة (مافيش فاتورة بتتحفظ من ورا دي)، فقراءة الـ٣٢٦
  /// صنف من الأول مع كل حرف بيتكتب في خانة البحث كانت شغل مالوش لازمة على تليفون.
  Future<void> _load() async {
    final items = await LocalDb.instance.saleItems();
    final free = await LocalDb.instance.availableForSaleAll();
    if (!mounted) return;
    setState(() {
      _items = items;
      _available = {
        for (final it in items)
          it.itemId:
              (free[it.itemId] ?? 0) - (widget.alreadyOnInvoice[it.itemId] ?? 0)
      };
      _loading = false;
    });
  }

  /// اسم الفئة زي ما المندوب هيقراه.
  ///
  /// القيمة المتخزّنة على السيرفر متولّدة من اسم الفئة بتحويل المسافات لشرطة سفلية،
  /// فالشرطة دي شكل مش معنى — بترجع مسافة عشان تطلع «سخانات كهرباء» مش «سخانات_كهرباء».
  String _categoryOf(SaleItem it) {
    final c = it.category?.trim() ?? '';
    // السيرفر بقى بيبعت **اسم** الفئة زي ما المكتب شايفه، مش قيمتها المخزّنة —
    // فمافيش تحويل «_» لمسافة هنا. التحويل ده كان بيصيب مع فئات a5 (قيمتها فيها
    // مسافات أصلاً) ويغلط مع أي فئة اتغيّر اسمها من الإعدادات: التليفون كان هيفضل
    // على الاسم القديم للأبد.
    return c.isEmpty ? _noCategory : c;
  }

  bool get _searching => _search.text.trim().isNotEmpty;

  /// **البحث بيدوّر في كل الأصناف، مش في الفئة المفتوحة.**
  ///
  /// اللي بيكتب اسم صنف عايز يلاقيه. لو البحث اتحبس في الفئة اللي هو واقف فيها، كان
  /// هيشوف «مافيش نتيجة» على صنف موجود في عربيته بس متسجّل تحت فئة تانية — وده أوحش من
  /// قايمة طويلة، لأنه بيكدب عليه.
  List<SaleItem> get _visibleItems {
    if (_searching) {
      final q = _search.text.trim().toLowerCase();
      return [
        for (final it in _items)
          if (it.name.toLowerCase().contains(q)) it
      ];
    }
    // فئة واحدة (أو ولا فئة، زي قبل أول مزامنة) = مافيش مستوى فئات أصلاً، فالقايمة
    // بتوري كل الأصناف بدل ما ترجع فاضية ومنتظرة اختيار مالوش وجود.
    if (_openCategory == null) {
      return _categories.length > 1 ? const <SaleItem>[] : _items;
    }
    return [
      for (final it in _items)
        if (_categoryOf(it) == _openCategory) it
    ];
  }

  /// الفئات اللي **معاه أصناف فيها فعلاً** ومعاها العدد — مش قايمة ثابتة من الإعدادات.
  /// فئة فاضية في قايمة المندوب معناها ضغطة بتوديه على شاشة فاضية.
  List<MapEntry<String, int>> get _categories {
    final counts = <String, int>{};
    for (final it in _items) {
      counts.update(_categoryOf(it), (n) => n + 1, ifAbsent: () => 1);
    }
    return counts.entries.toList()
      ..sort((a, b) {
        // «بدون فئة» آخر القايمة — دي لمّة مش فئة.
        if ((a.key == _noCategory) != (b.key == _noCategory)) {
          return a.key == _noCategory ? 1 : -1;
        }
        return a.key.compareTo(b.key);
      });
  }

  /// فئة كل اللي فيها خلص — بيتقال على بابها بدل ما يدخل ويلاقي كله مقفول.
  bool _categoryAllOut(String category) => !_items.any(
      (it) => _categoryOf(it) == category && (_available[it.itemId] ?? 0) > 0);

  /// خطوة واحدة لورا: البحث الأول، وبعده الفئة، وبعد كده بس الشاشة تتقفل.
  ///
  /// اللي دوّر وهو جوّه فئة لازم يرجع للفئة اللي كان فيها — مش يتقفل عليه المنتقي كله
  /// ويرجع للفاتورة يبدأ من الأول.
  void _stepBack() => setState(() {
        if (_searching) {
          _search.clear();
          return;
        }
        _openCategory = null;
      });

  @override
  Widget build(BuildContext context) {
    final searching = _searching;
    final inCategory = _openCategory != null;
    return PopScope(
      // زرار الرجوع بتاع التليفون بياخد نفس الخطوة الواحدة.
      canPop: !searching && !inCategory,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && mounted) _stepBack();
      },
      child: Scaffold(
        appBar: AppBar(
          // وهو بيدوّر، القايمة بتعدّي الفئات كلها — فاسم الفئة المفتوحة على الشريط كان
          // هيقول إن دي نتايجها هي، وهي مش بتاعتها.
          title: Text(searching
              ? 'نتايج البحث'
              : (inCategory ? _openCategory! : 'اختر صنف من العربية')),
          leading: searching || inCategory
              ? IconButton(
                  icon: const BackButtonIcon(),
                  tooltip: searching ? 'امسح البحث' : 'رجوع للفئات',
                  onPressed: _stepBack,
                )
              : null,
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                controller: _search,
                // مافيش قراءة من القرص هنا — الفلترة في الذاكرة على اللي اتحمّل مرة.
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'دوّر باسم الصنف في كل الفئات',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _searching
                      ? IconButton(
                          icon: const Icon(Icons.clear),
                          tooltip: 'امسح البحث',
                          onPressed: () {
                            _search.clear();
                            setState(() {});
                          },
                        )
                      : null,
                ),
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_items.isEmpty) {
      return const _Empty(
          'مافيش أصناف في العربية.\nاسحب البيانات من شاشة المزامنة الأول.');
    }
    // فئة واحدة بس = مافيش سؤال. قبل أول مزامنة الفئة بتبقى فاضية على كل الأصناف،
    // فالشاشة كانت هتوري فولدر واحد اسمه «بدون فئة» جوّاه الـ٣٢٦ — نفس الكومة
    // القديمة وضغطة زيادة. ونفس الحالة للمندوب اللي في الشارع ومش قادر يزامن.
    if (!_searching && _openCategory == null && _categories.length > 1) {
      return _categoryList();
    }

    final items = _visibleItems;
    if (items.isEmpty) {
      return _Empty(_searching
          ? 'مافيش صنف اسمه «${_search.text.trim()}» في العربية.'
          : 'مافيش أصناف في الفئة دي.');
    }
    return _itemList(items);
  }

  Widget _categoryList() {
    final cats = _categories;
    return ListView.separated(
      itemCount: cats.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final name = cats[i].key;
        final allOut = _categoryAllOut(name);
        return ListTile(
          leading: Icon(Icons.folder_outlined,
              color: allOut ? Colors.black26 : AppColors.primary),
          title: Text(name,
              style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: allOut ? Colors.black45 : null)),
          subtitle:
              Text(allOut ? 'كله خلص من العربية' : _countLabel(cats[i].value)),
          // الشاشة عربية، فاللي بيفتح بيفتح ناحية الشمال.
          trailing: const Icon(Icons.chevron_left),
          onTap: () => setState(() => _openCategory = name),
        );
      },
    );
  }

  Widget _itemList(List<SaleItem> items) {
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final it = items[i];
        final free = _available[it.itemId] ?? 0;
        final out = free <= 0;
        // السعر والخصم الثابت جنب الصنف — الاختيار بيتعمل على أساسهم، ومن غيرهم المندوب
        // بيضيف الصنف عشان يشوف بكام وبعدين يشيله.
        final detail = out
            ? 'خلص من العربية'
            : [
                'المتاح: ${_qty(free)}${it.unit != null ? ' ${it.unit}' : ''}',
                'السعر: ${_money(it.priceFor(widget.priceTier))}',
                if (it.defaultDiscountPct > 0)
                  'خصم ثابت: ${_qty(it.defaultDiscountPct)}%',
              ].join(' · ');
        return ListTile(
          enabled: !out,
          isThreeLine: _searching,
          title: Text(it.name,
              style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: out ? Colors.black38 : null)),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(detail),
              // في نتيجة بحث بتعدّي الفئات، الفئة بتتقال — عشان اللي شايف صنفين بأسماء
              // متقاربة يعرف كل واحد بتاع إيه.
              if (_searching)
                Text(_categoryOf(it),
                    style: const TextStyle(fontSize: 12, color: Colors.black54)),
            ],
          ),
          trailing: out
              ? const Chip(
                  label: Text('خلص'),
                  backgroundColor: Color(0xFFF1F1F1),
                  visualDensity: VisualDensity.compact)
              : const Icon(Icons.add_circle_outline, color: AppColors.primary),
          // الرجوع زي ما هو: الشاشة بترجّع `SaleItem` للي نداها.
          onTap: out ? null : () => Navigator.pop(context, it),
        );
      },
    );
  }
}

class _Empty extends StatelessWidget {
  final String text;
  const _Empty(this.text);

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(text, textAlign: TextAlign.center),
        ),
      );
}

/// «صنف واحد» و«صنفين» و«٣ أصناف» — المثنى الغلط بيوقّف العين على قايمة المفروض تتعدّى بسرعة.
String _countLabel(int n) {
  if (n == 1) return 'صنف واحد';
  if (n == 2) return 'صنفين';
  if (n <= 10) return '$n أصناف';
  return '$n صنف';
}

/// كمية من غير أصفار مالهاش لازمة — «٣» أوضح من «٣٫٠٠٠» في قايمة بتتقرا بسرعة.
String _qty(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}

String _money(double v) => v.toStringAsFixed(2);
