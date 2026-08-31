import 'dart:math';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'invoice_print_screen.dart';
import 'sale_item_picker_screen.dart';

/// فاتورة بيع من العربية.
///
/// المندوب بيبيع وهو واقف عند العميل، وغالباً من غير شبكة. فالفاتورة بتتكتب على الجهاز
/// وبتتحفظ في طابور، وبترفع لما الشبكة تيجي — نفس طريقة المعاينات واستلام الكوبونات.
///
/// **والقواعد كلها في السيرفر، مش هنا.** السيرفر بيرفض البيع لعميل مش بتاع المندوب،
/// وبيرفض البيع من غير عهدته هو. اللي في الشاشة دي نسخة من نفس القواعد عشان المندوب
/// يعرف وهو في الشارع، مش بديل عنها: الجهاز ممكن يكون بياناته قديمة، والسيرفر هو اللي
/// عنده الحقيقة ساعة الترحيل.
class SaleInvoiceScreen extends StatefulWidget {
  const SaleInvoiceScreen({super.key});

  @override
  State<SaleInvoiceScreen> createState() => _SaleInvoiceScreenState();
}

class _SaleInvoiceScreenState extends State<SaleInvoiceScreen> {
  CustomerRef? _customer;

  /// خط المنتجات اللي الفاتورة عليه — «أبيض» أو «بولي».
  ///
  /// العميل الواحد ممكن يبقى مديون على الخطين بحسابين منفصلين، فالفاتورة لازم تقول على
  /// أنهي واحد بتنزل. اللي عنده خط واحد بيتحدّد لوحده — سؤال إجابته واحدة مش سؤال.
  String? _family;

  /// خطوط المنتجات لما العميل مالوش حسابات مقسومة.
  ///
  /// «نوع الفاتورة» سؤالين في واحد: خط المنتجات اللي بيتكتب على المستند، والحساب
  /// اللي الفلوس بتترحّل عليه. للعميل المقسوم هما نفس السؤال؛ للعادي الأول له معنى
  /// والتاني مالوش غير إجابة واحدة. فالسؤال بيتسأل للاتنين، ومصدر الخيارات بيفرق.
  static const _kFamilies = ['أبيض', 'بولي'];

  List<String> get _familyChoices {
    final fams = _customer?.families ?? const <String>[];
    return fams.length > 1 ? fams : _kFamilies;
  }
  /// تاريخ الفاتورة = النهارده، وبيتقرا **لحظة الحفظ** مش لحظة فتح الشاشة.
  ///
  /// المندوب بيسيب التطبيق مفتوح؛ لو التاريخ اتثبّت وقت الفتح، اللي بيبيع الصبح بعد
  /// ليلة مفتوحة بيكتب فاتورة بتاريخ امبارح — وده يوم محاسبي تاني، والفرق مابيبانش
  /// غير في تقرير آخر الشهر.
  DateTime get _date => DateTime.now();
  final _notes = TextEditingController();
  final _cash = TextEditingController(text: '0');
  final List<SaleDraftLine> _lines = [];
  bool _saving = false;

  /// خانة الكمية بتاعة كل سطر — بالـ`itemId` مش بالترتيب.
  ///
  /// الترتيب بيتغيّر لما سطر في النص يتمسح، والكنترولر لازم يفضل ماشي مع صنفه هو.
  /// وهي كنترولر مش `initialValue` عشان زراير − و+ تغيّر الرقم المكتوب في الخانة؛
  /// `initialValue` بتتقرا مرة واحدة وبعدها الخانة بتفضل بترينا رقم قديم.
  final Map<int, TextEditingController> _qtyCtl = {};

  /// السطور اللي التفاصيل (السعر والخصومات) مفتوحة عليها — بالـ`itemId` برضه.
  ///
  /// السطر المقفول بيبقى صفّين: الاسم والإجمالي فوق، والكمية والسعر تحت. الفاتورة
  /// اللي فيها ٢٠ صنف كانت ٢٠ كارت بأربع صفوف وستّ خانات إدخال — طول لا ينتهي.
  final Set<int> _openLines = {};

  final _scroll = ScrollController();

  /// `null` = سيب الترويسة تقرّر لوحدها. المندوب لو ضغط، رأيه هو اللي بيمشي.
  bool? _headerOpenOverride;

  /// الترويسة بتفضل مفتوحة طول ما فيه سؤال من غير إجابة (عميل أو نوع فاتورة)،
  /// وبتتلمّ في سطر واحد أول ما الاتنين يتحدّدوا — عشان السطور تاخد الشاشة.
  bool get _headerOpen =>
      _headerOpenOverride ?? (_customer == null || _family == null);

  @override
  void dispose() {
    _notes.dispose();
    _cash.dispose();
    _scroll.dispose();
    for (final c in _qtyCtl.values) {
      c.dispose();
    }
    super.dispose();
  }

  double get _total => _lines.fold(0.0, (t, l) => t + l.net);
  double get _cashAmount => double.tryParse(_cash.text.trim()) ?? 0;
  double get _credit => max(0, _total - _cashAmount);

  Future<void> _pickCustomer() async {
    final picked = await showModalBottomSheet<CustomerRef>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _CustomerSheet(),
    );
    if (picked == null) return;
    setState(() {
      _customer = picked;
      // خط واحد ⇒ اتحدّد لوحده. أكتر من واحد ⇒ المندوب بيختار. ولا واحد ⇒ الفاتورة
      // بتنزل على المديونية كلها زي ما كانت بتعمل قبل ما الخطوط تتعرف أصلاً.
      // حساب واحد باسم ⇒ مافيش سؤال. غير كده الخانة بتفضل فاضية لحد ما يختار.
      _family = picked.families.length == 1 ? picked.families.first : null;
      // فئة العميل بتقرّر السعر، فالسطور اللي اتكتبت قبل ما يتحدّد بتتسعّر من جديد عليه.
      for (var i = 0; i < _lines.length; i++) {
        _lines[i].unitPrice = _lines[i].unitPrice;
      }
    });
    _repriceAll();
  }

  Future<void> _repriceAll() async {
    if (_customer == null) return;
    final items = await LocalDb.instance.saleItems();
    final byId = {for (final it in items) it.itemId: it};
    setState(() {
      for (final l in _lines) {
        final it = byId[l.itemId];
        if (it != null) {
          l.unitPrice = it.priceFor(_customer!.priceTier);
          // الخصم الثابت بيتبع الصنف برضه — بس المتغيّر بتاع المندوب مابيتلمسش.
          l.fixedDiscountPct = it.defaultDiscountPct;
        }
      }
    });
  }

  /// **الأصناف بتتفتح من غير ما العميل يتحدّد.**
  ///
  /// كانت بتقول «اختار العميل الأول» وتقفل الباب. والسعر فعلاً بيعتمد على فئة العميل —
  /// بس ده مش سبب يمنعه يشوف اللي معاه: المندوب بيبص على العربية وهو بيتكلّم، والعميل
  /// أحياناً بيتحدّد بعد ما يشوف الموجود. فالسعر بيتعرض بالأساسي، وأول ما العميل يتحدّد
  /// السطور بتتسعّر من جديد على فئته (`_repriceAll`).
  Future<void> _addItem() async {
    final onInvoice = {for (final l in _lines) l.itemId: l.quantity};
    final picked = await Navigator.push<SaleItem>(
      context,
      MaterialPageRoute(builder: (_) => SaleItemPickerScreen(
          alreadyOnInvoice: onInvoice, priceTier: _customer?.priceTier)),
    );
    if (picked == null) return;
    final existing = _lines.indexWhere((l) => l.itemId == picked.itemId);
    setState(() {
      if (existing >= 0) {
        _lines[existing].quantity += 1;
        // الرقم اتغيّر في الموديل — والخانة عندها كنترولر، فلازم تتبلّغ.
        _syncQtyField(_lines[existing]);
      } else {
        _lines.add(SaleDraftLine(
          itemId: picked.itemId,
          itemName: picked.name,
          quantity: 1,
          // السعر والخصم من الصنف — الواحد بيراجع رقم، مش بيخترعه.
          unitPrice: picked.priceFor(_customer?.priceTier),
          // الثابت من الصنف، والمتغيّر بيبتدي صفر — ده اللي المندوب بيزوّده بإيده.
          fixedDiscountPct: picked.defaultDiscountPct,
          variableDiscountPct: 0,
        ));
      }
    });
  }

  /// بتتأكد إن كل سطر لسه جوّه المتاح — بيتقاس وقت الحفظ كمان مش عند الإضافة بس، لأن
  /// الكمية بتتعدّل بالإيد بعد ما السطر يتضاف.
  Future<String?> _overCustody() async {
    for (final l in _lines) {
      final free = await LocalDb.instance.availableForSale(l.itemId);
      if (l.quantity > free + 0.0001) {
        return '${l.itemName}: المتاح في العربية ${_qty(free)} بس.';
      }
    }
    return null;
  }

  Future<void> _save() async {
    if (_customer == null) return _say('اختر العميل');
    if (_family == null) {
      // الفاتورة اللي مش قايلة على أنهي خط بتتكتب من غير هوية، والعميل المقسوم بتوزّع
      // رقمه على الاتنين بالنسبة — وكشف حسابه بعدها مايقولش حاجة مفهومة. السؤال هنا
      // أرخص من التصحيح بعدين.
      return _say('اختر نوع الفاتورة — أبيض أو بولي');
    }
    if (_lines.isEmpty) return _say('ضيف صنف واحد على الأقل');
    if (_lines.any((l) => l.quantity <= 0)) return _say('في سطر كميته صفر');
    final over = await _overCustody();
    if (over != null) return _say(over);
    if (_cashAmount > _total + 0.0001) {
      return _say('المدفوع أكبر من الفاتورة');
    }

    setState(() => _saving = true);
    try {
      // رقم الجهاز بيتولد **هنا مرة واحدة** ومابيتغيّرش مهما اتعادت المزامنة — هو اللي
      // بيخلّي السيرفر يعرف الفاتورة دي لو الرفع اتعاد بعد انقطاع.
      final uuid = 'inv-${DateTime.now().microsecondsSinceEpoch}-'
          '${Random().nextInt(1 << 32).toRadixString(16)}';
      final localId = await LocalDb.instance.saveSaleInvoice(
        clientUuid: uuid,
        customerId: _customer!.id,
        customerName: _customer!.name,
        family: _family,
        invoiceDate: _date.toIso8601String().substring(0, 10),
        cashAmount: _cashAmount,
        creditAmount: _credit,
        total: _total,
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        lines: _lines,
      );
      if (!mounted) return;
      // محاولة رفع سريعة — بسقف ٨ ثواني.
      //
      // الفاتورة محفوظة خلاص، والرفع ده مكسب زيادة: لو الشبكة موجودة بيجيب رقم المستند
      // فيطلع على الورقة. ولو مافيش شبكة، `SocketException` بترجع على طول ومحدش بيستنى.
      //
      // **والسقف مقصود.** الرفع العادي مهلته ٩٠ ثانية عشان الشبكة الضعيفة تعدّي؛ لكن هنا
      // المندوب واقف بيتفرّج على «بيحفظ…» والعميل مستني الورقة. شبكة زفت مش سبب يوقّفه —
      // الطابور بيرفع في المزامنة على مهله.
      var pushed = false;
      try {
        pushed = await ApiClient.instance
                .pushSaleInvoices()
                .timeout(const Duration(seconds: 8), onTimeout: () => 0) >
            0;
      } catch (_) {/* الطابور بيحاول تاني في شاشة المزامنة */}
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(pushed ? 'الفاتورة اترفعت ✔' : 'الفاتورة اتحفظت — هترفع مع المزامنة'),
        backgroundColor: AppColors.success,
      ));
      // الطباعة على طول بعد الحفظ: المندوب لسه واقف عند العميل، والورقة دي سببها.
      // الصف بيتقرا من القاعدة عشان الورقة تشيل رقم المستند لو الرفع نجح دلوقتي.
      final rows = await LocalDb.instance.saleInvoices();
      final saved = rows.firstWhere((r) => r['local_id'] == localId, orElse: () => {});
      if (!mounted) return;
      if (saved.isNotEmpty) {
        await Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => InvoicePrintScreen(invoice: saved)),
        );
      }
      if (!mounted) return;
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) _say('تعذّر الحفظ: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _say(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  /// بتحرّك الكمية بالزراير — و`max` عشان مافيش سالب.
  ///
  /// الحد الأدنى صفر بس، مش واحد: السطر بصفر لسه بيترفض عند الحفظ زي ما كان
  /// («في سطر كميته صفر»)، والمندوب اللي بينزّل لحد الصفر غالباً قصده يمسح السطر.
  void _bumpQty(SaleDraftLine l, double delta) {
    setState(() => l.quantity = max(0.0, l.quantity + delta));
    _syncQtyField(l);
  }

  void _syncQtyField(SaleDraftLine l) {
    final c = _qtyCtl[l.itemId];
    if (c == null) return;
    final t = _trim(l.quantity);
    if (c.text != t) c.text = t;
  }

  /// الحذف بيسأل الأول.
  ///
  /// سلة جنب خانة الكمية في سطر مضغوط = ضغطة غلط بتودّي صنف. والصنف اللي طار
  /// مابيبانش غير عند مراجعة الإجمالي — لو حد راجعه. السؤال أرخص من كده.
  Future<void> _removeLine(SaleDraftLine l) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('حذف السطر'),
        content: Text('تشيل «${l.itemName}» من الفاتورة؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('رجوع')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('احذف'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    // بالهوية مش بالترتيب — الترتيب ممكن يكون اتغيّر والحوار مفتوح.
    final i = _lines.indexOf(l);
    if (i < 0) return;
    setState(() {
      _lines.removeAt(i);
      _openLines.remove(l.itemId);
      _qtyCtl.remove(l.itemId)?.dispose();
    });
  }

  void _toggleHeader() {
    setState(() => _headerOpenOverride = !_headerOpen);
    // التفاصيل بتتفتح فوق القايمة، فلو المندوب كان في نص السطور مش هيشوف حاجة
    // اتفتحت. الرجوع لأول القايمة بيخلّي الفتحة تبان.
    if (_headerOpen) _scrollTo(0);
  }

  void _scrollTo(double offset) {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(offset,
        duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('فاتورة بيع')),
      // عمود، مش `ListView` واحدة للشاشة كلها.
      //
      // كانت الترويسة والسطور والإجماليات كلهم في قايمة واحدة بتلفّ: مع ٢٠ صنف
      // الإجمالي بيبقى تحت خالص، والمندوب بيلفّ لتحت عشان يقرا رقم هو محتاجه وهو
      // واقف بيتكلّم. دلوقتي السطور بس هي اللي بتلفّ — الترويسة مثبّتة فوق
      // والإجمالي وزرار الحفظ مثبّتين تحت.
      body: Column(
        children: [
          _headerStrip(),
          const Divider(height: 1),
          Expanded(child: _linesList()),
        ],
      ),
      bottomNavigationBar: _bottomBar(),
    );
  }

  /// سطر الترويسة المضغوط — بيفضل مثبّت فوق مهما طالت القايمة.
  ///
  /// وزرار «صنف» جوّاه مش فوق القايمة: الإضافة هي الحاجة اللي بتتعمل عشرين مرة،
  /// فماينفعش تكون محتاجة لفّة لفوق كل مرة.
  Widget _headerStrip() {
    final missing = _customer == null || _family == null;
    final bits = <String>[
      if (_family != null) _family!,
      if (_customer?.priceTier != null) 'فئة ${_customer!.priceTier}',
      _date.toIso8601String().substring(0, 10),
      if (_lines.isNotEmpty) '${_lines.length} صنف',
    ];
    final sub = _customer == null
        ? 'اضغط للاختيار'
        : (_family == null ? 'اختار نوع الفاتورة' : bits.join(' · '));
    return Material(
      color: Colors.white,
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              onTap: _toggleHeader,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                child: Row(
                  children: [
                    Icon(missing ? Icons.error_outline : Icons.person_outline,
                        size: 20, color: missing ? AppColors.danger : AppColors.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_customer?.name ?? 'اختار العميل',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w700, fontSize: 14)),
                          Text(sub,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 11,
                                  color: missing ? AppColors.danger : Colors.black54)),
                        ],
                      ),
                    ),
                    Icon(_headerOpen ? Icons.expand_less : Icons.expand_more,
                        size: 20, color: Colors.black45),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(0, 6, 10, 6),
            child: FilledButton.icon(
              onPressed: _addItem,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('صنف'),
              // مقاس صريح — الافتراضي في الثيم ٥٠ ارتفاع، وده بيكبّر السطر
              // المضغوط. و**مش** `Size.fromHeight` جوّه `Row`: عرض لانهائي.
              style: FilledButton.styleFrom(
                minimumSize: const Size(72, 40),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// تفاصيل الترويسة — العميل والخط والتاريخ. بتلفّ مع القايمة، مش مثبّتة، عشان
  /// الكيبورد ما يزقّهاش على السطور.
  Widget _headerDetails() {
    return Card(
      margin: const EdgeInsets.fromLTRB(8, 8, 8, 4),
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.person_outline, color: AppColors.primary),
            title: Text(_customer?.name ?? 'اختار العميل'),
            subtitle: Text(_customer == null
                ? 'عملاءك انت بس'
                : [
                    if (_customer!.phone != null) _customer!.phone!,
                    if (_customer!.priceTier != null) 'فئة ${_customer!.priceTier}',
                    if (_family != null) 'حساب $_family',
                  ].join(' · ')),
            trailing: const Icon(Icons.chevron_left),
            onTap: _pickCustomer,
          ),
          if (_customer != null) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('نوع الفاتورة (الخط)',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final f in _familyChoices)
                        ChoiceChip(
                          label: Text(f),
                          selected: _family == f,
                          onSelected: (_) => setState(() => _family = f),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
          const Divider(height: 1),
          // تاريخ الفاتورة عرض بس — النهارده ومفيش غيره.
          //
          // كان بيسمح بأي يوم لحد ٦٠ يوم ورا. المندوب في الشارع بيكتب اللي باعه
          // دلوقتي، وتاريخ قديم بيحطّ البيعة في يوم مقفول أو في شهر اتقفلت
          // حساباته — والفرق مابيبانش غير في تقرير آخر الشهر لما الأرقام
          // ماتطبقش. اللي محتاج يأرّخ بأثر رجعي بيعملها من الويب، هناك اللي
          // بيعملها محاسب شايف الدفاتر.
          ListTile(
            leading: const Icon(Icons.event_outlined, color: AppColors.primary),
            title: const Text('تاريخ الفاتورة'),
            subtitle: Text(_date.toIso8601String().substring(0, 10)),
            trailing: const Icon(Icons.lock_outline, size: 18, color: Colors.black38),
            enabled: false,
          ),
        ],
      ),
    );
  }

  Widget _linesList() {
    return ListView(
      controller: _scroll,
      padding: const EdgeInsets.only(bottom: 12),
      children: [
        if (_headerOpen) _headerDetails(),
        if (_lines.isEmpty)
          const Padding(
            padding: EdgeInsets.all(28),
            child: Text('مافيش أصناف على الفاتورة لسه.\nاضغط «صنف» فوق عشان تضيف.',
                textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
          )
        else
          for (var i = 0; i < _lines.length; i++) _lineTile(i),
        _paymentCard(),
      ],
    );
  }

  /// السطر المضغوط: الاسم · الكمية · السعر · الإجمالي في صفّين.
  ///
  /// السعر والخصومات جوّه فتحة بتتفتح بالضغط على السطر — لأنها بتتغيّر في سطر من
  /// كل عشرة، ومش مستاهلة تاخد مكان دايم في كل سطر.
  Widget _lineTile(int i) {
    final l = _lines[i];
    final open = _openLines.contains(l.itemId);
    // مفتاح بالصنف عشان حالة الخانات تفضل مع سطرها لو اتمسح سطر من النص.
    final ctl = _qtyCtl.putIfAbsent(
        l.itemId, () => TextEditingController(text: _trim(l.quantity)));
    final priceBits = StringBuffer('× ${_trim(l.unitPrice)} ج.م');
    if (l.discountPct > 0) priceBits.write(' · خصم ${_trim(l.discountPct)}%');
    return Card(
      key: ValueKey(l.itemId),
      margin: const EdgeInsets.fromLTRB(8, 4, 8, 0),
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() =>
                open ? _openLines.remove(l.itemId) : _openLines.add(l.itemId)),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
              child: Column(
                children: [
                  Row(
                    children: [
                      SizedBox(
                        width: 22,
                        child: Text('${i + 1}',
                            style: const TextStyle(fontSize: 11, color: Colors.black38)),
                      ),
                      Expanded(
                        child: Text(l.itemName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontWeight: FontWeight.w700, fontSize: 14)),
                      ),
                      const SizedBox(width: 6),
                      Text(_money(l.net),
                          style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                              color: AppColors.primary)),
                      Icon(open ? Icons.expand_less : Icons.expand_more,
                          size: 18, color: Colors.black38),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      _qtyStepper(l, ctl),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(priceBits.toString(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: Colors.black54)),
                      ),
                      // سلة صريحة — بس بمقاس وحدود مضبوطة.
                      //
                      // `IconButton` بمقاسه الافتراضي (٤٨) جنب خانة الكمية بيطلع
                      // برّه الصف فيتقصّ: بيترسم تمام وبيبلع الضغطات. الحدود هنا
                      // بتخلّيه جوّه المساحة اللي مسموح له بيها.
                      IconButton(
                        icon: const Icon(Icons.delete_outline,
                            size: 20, color: AppColors.danger),
                        tooltip: 'حذف السطر',
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints.tightFor(width: 36, height: 36),
                        visualDensity: VisualDensity.compact,
                        onPressed: () => _removeLine(l),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (open) _lineDetails(l),
        ],
      ),
    );
  }

  /// الكمية بتتعدّل من السطر نفسه: زراير ± للسرعة، والخانة للكسور.
  Widget _qtyStepper(SaleDraftLine l, TextEditingController ctl) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.black12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _stepButton(Icons.remove, () => _bumpQty(l, -1)),
          SizedBox(
            width: 52,
            child: TextField(
              controller: ctl,
              textAlign: TextAlign.center,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
              decoration: const InputDecoration(
                isDense: true,
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(vertical: 6),
              ),
              onChanged: (t) =>
                  setState(() => l.quantity = double.tryParse(t.trim()) ?? 0),
            ),
          ),
          _stepButton(Icons.add, () => _bumpQty(l, 1)),
        ],
      ),
    );
  }

  Widget _stepButton(IconData icon, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Icon(icon, size: 18, color: AppColors.primary),
      ),
    );
  }

  Widget _lineDetails(SaleDraftLine l) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
      child: Column(
        children: [
          const Divider(height: 10),
          Row(
            children: [
              Expanded(
                child: _numField(
                  label: 'سعر الوحدة',
                  value: l.unitPrice,
                  onChanged: (v) => setState(() => l.unitPrice = v),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _numField(
                  label: 'خصم ثابت %',
                  value: l.fixedDiscountPct,
                  onChanged: (v) => setState(() => l.fixedDiscountPct = v),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _numField(
                  label: 'خصم إضافي %',
                  value: l.variableDiscountPct,
                  onChanged: (v) => setState(() => l.variableDiscountPct = v),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('إجمالي الخصم',
                        style: TextStyle(fontSize: 11, color: Colors.black54)),
                    Text('${_trim(l.discountPct)}%',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _numField({
    required String label,
    required double value,
    required void Function(double) onChanged,
  }) {
    return TextFormField(
      initialValue: _trim(value),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textAlign: TextAlign.center,
      decoration: InputDecoration(labelText: label, isDense: true),
      onChanged: (t) => onChanged(double.tryParse(t.trim()) ?? 0),
    );
  }

  /// الدفع والملاحظات في آخر القايمة — بيتكتبوا مرة واحدة في آخر الفاتورة،
  /// فمش محتاجين يقعدوا على الشاشة. والرقم اللي بيتقري كتير (الإجمالي والباقي)
  /// مثبّت تحت.
  Widget _paymentCard() {
    return Card(
      margin: const EdgeInsets.fromLTRB(8, 10, 8, 8),
      color: const Color(0xFFF3F8FB),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('الدفع',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            TextField(
              controller: _cash,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'المدفوع نقداً',
                suffixText: 'ج.م',
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 10),
            _totalRow('إجمالي الفاتورة', _money(_total)),
            const SizedBox(height: 6),
            _totalRow('الباقي على العميل', _money(_credit)),
            const SizedBox(height: 10),
            TextField(
              controller: _notes,
              decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _totalRow(String label, String value, {bool big = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(fontSize: big ? 15 : 14, color: Colors.black54)),
        Text('$value ج.م',
            style: TextStyle(
                fontSize: big ? 22 : 16,
                fontWeight: FontWeight.w800,
                color: big ? AppColors.primary : Colors.black87)),
      ],
    );
  }

  /// الشريط المثبّت تحت: الإجمالي والباقي وزرار الحفظ. مهما طالت القايمة.
  ///
  /// والضغط على الأرقام بينزّل لآخر القايمة عند خانة «المدفوع نقداً» — عشان اللي
  /// واقف على فاتورة فيها ٢٠ صنف مايدوّرش على الخانة بلفّ.
  Widget _bottomBar() {
    return SafeArea(
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Colors.black12)),
        ),
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            InkWell(
              onTap: () => _scrollTo(
                  _scroll.hasClients ? _scroll.position.maxScrollExtent : 0),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                child: Row(
                  children: [
                    const Text('الإجمالي',
                        style: TextStyle(fontSize: 12, color: Colors.black54)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text('${_money(_total)} ج.م',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              color: AppColors.primary)),
                    ),
                    Text('باقي ${_money(_credit)}',
                        style: const TextStyle(fontSize: 12, color: Colors.black54)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 6),
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.save_outlined),
              label: Text(_saving ? 'بيحفظ…' : 'حفظ الفاتورة'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            ),
          ],
        ),
      ),
    );
  }
}

/// قايمة عملاء المندوب — من الكاش، فبتشتغل من غير شبكة.
class _CustomerSheet extends StatefulWidget {
  const _CustomerSheet();

  @override
  State<_CustomerSheet> createState() => _CustomerSheetState();
}

class _CustomerSheetState extends State<_CustomerSheet> {
  final _search = TextEditingController();
  List<CustomerRef> _rows = [];

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
    final rows = await LocalDb.instance.customers(query: _search.text.trim(), limit: 100);
    if (mounted) setState(() => _rows = rows);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(
          children: [
            const SizedBox(height: 10),
            const Text('اختار العميل',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                controller: _search,
                onChanged: (_) => _load(),
                decoration: const InputDecoration(
                  hintText: 'دوّر بالاسم',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
            ),
            if (_rows.isEmpty)
              const Expanded(
                child: Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('مافيش عملاء على الجهاز.\nاسحب البيانات الأول.',
                        textAlign: TextAlign.center),
                  ),
                ),
              )
            else
              Expanded(
                child: ListView.separated(
                  itemCount: _rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => ListTile(
                    title: Text(_rows[i].name),
                    subtitle: _rows[i].phone == null ? null : Text(_rows[i].phone!),
                    onTap: () => Navigator.pop(context, _rows[i]),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

String _money(double v) => v.toStringAsFixed(2);

String _trim(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}

String _qty(double v) => _trim(v);
