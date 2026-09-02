import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'invoice_print_screen.dart';
import 'sale_add_item_flow.dart';
import 'sale_coupons_section.dart';

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

  /// الكوبونات المصروفة مع الفاتورة — صف لكل فئة دفتر، زي النظام على الويب.
  final List<SaleCouponRow> _coupons = [];
  final List<SaleDraftLine> _lines = [];
  bool _saving = false;

  /// خانة الكمية بتاعة كل سطر — بالـ`itemId` مش بالترتيب.
  ///
  /// الترتيب بيتغيّر لما سطر في النص يتمسح، والكنترولر لازم يفضل ماشي مع صنفه هو.
  /// وهي كنترولر مش `initialValue` عشان زراير − و+ تغيّر الرقم المكتوب في الخانة؛
  /// `initialValue` بتتقرا مرة واحدة وبعدها الخانة بتفضل بترينا رقم قديم.
  final Map<int, TextEditingController> _qtyCtl = {};
  // نفس فكرة كنترولر الكمية: خانة بتتعدّل في مكانها لازم كنترولر ثابت — `initialValue`
  // بتتقرا مرة عند التركيب، ومفتاح بيتغيّر مع القيمة بيبني الخانة من جديد مع كل حرف
  // فالمؤشر يضيع وانت بتكتب.
  final Map<int, TextEditingController> _priceCtl = {};
  final Map<int, TextEditingController> _discCtl = {};

  /// السطور اللي التفاصيل (السعر والخصومات) مفتوحة عليها — بالـ`itemId` برضه.
  ///
  /// اللي فيها ٢٠ صنف كانت ٢٠ كارت بأربع صفوف وستّ خانات إدخال — طول لا ينتهي.

  /// صناديق المندوب زي ما نزلوا في الحزمة — واحد لكل خط.
  ///
  /// الصندوق **مش سؤال**: نوع الفاتورة بيحدّده لوحده. اللي هنا للعرض بس، عشان المندوب
  /// يشوف فلوسه رايحة فين قبل ما يحفظ — القرار مش بتاعه، والترحيل بيحصل على السيرفر.
  List<RepTreasury> _treasuries = [];

  /// اسم المندوب زي ما دخل بيه — عشان رسالة «مالكش صندوق» تقول مين، فاللي هيكلّم
  /// المكتب يعرف يقول الإعداد الناقص على مين بالظبط.
  String _me = '';

  final _scroll = ScrollController();

  /// `null` = سيب الترويسة تقرّر لوحدها. المندوب لو ضغط، رأيه هو اللي بيمشي.
  bool? _headerOpenOverride;

  /// الترويسة بتفضل مفتوحة طول ما فيه سؤال من غير إجابة (عميل أو نوع فاتورة)،
  /// وبتتلمّ في سطر واحد أول ما الاتنين يتحدّدوا — عشان السطور تاخد الشاشة.
  bool get _headerOpen =>
      _headerOpenOverride ?? (_customer == null || _family == null);

  @override
  void initState() {
    super.initState();
    _loadRepInfo();
  }

  /// صناديقه واسمه من الكاش — من غير شبكة، زي كل حاجة تانية في الشاشة دي.
  Future<void> _loadRepInfo() async {
    final rows = await LocalDb.instance.treasuries();
    final me = await LocalDb.instance.getKv('username');
    if (!mounted) return;
    setState(() {
      _treasuries = rows;
      _me = me ?? '';
    });
  }

  /// صندوق الخط ده. المطابقة بالخط بالظبط — **مافيش وقوع على صندوق تاني**: صندوق خط
  /// تاني بيسكت والفلوس بتروح مكان غلط، وده مافيش حاجة بتقوله بعدين. نفس قاعدة السيرفر
  /// بالحرف (`resolve_cash_account`).
  RepTreasury? get _treasury {
    if (_family == null) return null;
    for (final t in _treasuries) {
      if (t.family == _family) return t;
    }
    return null;
  }

  /// الجهاز عارف صناديقه أصلاً؟
  ///
  /// القايمة الفاضية معناها «ما اتسحبتش» أو «سيرفر قديم مابيرجّعهاش» — مش «مالوش صندوق».
  /// والفرق ده بيقرّر: مش عارف ⇒ الشاشة مابتمنعش، والسيرفر هو اللي بيرفض بسببه.
  bool get _treasuriesKnown => _treasuries.isNotEmpty;

  /// الخط اتحدّد، والجهاز عارف الصناديق، ومافيش صندوق للخط ده — إعداد ناقص عند المكتب.
  bool get _boxMissing => _family != null && _treasuriesKnown && _treasury == null;

  String get _treasuryLabel {
    if (_family == null) return 'بيتحدّد بنوع الفاتورة';
    final t = _treasury;
    if (t != null) return t.code.isEmpty ? t.label : '${t.label} · ${t.code}';
    return _treasuriesKnown
        ? 'مافيش صندوق لخط «$_family» — كلّم المكتب'
        : 'اسحب البيانات عشان الصندوق يبان';
  }

  @override
  void dispose() {
    _notes.dispose();
    _cash.dispose();
    _scroll.dispose();
    for (final c in _qtyCtl.values) {
      c.dispose();
    }
    for (final c in _priceCtl.values) {
      c.dispose();
    }
    for (final c in _discCtl.values) {
      c.dispose();
    }
    super.dispose();
  }

  double get _total => _lines.fold(0.0, (t, l) => t + l.net);
  double get _cashAmount => double.tryParse(_cash.text.trim()) ?? 0;
  double get _credit => max(0, _total - _cashAmount);

  /// حساب العميل السابق — قبل الفاتورة اللي بيكتبها دلوقتي.
  double get _prevBalance => _customer?.balance ?? 0;

  /// الباقي على العميل بعد الفاتورة دي = السابق + الفاتورة − المدفوع.
  ///
  /// كان بيعرض `_credit` وبس، يعني آجل الفاتورة دي لوحدها. والمندوب بيقول للعميل
  /// «عليك كذا» فبيقول رقم الفاتورة وهو مديون من قبلها — وده نص الرقم الحقيقي.
  double get _dueAfter => _prevBalance + _total - _cashAmount;

  /// رصيد خط بعينه. الخط اللي مالوش حساب رصيده صفر — جملة صح عن الفلوس.
  double _familyBalance(String f) => _customer?.familyBalances[f] ?? 0;

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
      // الخانات عندها كنترولرز، والموديل لسه متغيّر من برّه — فلازم تتبلّغ، وإلا
      // السطر يتسعّر على فئة العميل والخانة تفضل واقفة على السعر القديم.
      for (final l in _lines) {
        _priceCtl[l.itemId]?.text = _trim(l.unitPrice);
        _discCtl[l.itemId]?.text = _trim(l.variableDiscountPct);
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
    // بوبابات ورا بعض زي أصناف المعاينة — الفئة، الصنف، الكمية، و«التالي» بيرجّعه
    // للأصناف على طول. كانت شاشة كاملة بدخلة وخرجة لكل صنف، والكمية بتبتدي «١»
    // فبتتكتب فوقها غلط. المندوب طلب الاتنين.
    await SaleAddItemFlow.show(
      context,
      alreadyOnInvoice: {for (final l in _lines) l.itemId: l.quantity},
      priceTier: _customer?.priceTier,
      onAdd: (picked, qty) {
        final existing = _lines.indexWhere((l) => l.itemId == picked.itemId);
        setState(() {
          if (existing >= 0) {
            _lines[existing].quantity += qty;
            // الرقم اتغيّر في الموديل — والخانة عندها كنترولر، فلازم تتبلّغ.
            _syncQtyField(_lines[existing]);
          } else {
            _lines.add(SaleDraftLine(
              itemId: picked.itemId,
              itemName: picked.name,
              quantity: qty,
              // السعر والخصم من الصنف — الواحد بيراجع رقم، مش بيخترعه.
              unitPrice: picked.priceFor(_customer?.priceTier),
              // الثابت من الصنف، والمتغيّر بيبتدي صفر — ده اللي المندوب بيزوّده بإيده.
              fixedDiscountPct: picked.defaultDiscountPct,
              variableDiscountPct: 0,
            ));
          }
        });
      },
    );
  }

  /// بوباب «الفلوس داخلة فين» — عرض بس، وبيرجّع هل المندوب أكّد.
  Future<bool> _confirmTreasury() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تأكيد التحصيل',
              style: TextStyle(fontWeight: FontWeight.w800)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('المبلغ المحصّل',
                      style: TextStyle(color: Colors.black54)),
                  Text('${_money(_cashAmount)} ج.م',
                      style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary)),
                ],
              ),
              const Divider(height: 20),
              const Text('بينزل في الخزنة',
                  style: TextStyle(color: Colors.black54)),
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.savings_outlined,
                      size: 16, color: AppColors.primary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(_treasuryLabel,
                        style: const TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 15)),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              // الصندوق بيتحدد من نوع الفاتورة — يتقال ليه، مش يتساب كأنه مزاج.
              Text('اتحدّد من نوع الفاتورة «${_family ?? ''}»',
                  style: const TextStyle(fontSize: 11, color: Colors.black45)),
            ],
          ),
          actionsPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(c, false),
                child: const Text('رجوع')),
            FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: const Text('تأكيد وحفظ')),
          ],
        ),
      ),
    );
    return ok == true;
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

  /// الصفوف المكتوبة بس، JSON — الفاضي بيتساب ومابيتخزّنش.
  String? _couponsJson() {
    final rows = [for (final c in _coupons) if (!c.isEmpty) c.toJson()];
    return rows.isEmpty ? null : jsonEncode(rows);
  }

  Future<void> _save() async {
    if (_customer == null) return _say('اختر العميل');
    if (_family == null) {
      // الفاتورة اللي مش قايلة على أنهي خط بتتكتب من غير هوية، والعميل المقسوم بتوزّع
      // رقمه على الاتنين بالنسبة — وكشف حسابه بعدها مايقولش حاجة مفهومة. السؤال هنا
      // أرخص من التصحيح بعدين.
      return _say('اختر نوع الفاتورة — أبيض أو بولي');
    }
    if (_boxMissing) {
      // إعداد ناقص عند المكتب مش غلطة من المندوب — فالرسالة بتقول الخط والمندوب بالاسم.
      //
      // والحفظ بيقف هنا لأن السيرفر هيرفضها برضه: الفاتورة محتاجة صندوق للخط ده عشان
      // تترحّل، والبديل (ترحيلها على صندوق تاني) أوحش من رفضها. أحسن يعرف وهو واقف عند
      // العميل من إن الفاتورة تقعد في الطابور وترجع بخطأ في المزامنة بعد ساعتين.
      return _say(_me.isEmpty
          ? 'مافيش صندوق لخط «$_family» على حسابك — كلّم المكتب.'
          : 'مافيش صندوق لخط «$_family» على «$_me» — كلّم المكتب.');
    }
    // **فاتورة كوبونات بس مسموحة** — صنف، أو دفتر كوبونات، أو الاتنين.
    //
    // الشركة بتسلّم دفاتر لعميل من غير ما تبيعه بضاعة في نفس الورقة، وده مستند حقيقي:
    // بيتسجّل عليه مين استلم وإمتى وأنهي مدى أرقام. السيرفر بيقبلها من الأول
    // (`sales_service.create_sale`: «الفاتورة لازم يكون فيها صنف أو دفتر كوبونات
    // على الأقل») والويب مابيمنعهاش — التطبيق كان الوحيد اللي بيقف.
    //
    // والمنع ده كان **صح** قبل ما الكوبونات تنزل في فاتورة التطبيق: فاتورة بلا أصناف
    // ساعتها كانت ورقة فاضية فعلاً. بقى غلط أول ما بقى فيه حاجة تانية تتكتب عليها.
    final hasCoupons = _coupons.any((c) => !c.isEmpty);
    if (_lines.isEmpty && !hasCoupons) {
      return _say('ضيف صنف أو دفتر كوبونات على الأقل');
    }
    // صف كوبونات نص مكتوب مابيترحّلش ساكت. المدى هو اللي المرتجع بيراجع عليه الرقم
    // الراجع — مدى غلط معناه كوبون حقيقي بيترفض على العميل بعد شهر من غير سبب مفهوم.
    for (final c in _coupons) {
      if (c.isEmpty) continue;
      final from = c.serialFrom.trim();
      final to = c.serialTo.trim();
      if (from.isEmpty || to.isEmpty) {
        return _say('في صف كوبونات ناقصه رقم — اكتب «من» و«إلى» أو امسح الصف');
      }
      if (couponCount(from, to) == null) {
        return _say('مدى الكوبونات «$from — $to» مش مفهوم — راجع الرقمين');
      }
    }
    if (_lines.any((l) => l.quantity <= 0)) return _say('في سطر كميته صفر');
    final over = await _overCustody();
    if (over != null) return _say(over);
    // المدفوع **ممكن يزيد عن الفاتورة** — والزيادة بتسدّد المديونية القديمة.
    //
    // كان بيترفض عند إجمالي الفاتورة، والعميل اللي عليه آجل من قبل بيدفع أكتر عادي —
    // ده نص شغل التحصيل. النظام على الويب بيقول الجملة دي حرفياً تحت الخانة، والتطبيق
    // كان بيمنعها. الحد الحقيقي هو الفاتورة + اللي عليه، ومافيش سبب يخلّيه يدفع أكتر
    // من ده (ودي بتبقى دفعة مقدّمة، سند مش فاتورة).
    final maxCash = _total + _prevBalance;
    if (_cashAmount > maxCash + 0.0001) {
      return _say(_prevBalance > 0.001
          ? 'الأكتر اللي ينفع يتحصّل ${_money(maxCash)} — الفاتورة واللي عليه'
          : 'المدفوع أكبر من الفاتورة');
    }

    // آخر سؤال قبل الحفظ: **الفلوس دي رايحة فين**.
    //
    // على النظام اللي بيحفظ **بيختار** الخزنة؛ هنا مافيش اختيار — صندوق المندوب بتاع
    // الخط ده هو ده، ومالوش قرار فيه. فالبوباب **للقراءة بس**: بيقول الرقم والصندوق
    // بالاسم ويستنى تأكيد. اللي بيقبض فلوس لازم يشوف هي داخلة فين قبل ما يقبض،
    // مش بعدين في كشف الحساب.
    if (_cashAmount > 0.001 && !await _confirmTreasury()) return;

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
        couponsJson: _couponsJson(),
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

  void _syncQtyField(SaleDraftLine l) {
    final c = _qtyCtl[l.itemId];
    if (c == null) return;
    final t = _trim(l.quantity);
    if (c.text == t) return;
    // `c.text = t` بيرمي المؤشر على موضع غير صالح (-1) — توثيق Flutter نفسه بيقول
    // إن الـsetter ده للاختبارات. والنتيجة إن الرقم الجاي بيتكتب في **أول** الخانة:
    // المندوب يدوس «+» وبعدين يكتب صفر على «٢» فتطلع «٠٢» وتترجع ٢ بدل ٢٠ — والكمية
    // غلط والإجمالي وراها، ومحدش بيشتكي لأن الحفظ بيرفض الصفر بس.
    c.value = TextEditingValue(
      text: t, selection: TextSelection.collapsed(offset: t.length));
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
      _qtyCtl.remove(l.itemId)?.dispose();
      _priceCtl.remove(l.itemId)?.dispose();
      _discCtl.remove(l.itemId)?.dispose();
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
              // الشريط بيقول «اضغط للاختيار» لما مافيش عميل — فالضغطة تفتح المنتقي
              // فعلاً. كانت بتطوي الكارت اللي فيه زرار الاختيار نفسه، يعني أول لمسة
              // في الشاشة بتعمل عكس اللي مكتوب عليها.
              onTap: _customer == null && !_headerOpen ? _pickCustomer : _toggleHeader,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                // والكارت المفتوح تحته بيقول نفس الكلام — «اختار العميل» مرتين فوق
                // بعض. فلما الترويسة مفتوحة الشريط بيبقى مقبض بس: «بيانات الفاتورة»
                // وسهم يطويها، والكلام الحقيقي في الكارت.
                child: _headerOpen
                    ? const Row(
                        children: [
                          Icon(Icons.receipt_long_outlined,
                              size: 20, color: AppColors.primary),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text('بيانات الفاتورة',
                                style: TextStyle(
                                    fontWeight: FontWeight.w700, fontSize: 14)),
                          ),
                          Icon(Icons.expand_less, size: 20, color: Colors.black45),
                        ],
                      )
                    : Row(
                        children: [
                          Icon(missing ? Icons.error_outline : Icons.person_outline,
                              size: 20,
                              color: missing ? AppColors.danger : AppColors.primary),
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
                                        color: missing
                                            ? AppColors.danger
                                            : Colors.black54)),
                              ],
                            ),
                          ),
                          const Icon(Icons.expand_more,
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
            if (_family != null) ...[
              const Divider(height: 1),
              // الصندوق عرض بس — نوع الفاتورة بيحدّده، والمندوب مالوش قرار فيه.
              //
              // بيتعرض عشان يشوف فلوسه رايحة فين قبل ما يحفظ، مش بعدين في كشف الحساب.
              ListTile(
                leading: Icon(Icons.savings_outlined,
                    color: _boxMissing ? AppColors.danger : AppColors.primary),
                title: const Text('الصندوق'),
                subtitle: Text(_treasuryLabel,
                    style: TextStyle(color: _boxMissing ? AppColors.danger : null)),
                trailing:
                    const Icon(Icons.lock_outline, size: 18, color: Colors.black38),
                enabled: false,
              ),
            ],
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
            child: Text(
                'مافيش أصناف على الفاتورة لسه.\n'
                'اضغط «صنف» فوق عشان تضيف — أو سيبها من غير أصناف\n'
                'وسجّل دفتر كوبونات بس تحت.',
                textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
          )
        else
          for (var i = 0; i < _lines.length; i++) _lineTile(i),
        _paymentCard(),
      ],
    );
  }

  /// سطر الفاتورة: **صفّين، من غير طي** — بطلب صاحب النظام.
  ///
  /// كان فيه فتحة بتتفتح بالضغط عشان السعر والخصم، فالمندوب اللي بيراجع فاتورة
  /// بيفتح سطر سطر عشان يشوف أرقام هي أصلاً بتاعته. دلوقتي كله قدامه:
  /// الصف الأول: # · الاسم · (خصم ثابت لو فيه) · الإجمالي.
  /// الصف التاني: الكمية ± · سعر الوحدة · خصم٪ · حذف — والتلاتة بيتعدّلوا في مكانهم.
  Widget _lineTile(int i) {
    final l = _lines[i];
    // مفتاح بالصنف عشان حالة الخانات تفضل مع سطرها لو اتمسح سطر من النص.
    final ctl = _qtyCtl.putIfAbsent(
        l.itemId, () => TextEditingController(text: _trim(l.quantity)));
    return Card(
      key: ValueKey(l.itemId),
      margin: const EdgeInsets.fromLTRB(8, 4, 8, 0),
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
                // الخصم الثابت جاي من الصنف ونادراً ما بيتعدّل — بيتقال هنا عشان
                // مجموع الخصم يبان منين جه، من غير ما ياخد خانة في الصف التاني.
                if (l.fixedDiscountPct > 0) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.accent.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text('ثابت ${_trim(l.fixedDiscountPct)}%',
                        style:
                            const TextStyle(fontSize: 10, color: Colors.black87)),
                  ),
                ],
                const SizedBox(width: 6),
                Text('${_money(l.net)} ج.م',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                        color: AppColors.primary)),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                _qtyStepper(l, ctl),
                const SizedBox(width: 8),
                Expanded(
                  child: _inlineField(
                    label: 'السعر',
                    controller: _priceCtl.putIfAbsent(l.itemId,
                        () => TextEditingController(text: _trim(l.unitPrice))),
                    onChanged: (v) => setState(() => l.unitPrice = v),
                    // **الصنف اللي عليه خصم ثابت، سعره سعر القايمة — مايتكتبش فوقه.**
                    //
                    // الشركة بتحطّ الخصم الثابت على خطوط بعينها (تكنو ثيرم، تكنو جوان،
                    // ابيض تكنوو، ابيض تكنوو ١١٠، تكنو ثيرم معزول) — يعني السعر
                    // والخصم اتقرروا مع بعض. لو المندوب عدّل السعر كمان، بيبقى خصمين
                    // على بعض من غير ما حد يشوف، والمكتب بيراجع فاتورة ماتوصلش لسعر
                    // القايمة ولا يعرف الفرق راح فين.
                    //
                    // فالتفاوض بيفضل في مكان واحد: **الخصم المتغيّر**. وهو مفتوح.
                    //
                    // والشرط على الداتا مش على أسماء الفئات: المكتب بيقرر من النظام
                    // (`Item.default_discount_pct`) أنهي أصناف تمشي بالقاعدة دي،
                    // من غير ما التطبيق يتبني من أول وجديد.
                    readOnly: l.fixedDiscountPct > 0,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: _inlineField(
                    label: 'خصم %',
                    controller: _discCtl.putIfAbsent(
                        l.itemId,
                        () => TextEditingController(
                            text: _trim(l.variableDiscountPct))),
                    onChanged: (v) =>
                        setState(() => l.variableDiscountPct = v),
                  ),
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
                  constraints:
                      const BoxConstraints.tightFor(width: 32, height: 36),
                  visualDensity: VisualDensity.compact,
                  onPressed: () => _removeLine(l),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// خانة رقم صغيرة بعنوان فوقها — بتتعدّل في مكانها من غير فتحة.
  Widget _inlineField({
    required String label,
    required TextEditingController controller,
    required void Function(double) onChanged,
    bool readOnly = false,
  }) {
    return TextFormField(
      controller: controller,
      readOnly: readOnly,
      // الخانة المقفولة بتقول إنها مقفولة: رمادية وبقفل صغير. خانة شكلها زي أي خانة
      // وبتتلمس مافيش حاجة بتحصل بتخلّي الواحد يفتكر التطبيق واقف.
      style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: readOnly ? Colors.black54 : Colors.black87),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textAlign: TextAlign.center,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      ),
      onChanged: (t) => onChanged(double.tryParse(t.trim()) ?? 0),
    );
  }

  /// الكمية بتتكتب — **من غير زراير ±** بطلب صاحب النظام.
  ///
  /// الزراير كانت للسرعة، وطلعت بتعمل العكس: المندوب بيبيع بالعشرات والمئات،
  /// فالوصول لرقم زي ٤٠ بضغطة الواحدة مش أسرع من كتابته، والضغطة الزيادة بالغلط
  /// بتعدّل كمية على فاتورة من غير ما حد ياخد باله. الخانة بتقبل الكسور برضه.
  Widget _qtyStepper(SaleDraftLine l, TextEditingController ctl) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.black12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(width: 8),
          SizedBox(
            width: 62,
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
          const SizedBox(width: 8),
        ],
      ),
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
            // الفلوس دي رايحة فين — جنب الخانة اللي بيكتب فيها الرقم بالظبط.
            //
            // الترويسة بتتلمّ بعد ما العميل والخط يتحدّدوا، فالصندوق بيختفي من فوق. وهنا
            // هو المكان اللي بيتسأل فيه السؤال أصلاً: بيقبض كام، وبينزل فين.
            if (_cashAmount > 0) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.savings_outlined,
                      size: 14, color: _boxMissing ? AppColors.danger : Colors.black45),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text('النقدي بينزل في: $_treasuryLabel',
                        maxLines: 2,
                        style: TextStyle(
                            fontSize: 11,
                            color: _boxMissing ? AppColors.danger : Colors.black54)),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            _totalRow('إجمالي الأصناف', _money(_total)),
            const SizedBox(height: 6),
            _totalRow('صافي الفاتورة', _money(_total), color: AppColors.primary),
            if (_customer != null) ...[
              const Divider(height: 18),
              // سطر لكل خط، والخط اللي الفاتورة عليه متعلّم.
              //
              // الخطين بيتعرضوا دايماً حتى لو واحد فيهم صفر: العميل بيسأل «الأبيض بكام»،
              // والسطر الناقص بيخلّي السؤال يتردّ عليه بتخمين. والصفر إجابة.
              for (final f in const ['أبيض', 'بولي'])
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: _totalRow('مديونية $f', _money(_familyBalance(f)),
                      color: _familyBalance(f) > 0.001
                          ? AppColors.danger
                          : AppColors.primary,
                      highlight: f == _family),
                ),
              _totalRow('حساب سابق على العميل', _money(_prevBalance),
                  color: _prevBalance > 0.001 ? AppColors.danger : AppColors.primary),
              const Divider(height: 18),
            ],
            if (_cashAmount > 0.001) ...[
              _totalRow('المدفوع نقداً', '− ${_money(_cashAmount)}',
                  color: AppColors.primary),
              const SizedBox(height: 6),
            ],
            _totalRow('الباقي على العميل', _money(_dueAfter), big: true),
            const SizedBox(height: 10),
            TextField(
              controller: _notes,
              decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
            ),
            // الكوبونات جوّه نفس الفاتورة — مش شاشة تانية. اللي بيسلّم دفتر بيسلّمه
            // مع البضاعة في نفس اللحظة، والمدى ده هو اللي المرتجع بيراجع عليه بعدين.
            SaleCouponsSection(
                rows: _coupons, onChanged: () => setState(() {})),
          ],
        ),
      ),
    );
  }

  Widget _totalRow(String label, String value,
      {bool big = false, Color? color, bool highlight = false}) {
    final row = Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: big ? 15 : 14,
                fontWeight: highlight ? FontWeight.w700 : FontWeight.w400,
                color: highlight ? Colors.black87 : Colors.black54)),
        Text('$value ج.م',
            style: TextStyle(
                fontSize: big ? 22 : 16,
                fontWeight: FontWeight.w800,
                color: color ?? (big ? AppColors.primary : Colors.black87))),
      ],
    );
    // الخط اللي الفاتورة عليه بيتعلّم بخلفية خفيفة: تلات أرقام متشابهين في عمود من
    // غير علامة على اللي بيتحرّك دلوقتي هما تلات أرقام محدش بيقراهم.
    if (!highlight) return row;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(6),
      ),
      child: row,
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
                    // نفس رقم اللوحة تحت — الشريط كان بيقول آجل الفاتورة دي بس واللوحة
                    // بتقول الباقي كله، فرقمين مختلفين بنفس الاسم في شاشة واحدة.
                    Text('باقي ${_money(_dueAfter)}',
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
