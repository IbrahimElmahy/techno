import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/coupon_custody.dart';
import '../models/discount.dart';
import '../models/models.dart';
import '../theme.dart';
import 'invoice_print_screen.dart';
import 'sale_add_item_flow.dart';
import 'sale_coupons_section.dart';

class SaleInvoiceScreen extends StatefulWidget {
  const SaleInvoiceScreen(
      {super.key, this.existing, this.initialLines, this.bonusMode = false});

  final bool bonusMode;

  final Map<String, Object?>? existing;

  final List<SaleDraftLine>? initialLines;

  @override
  State<SaleInvoiceScreen> createState() => _SaleInvoiceScreenState();
}

class _SaleInvoiceScreenState extends State<SaleInvoiceScreen> {
  CustomerRef? _customer;

  String? _family;

  static const _kFamilies = ['أبيض', 'بولي'];

  List<String> get _familyChoices {
    final fams = _customer?.families ?? const <String>[];
    return fams.length > 1 ? fams : _kFamilies;
  }
  DateTime get _date => DateTime.now();
  final _notes = TextEditingController();
  final _cash = TextEditingController();

  final List<SaleCouponRow> _coupons = [];
  final List<SaleDraftLine> _lines = [];
  bool _saving = false;

  _BonusTarget? _bonusFor;

  late final bool _isBonus =
      widget.bonusMode || (widget.existing?['is_bonus'] as int? ?? 0) == 1;

  final Map<int, TextEditingController> _qtyCtl = {};
  final Map<int, TextEditingController> _priceCtl = {};
  final Map<int, TextEditingController> _discCtl = {};

  List<RepTreasury> _treasuries = [];

  String _me = '';

  final _scroll = ScrollController();

  bool? _headerOpenOverride;

  bool get _headerOpen =>
      _headerOpenOverride ?? (_customer == null || _family == null);

  Map<int, double> _free = {};

  Map<int, List<PendingHold>> _holds = {};

  CouponCustody _couponCustody = CouponCustody.none;

  Map<int, double> _minPrices = {};

  bool _canSellBelowCost = true;

  int? get _editingId => widget.existing?['local_id'] as int?;
  bool get _isEditing => _editingId != null;

  @override
  void initState() {
    super.initState();
    _loadRepInfo();
    _loadFree();
    _loadMinPrices();
    if (_isEditing) {
      _loadExisting();
    } else if (widget.initialLines != null) {
      _lines.addAll(widget.initialLines!.map((l) => SaleDraftLine(
            itemId: l.itemId,
            itemName: l.itemName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            fixedDiscountPct: l.fixedDiscountPct,
            variableDiscountPct: _isBonus ? 100 : l.variableDiscountPct,
          )));
    }
  }

  Future<void> _loadFree() async {
    final free = await LocalDb.instance
        .availableForSaleAll(exceptInvoiceLocalId: _editingId);
    final holds =
        await LocalDb.instance.pendingHolds(exceptInvoiceLocalId: _editingId);
    final custody =
        await LocalDb.instance.couponCustody(exceptInvoiceLocalId: _editingId);
    if (!mounted) return;
    setState(() {
      _free = free;
      _holds = holds;
      _couponCustody = custody;
    });
  }

  Future<void> _loadMinPrices() async {
    final items = await LocalDb.instance.saleItems();
    final can = await LocalDb.instance.getKv('can_sell_below_cost');
    if (!mounted) return;
    setState(() {
      _minPrices = {
        for (final i in items)
          if ((i.minPrice ?? 0) > 0) i.itemId: i.minPrice!,
      };
      _canSellBelowCost = can != '0';
    });
  }

  bool _belowCost(SaleDraftLine l) {
    if (_isBonus) return false;
    final min = _minPrices[l.itemId];
    if (min == null || min <= 0) return false;
    double r2(double v) => (v * 100).roundToDouble() / 100;
    return r2(netOf(l.unitPrice, l.discountPct)) < r2(min) - 0.0001;
  }

  Future<void> _loadExisting() async {
    final r = widget.existing!;
    final lines = await LocalDb.instance.saleInvoiceLines(_editingId!);
    final all = await LocalDb.instance.customers(limit: 100000);
    CustomerRef? cust;
    for (final c in all) {
      if (c.id == r['customer_id'] as int?) { cust = c; break; }
    }
    if (!mounted) return;
    setState(() {
      _customer = cust;
      _family = r['family'] as String?;
      _cash.text = _blank((r['cash_amount'] as num?)?.toDouble() ?? 0);
      _notes.text = (r['notes'] as String?) ?? '';
      _lines
        ..clear()
        ..addAll(lines);
      for (final l in _lines) {
        _qtyCtl[l.itemId] = TextEditingController(text: _blank(l.quantity));
        _priceCtl[l.itemId] = TextEditingController(text: _blank(l.unitPrice));
        _discCtl[l.itemId] =
            TextEditingController(text: _blank(l.variableDiscountPct));
      }
      _coupons
        ..clear()
        ..addAll(_couponsFromJson(r['coupons'] as String?));
    });
    if (_isBonus) {
      await _loadBonusTarget(r);
      await _repriceAll();
    }
    if (!mounted) return;
    setState(() => _baseline = _fingerprint);
  }

  Future<void> _loadBonusTarget(Map<String, Object?> r) async {
    final uuid = r['bonus_for_client_uuid'] as String?;
    final sid = r['bonus_for_invoice_id'] as int?;
    if (uuid == null && sid == null) return;
    final local = uuid == null ? null : await LocalDb.instance.saleInvoiceByUuid(uuid);
    if (!mounted) return;
    setState(() {
      _bonusFor = _BonusTarget(
        serverId: sid,
        clientUuid: uuid,
        number: (local?['document_number'] as String?) ??
            (r['bonus_for_number'] as String?),
        date: local?['invoice_date'] as String?,
        net: (local?['total'] as num?)?.toDouble(),
        onDevice: local != null && (local['synced'] as int? ?? 0) != 1,
      );
    });
  }

  List<SaleCouponRow> _couponsFromJson(String? raw) {
    if (raw == null || raw.trim().isEmpty) return const [];
    try {
      return [
        for (final e in (jsonDecode(raw) as List))
          SaleCouponRow(
            kind: (e as Map)['coupon_kind'] as String?,
            serialFrom: '${e['serial_from'] ?? ''}',
            serialTo: '${e['serial_to'] ?? ''}',
          )
      ];
    } catch (_) {
      return const [];
    }
  }

  double _freeOf(int itemId) => _free[itemId] ?? 0;

  bool _isOver(SaleDraftLine l) => l.quantity > _freeOf(l.itemId) + 0.0001;

  Future<void> _loadRepInfo() async {
    final rows = await LocalDb.instance.treasuries();
    final me = await LocalDb.instance.getKv('username');
    if (!mounted) return;
    setState(() {
      _treasuries = rows;
      _me = me ?? '';
    });
  }

  RepTreasury? get _treasury {
    if (_family == null) return null;
    for (final t in _treasuries) {
      if (t.family == _family) return t;
    }
    return null;
  }

  bool get _treasuriesKnown => _treasuries.isNotEmpty;

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

  double get _total => _isBonus ? 0 : _lines.fold(0.0, (t, l) => t + l.net);

  double get _bonusValue =>
      _lines.fold(0.0, (t, l) => t + netOf(l.gross, l.fixedDiscountPct));

  double get _cashAmount =>
      _isBonus ? 0 : (double.tryParse(_cash.text.trim()) ?? 0);
  double get _credit => max(0, _total - _cashAmount);

  double get _prevBalance => _customer?.balance ?? 0;

  double get _dueAfter => _prevBalance + _total - _cashAmount;

  double _familyBalance(String f) => _customer?.familyBalances[f] ?? 0;

  Future<void> _pickCustomer() async {
    final picked = await showModalBottomSheet<CustomerRef>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _CustomerSheet(),
    );
    if (picked == null) return;
    setState(() {
      if (_customer?.id != picked.id) _bonusFor = null;
      _customer = picked;
      _family = picked.families.length == 1 ? picked.families.first : null;
      for (var i = 0; i < _lines.length; i++) {
        _lines[i].unitPrice = _lines[i].unitPrice;
      }
    });
    await _repriceAll();
  }

  Future<void> _repriceAll() async {
    if (_customer == null) return;
    final items = await LocalDb.instance.saleItems();
    if (!mounted) return;
    final byId = {for (final it in items) it.itemId: it};
    setState(() {
      for (final l in _lines) {
        final it = byId[l.itemId];
        if (it != null) {
          l.unitPrice = it.priceFor(_customer!.priceTier);
          l.fixedDiscountPct = it.defaultDiscountPct;
        }
      }
      for (final l in _lines) {
        _priceCtl[l.itemId]?.text = _blank(l.unitPrice);
        _discCtl[l.itemId]?.text = _blank(l.variableDiscountPct);
      }
    });
  }

  Future<void> _addItem() async {
    await SaleAddItemFlow.show(
      context,
      alreadyOnInvoice: {for (final l in _lines) l.itemId: l.quantity},
      exceptInvoiceLocalId: _editingId,
      priceTier: _customer?.priceTier,
      onAdd: (picked, qty) {
        final existing = _lines.indexWhere((l) => l.itemId == picked.itemId);
        setState(() {
          if (existing >= 0) {
            _lines[existing].quantity += qty;
            _syncQtyField(_lines[existing]);
          } else {
            _lines.add(SaleDraftLine(
              itemId: picked.itemId,
              itemName: picked.name,
              quantity: qty,
              unitPrice: picked.priceFor(_customer?.priceTier),
              fixedDiscountPct: picked.defaultDiscountPct,
              variableDiscountPct: _isBonus ? 100 : 0,
            ));
          }
        });
      },
    );
    await _loadFree();
  }

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
                  Text('${_money(_cashAmount)}',
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

  Future<List<_OverLine>> _overCustody() async {
    final free = await LocalDb.instance
        .availableForSaleAll(exceptInvoiceLocalId: _editingId);
    final holds =
        await LocalDb.instance.pendingHolds(exceptInvoiceLocalId: _editingId);
    if (mounted) {
      setState(() {
        _free = free;
        _holds = holds;
      });
    }
    return [
      for (final l in _lines)
        if (l.quantity > (free[l.itemId] ?? 0) + 0.0001)
          _OverLine(l, (free[l.itemId] ?? 0), holds[l.itemId] ?? const [])
    ];
  }

  Future<void> _warnOverCustody(List<_OverLine> over) async {
    final capped = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Row(children: [
            Icon(Icons.warning_amber_rounded, color: AppColors.danger),
            SizedBox(width: 8),
            Expanded(child: Text('الكمية أكتر من اللي في عربيتك')),
          ]),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('الفاتورة مش هتتعمل كده — قلّل الكميات دي للمتاح:',
                  style: TextStyle(fontSize: 13)),
              const SizedBox(height: 10),
              ...[
                for (final o in over)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '• ${o.line.itemName}\n'
                          '   طالب ${_qty(o.line.quantity)} — المتاح ${_qty(o.free)}'
                          '${o.free <= 0 && o.holds.isEmpty ? ' (خلص من العربية)' : ''}',
                          style: const TextStyle(fontSize: 13),
                        ),
                        for (final h in o.holds)
                          Text(
                            '   ${_qty(h.quantity)} محجوزين على ${_holdLabel(h)}',
                            style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.danger,
                                fontWeight: FontWeight.w700),
                          ),
                      ],
                    ),
                  ),
              ],
              const SizedBox(height: 4),
              if (over.any((o) => o.holds.isNotEmpty))
                const Padding(
                  padding: EdgeInsets.only(bottom: 4),
                  child: Text(
                      'البضاعة دي متكتبة على فاتورة تانية لسه على الجهاز — مش خلصانة. '
                      'لو اتكتبت مرتين بالغلط، قلّلها من الفاتورة التانية الأول '
                      '(من «فواتيري») وارجع هنا.',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                ),
              const Text(
                  'لو شايف إن البضاعة معاك فعلاً، اعمل «مزامنة البيانات» الأول — '
                  'أرصدة العربية بتتحدّث منها.',
                  style: TextStyle(fontSize: 11, color: Colors.black54)),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dctx, false),
                child: const Text('هعدّل بنفسي')),
            FilledButton(
                onPressed: () => Navigator.pop(dctx, true),
                child: const Text('قلّل للمتاح')),
          ],
        ),
      ),
    );
    if (capped != true || !mounted) return;
    setState(() {
      for (final o in over) {
        if (o.free <= 0) {
          _lines.removeWhere((l) => l.itemId == o.line.itemId);
          _qtyCtl.remove(o.line.itemId)?.dispose();
        } else {
          o.line.quantity = o.free;
          _syncQtyField(o.line);
        }
      }
    });
  }

  String? _couponsJson() {
    final rows = [for (final c in _coupons) if (!c.isEmpty) c.toJson()];
    return rows.isEmpty ? null : jsonEncode(rows);
  }

  String? _prevBalancesJson() {
    final b = _customer?.familyBalances ?? const <String, double>{};
    if (b.isEmpty) return null;
    return jsonEncode({for (final e in b.entries) e.key: e.value});
  }

  Future<void> _save() async {
    if (_customer == null) return _say('اختر العميل');
    if (_family == null) {
      return _say('اختر نوع الفاتورة — أبيض أو بولي');
    }
    if (_boxMissing) {
      return _say(_me.isEmpty
          ? 'مافيش صندوق لخط «$_family» على حسابك — كلّم المكتب.'
          : 'مافيش صندوق لخط «$_family» على «$_me» — كلّم المكتب.');
    }
    final hasCoupons = _coupons.any((c) => !c.isEmpty);
    if (_isBonus && _lines.isEmpty) {
      return _say('البونص لازم يبقى فيه صنف على الأقل');
    }
    if (_lines.isEmpty && !hasCoupons) {
      return _say('ضيف صنف أو دفتر كوبونات على الأقل');
    }
    if (hasCoupons) {
      final custody =
          await LocalDb.instance.couponCustody(exceptInvoiceLocalId: _editingId);
      if (!mounted) return;
      setState(() => _couponCustody = custody);
      final errors = custody.check(
          [for (final c in _coupons) if (!c.isEmpty) c.asInput],
          requireComplete: true);
      for (final e in errors) {
        if (e != null) return _say(e);
      }
    }
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
    for (final l in _lines) {
      if (l.variableDiscountPct > 100) {
        return _say('خصم «${l.itemName}» ${_qty(l.variableDiscountPct)}٪ — '
            'الخانة دي نسبة مش مبلغ. أعلى خصم ١٠٠٪ (بونص).');
      }
    }
    if (!_isBonus) {
      for (final l in _lines) {
        if (l.isFull) {
          return _say('«${l.itemName}» بخصم ١٠٠٪ — ده بونص، والبونص صفحة لوحدها. '
              'احفظ البيع بخصم أقل من ١٠٠، واعمل الهدية من «فاتورة بونص» في الرئيسية.');
        }
      }
    }
    if (_isEditing && !_isBonus) {
      final uuid = widget.existing!['client_uuid'] as String?;
      final movedCustomer = _customer!.id != widget.existing!['customer_id'];
      if (uuid != null &&
          movedCustomer &&
          await LocalDb.instance.queuedBonusesOn(uuid) > 0) {
        return _say('الفاتورة دي عليها بونص لسه ما اترفعش — '
            'ماينفعش تتنقل لعميل تاني. ارفعهم الأول أو عدّل البونص.');
      }
    }
    if (_isBonus) {
      setState(() {
        for (final l in _lines) {
          l.variableDiscountPct = 100;
          _discCtl[l.itemId]?.text = _blank(100);
        }
      });
    }
    if (!_isBonus &&
        (await LocalDb.instance.getKv('can_sell_below_price')) == '0') {
      final tier = _customer?.priceTier;
      final catalogue = {for (final i in await LocalDb.instance.saleItems()) i.itemId: i};
      for (final l in _lines) {
        final listed = catalogue[l.itemId]?.priceFor(tier);
        if (listed == null || listed <= 0) continue;
        if (l.unitPrice < listed - 0.0001) {
          return _say('«${l.itemName}» بسعر ${_money(l.unitPrice)} وسعر الشريحة '
              '${_money(listed)} — البيع تحت السعر محتاج صلاحية مالكش إياها. '
              'ظبّط السعر أو كلّم المكتب.');
        }
      }
    }
    if (!_canSellBelowCost) {
      final under = <String>{for (final l in _lines) if (_belowCost(l)) l.itemName};
      if (under.isNotEmpty) {
        if (!mounted) return;
        await showDialog<void>(
          context: context,
          builder: (d) => Directionality(
            textDirection: TextDirection.rtl,
            child: AlertDialog(
              title: const Text('سعر البيع أقل من سعر الشراء'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('الأصناف دي صافي سعرها أقل من سعر الشراء:'),
                  const SizedBox(height: 6),
                  for (final n in under)
                    Text('• $n',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  const Text('ارفع السعر أو قلّل الخصم — البيع تحت سعر الشراء '
                      'محتاج صلاحية «البيع تحت سعر التكلفة».'),
                ],
              ),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(d), child: const Text('تمام')),
              ],
            ),
          ),
        );
        return;
      }
    }
    final over = await _overCustody();
    if (over.isNotEmpty) return _warnOverCustody(over);
    final expected = _total + (_prevBalance > 0 ? _prevBalance : 0);
    if (_cashAmount > expected + 0.0001) {
      final surplus = _cashAmount - expected;
      if (!mounted) return;
      final ok = await showDialog<bool>(
        context: context,
        builder: (d) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text('المدفوع أكتر من المستحق'),
            content: Text(
                'الفاتورة ${_money(_total)}'
                '${_prevBalance > 0.001 ? ' واللي عليه ${_money(_prevBalance)}' : ''}'
                '، وإنت بتقبض ${_money(_cashAmount)}.'
                '\n\nالزيادة ${_money(surplus)} هتتقيّد لصالح العميل.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(d, false),
                  child: const Text('أعدّل الرقم')),
              FilledButton(
                  onPressed: () => Navigator.pop(d, true),
                  child: const Text('أيوه اقبض')),
            ],
          ),
        ),
      );
      if (ok != true) return;
      if (!mounted) return;
    }

    if (_cashAmount > 0.001 && !await _confirmTreasury()) return;

    setState(() => _saving = true);
    try {
      final uuid = 'inv-${DateTime.now().microsecondsSinceEpoch}-'
          '${Random().nextInt(4294967296).toRadixString(16)}';
      if (_isEditing) {
        final ok = await LocalDb.instance.updateQueuedSaleInvoice(
          localId: _editingId!,
          customerId: _customer!.id,
          customerName: _customer!.name,
          family: _family,
          invoiceDate: _date.toIso8601String().substring(0, 10),
          cashAmount: _cashAmount,
          creditAmount: _credit,
          total: _total,
          notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
          couponsJson: _couponsJson(),
          prevBalance: _prevBalance,
          prevBalancesJson: _prevBalancesJson(),
          isBonus: _isBonus,
          bonusForInvoiceId: _bonusFor?.serverId,
          bonusForClientUuid: _bonusFor?.clientUuid,
          bonusForNumber: _bonusFor?.number,
          lines: _lines,
        );
        if (!mounted) return;
        if (!ok) {
          _say('الفاتورة اترفعت للنظام وهي بتتعدّل — التعديل اتلغى. كلّم المكتب لو فيها غلط.');
          Navigator.pop(context, true);
          return;
        }
        if (!mounted) return;
        Navigator.pop(context, true);
        return;
      }
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
        prevBalance: _prevBalance,
        prevBalancesJson: _prevBalancesJson(),
        isBonus: _isBonus,
        bonusForInvoiceId: _bonusFor?.serverId,
        bonusForClientUuid: _bonusFor?.clientUuid,
        bonusForNumber: _bonusFor?.number,
        lines: _lines,
      );
      if (!mounted) return;
      if (!mounted) return;
      final rows = await LocalDb.instance.saleInvoices();
      final saved = rows.firstWhere((r) => r['local_id'] == localId, orElse: () => {});
      final landed = (saved['synced'] as int?) == 1;
      if (!mounted) return;
      if (!landed) {
        _say('اتحفظت على الجهاز. اعمل «مزامنة الآن» عشان ترفعها وتطبعها — '
            'وتقدر تعدّلها لحد ساعتها.');
        Navigator.pop(context, true);
        return;
      }
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
    final t = _blank(l.quantity);
    if (c.text == t) return;
    c.value = TextEditingValue(
      text: t, selection: TextSelection.collapsed(offset: t.length));
  }

  Future<void> _pickBonusTarget() async {
    if (_customer == null) return _say('اختار العميل الأول');
    final picked = await showModalBottomSheet<_BonusTarget>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _BonusTargetSheet(
          customerId: _customer!.id,
          customerName: _customer!.name,
          exceptLocalId: _editingId),
    );
    if (picked == null || !mounted) return;
    setState(() => _bonusFor = picked.isNone ? null : picked);
  }

  Widget _bonusStrip() {
    final t = _bonusFor;
    return Material(
      color: const Color(0xFFFFF4E5),
      child: InkWell(
        onTap: _pickBonusTarget,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
          child: Row(
            children: [
              const Icon(Icons.card_giftcard, color: AppColors.accent, size: 22),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('فاتورة بونص — هدية بقيمة صفر',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                    Text(
                        t == null
                            ? 'على فاتورة بيع (اختياري) — اضغط لو عايز تربطه بفاتورة'
                            : 'على فاتورة بيع: ${t.label}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 12,
                            color: t == null ? Colors.black54 : Colors.black87)),
                  ],
                ),
              ),
              if (t != null)
                IconButton(
                  tooltip: 'من غير ربط',
                  icon: const Icon(Icons.close, size: 18, color: Colors.black45),
                  onPressed: () => setState(() => _bonusFor = null),
                )
              else
                const Icon(Icons.chevron_left, color: Colors.black45),
            ],
          ),
        ),
      ),
    );
  }

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
    if (_headerOpen) _scrollTo(0);
  }

  void _scrollTo(double offset) {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(offset,
        duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  }

  String get _fingerprint {
    final ls = [
      for (final l in _lines)
        '${l.itemId}:${_qtyCtl[l.itemId]?.text ?? l.quantity}'
            ':${_priceCtl[l.itemId]?.text ?? l.unitPrice}'
            ':${l.fixedDiscountPct}'
            ':${_discCtl[l.itemId]?.text ?? l.variableDiscountPct}'
    ];
    final cs = [
      for (final c in _coupons) '${c.kind ?? ''}|${c.serialFrom}|${c.serialTo}'
    ];
    return '${_customer?.id ?? ''}~${_family ?? ''}~${_cash.text.trim()}'
        '~${_notes.text.trim()}~${ls.join(',')}~${cs.join(',')}'
        '~$_isBonus~${_bonusFor?.key ?? ''}';
  }

  String? _baseline;

  bool get _hasWork {
    final base = _baseline;
    if (base != null) return _fingerprint != base;
    return _lines.isNotEmpty ||
        _customer != null ||
        _coupons.any((c) => !c.isEmpty) ||
        _notes.text.trim().isNotEmpty;
  }

  Future<bool> _confirmLeave() async {
    if (!_hasWork || _saving) return true;
    final leave = await showDialog<bool>(
      context: context,
      builder: (dctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: Row(children: [
            const Icon(Icons.warning_amber_rounded, color: AppColors.danger),
            const SizedBox(width: 8),
            Expanded(child: Text(_isEditing ? 'تسيب التعديل؟' : 'تسيب الفاتورة؟')),
          ]),
          content: Text(_isEditing
              ? 'التعديلات اللي عملتها هتروح، والفاتورة هتفضل زي ما كانت.'
              : _lines.isEmpty
                  ? 'اللي كتبته هيروح ومش هيترجع.'
                  : 'فيها ${_lines.length} صنف '
                      '${_isBonus ? 'بقيمة ${_money(_bonusValue)}' : 'بإجمالي ${_money(_total)}'}'
                      ' — هتروح كلها ومش هترجع.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dctx, false),
                child: Text(_isEditing ? 'أكمّل التعديل' : 'أكمّل الفاتورة')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(dctx, true),
              child: const Text('اخرج واسيبها'),
            ),
          ],
        ),
      ),
    );
    return leave == true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_hasWork,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (!await _confirmLeave()) return;
        if (!mounted) return;
        Navigator.pop(this.context);
      },
      child: Scaffold(
      appBar: AppBar(title: Text(
          '${_isBonus ? (_isEditing ? 'تعديل فاتورة بونص' : 'فاتورة بونص') : (_isEditing ? 'تعديل فاتورة' : 'فاتورة بيع')}'
          '${_family == null ? '' : ' — $_family'}')),
      body: Column(
        children: [
          _headerStrip(),
          const Divider(height: 1),
          if (_isBonus) ...[
            _bonusStrip(),
            const Divider(height: 1),
          ],
          Expanded(child: _linesList()),
        ],
      ),
      bottomNavigationBar: _bottomBar(),
      ),
    );
  }

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
              onTap: _customer == null && !_headerOpen ? _pickCustomer : _toggleHeader,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
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
          Padding(
            padding: const EdgeInsets.all(28),
            child: Text(
                _isBonus
                    ? 'مافيش أصناف على البونص لسه.\n'
                        'اضغط «صنف» فوق وضيف البضاعة الهدية — '
                        'السعر من الشريحة والخصم ١٠٠٪ لوحدهم.'
                    : 'مافيش أصناف على الفاتورة لسه.\n'
                        'اضغط «صنف» فوق عشان تضيف — أو سيبها من غير أصناف\n'
                        'وسجّل دفتر كوبونات بس تحت.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.black54)),
          )
        else
          for (var i = 0; i < _lines.length; i++) _lineTile(i),
        _paymentCard(),
      ],
    );
  }

  Widget _lineTile(int i) {
    final l = _lines[i];
    final ctl = _qtyCtl.putIfAbsent(
        l.itemId, () => TextEditingController(text: _blank(l.quantity)));
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
                if (!_isBonus && l.isFull && l.gross > 0) ...[
                  Text(_money(l.gross),
                      style: const TextStyle(
                          fontSize: 11,
                          color: Colors.black45,
                          decoration: TextDecoration.lineThrough)),
                  const SizedBox(width: 4),
                ],
                Text('${_money(_isBonus ? netOf(l.gross, l.fixedDiscountPct) : l.net)}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                        color: AppColors.primary)),
              ],
            ),
            if (_isOver(l))
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded,
                        size: 14, color: AppColors.danger),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        (_holds[l.itemId] ?? const []).isNotEmpty
                            ? 'المتاح ${_qty(_freeOf(l.itemId))} — والباقي محجوز على '
                                '${_holds[l.itemId]!.map(_holdLabel).join('، ')}'
                            : _freeOf(l.itemId) <= 0
                                ? 'الصنف ده خلص من عربيتك — الفاتورة مش هتتحفظ بيه'
                                : 'المتاح في عربيتك ${_qty(_freeOf(l.itemId))} بس',
                        style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.danger,
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
            if (!_isBonus && l.isFull)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    Icon(Icons.card_giftcard_outlined,
                        size: 14, color: AppColors.danger),
                    SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        'خصم ١٠٠٪ = بونص — الهدية بتتعمل من «فاتورة بونص» مش هنا',
                        style: TextStyle(
                            fontSize: 11,
                            color: AppColors.danger,
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
            if (_belowCost(l))
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    Icon(Icons.trending_down,
                        size: 14,
                        color: _canSellBelowCost ? Colors.orange : AppColors.danger),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        _canSellBelowCost
                            ? 'سعر البيع أقل من سعر الشراء'
                            : 'سعر البيع أقل من سعر الشراء — الفاتورة مش هتتحفظ كده',
                        style: TextStyle(
                            fontSize: 11,
                            color: _canSellBelowCost
                                ? Colors.orange.shade800
                                : AppColors.danger,
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
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
                        () => TextEditingController(text: _blank(l.unitPrice))),
                    onChanged: (v) => setState(() => l.unitPrice = v),
                    readOnly: _isBonus || l.fixedDiscountPct > 0,
                    netPrice: !_isBonus && l.fixedDiscountPct > 0
                        ? netOf(l.unitPrice, l.discountPct)
                        : null,
                  ),
                ),
                if (!_isBonus) ...[
                const SizedBox(width: 6),
                Expanded(
                  child: _inlineField(
                    label: 'خصم %',
                    controller: _discCtl.putIfAbsent(
                        l.itemId,
                        () => TextEditingController(
                            text: _blank(l.variableDiscountPct))),
                    onChanged: (v) => setState(() => l.variableDiscountPct = v),
                  ),
                ),
                ],
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

  Widget _inlineField({
    required String label,
    required TextEditingController controller,
    required void Function(double) onChanged,
    bool readOnly = false,
    double? netPrice,
  }) {
    if (netPrice != null) {
      return InputDecorator(
        decoration: InputDecoration(
          labelText: 'السعر بعد الخصم',
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        ),
        child: Text(_trim(netPrice),
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: Colors.black54)),
      );
    }
    return TextFormField(
      controller: controller,
      readOnly: readOnly,
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

  Widget _paymentCard() {
    return Card(
      margin: const EdgeInsets.fromLTRB(8, 10, 8, 8),
      color: const Color(0xFFF3F8FB),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_isBonus) ...[
              const Row(
                children: [
                  Icon(Icons.card_giftcard_outlined,
                      size: 18, color: AppColors.accent),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text('بضاعة هدية — خصم ١٠٠٪ على إجمالي الفاتورة، ومن غير فلوس',
                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  ),
                ],
              ),
              const Divider(height: 18),
              _totalRow('قيمة البضاعة قبل الخصم', _money(_bonusValue)),
              const SizedBox(height: 6),
              _totalRow('الخصم على الإجمالي ١٠٠٪', '− ${_money(_bonusValue)}',
                  color: AppColors.accent),
              const Divider(height: 18),
              _totalRow('صافي الفاتورة', _money(0), big: true),
              const SizedBox(height: 4),
              const Text('البونص مابيلمسش حساب العميل — مافيش دفع ولا تحصيل عليه.',
                  style: TextStyle(fontSize: 11, color: Colors.black54)),
            ] else ...[
            const Text('الدفع',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            TextField(
              controller: _cash,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'المدفوع نقداً',
              ),
              onChanged: (_) => setState(() {}),
            ),
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
              if (_customer!.familyBalances.isNotEmpty)
                for (final f in const ['أبيض', 'بولي'])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: _totalRow('مديونية $f', _money(_familyBalance(f)),
                        color: _familyBalance(f) > 0.001
                            ? AppColors.danger
                            : AppColors.primary,
                        highlight: f == _family),
                  ),
              _totalRow(
                  _customer!.familyBalances.isEmpty
                      ? 'مديونية العميل (حساب واحد مش مقسوم)'
                      : 'حساب سابق على العميل',
                  _money(_prevBalance),
                  color: _prevBalance > 0.001 ? AppColors.danger : AppColors.primary),
              const Divider(height: 18),
            ],
            if (_cashAmount > 0.001) ...[
              _totalRow('المدفوع نقداً', '− ${_money(_cashAmount)}',
                  color: AppColors.primary),
              const SizedBox(height: 6),
            ],
            _totalRow('الباقي على العميل', _money(_dueAfter), big: true),
            ],
            const SizedBox(height: 10),
            TextField(
              controller: _notes,
              decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
              onChanged: (_) => setState(() {}),
            ),
            if (!_isBonus || _coupons.any((c) => !c.isEmpty))
              SaleCouponsSection(
                  rows: _coupons,
                  custody: _couponCustody,
                  onChanged: () => setState(() {})),
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
        Text('$value',
            style: TextStyle(
                fontSize: big ? 22 : 16,
                fontWeight: FontWeight.w800,
                color: color ?? (big ? AppColors.primary : Colors.black87))),
      ],
    );
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
                    Text(_isBonus ? 'الصافي' : 'الإجمالي',
                        style: TextStyle(
                            fontSize: 12,
                            color: _isBonus ? AppColors.accent : Colors.black54,
                            fontWeight:
                                _isBonus ? FontWeight.w800 : FontWeight.w400)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text('${_money(_total)}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              color: AppColors.primary)),
                    ),
                    Text(
                        _isBonus
                            ? 'قيمة البضاعة قبل الخصم ${_money(_bonusValue)}'
                            : 'باقي ${_money(_dueAfter)}',
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
              label: Text(_saving
                  ? 'بيحفظ…'
                  : (_isBonus ? 'حفظ البونص' : 'حفظ الفاتورة')),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            ),
          ],
        ),
      ),
    );
  }
}

class _BonusTarget {
  const _BonusTarget({
    this.serverId,
    this.clientUuid,
    this.number,
    this.date,
    this.net,
    this.onDevice = false,
    this.repName,
  }) : isNone = false;

  const _BonusTarget.none()
      : serverId = null,
        clientUuid = null,
        number = null,
        date = null,
        net = null,
        onDevice = false,
        repName = null,
        isNone = true;

  final bool isNone;
  final int? serverId;
  final String? clientUuid;

  final String? number;
  final String? date;
  final double? net;

  final bool onDevice;

  final String? repName;

  String get key => '${serverId ?? ''}|${clientUuid ?? ''}';

  String get label => [
        number ?? 'فاتورة لسه على الجهاز',
        if (date != null && date!.isNotEmpty) date!,
        if (net != null) '${_money(net!)}',
        if (onDevice && number == null) 'بتترفع قبل البونص',
      ].join(' · ');
}

class _BonusTargetSheet extends StatefulWidget {
  const _BonusTargetSheet(
      {required this.customerId, required this.customerName, this.exceptLocalId});

  final int customerId;
  final String customerName;
  final int? exceptLocalId;

  @override
  State<_BonusTargetSheet> createState() => _BonusTargetSheetState();
}

class _BonusTargetSheetState extends State<_BonusTargetSheet> {
  List<_BonusTarget> _rows = [];
  bool _loading = true;

  String? _serverNote;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final local = await LocalDb.instance
        .saleInvoicesForBonus(widget.customerId, exceptLocalId: widget.exceptLocalId);
    if (!mounted) return;
    setState(() {
      _rows = [for (final r in local) _fromLocal(r, null)];
    });
    List<Map<String, dynamic>> server = const [];
    String? note;
    try {
      server = await ApiClient.instance.customerSaleInvoices(widget.customerId);
    } catch (_) {
      note = 'مافيش شبكة — ظاهر اللي على الجهاز بس';
    }
    if (!mounted) return;
    final byNumber = {
      for (final e in server)
        if (e['document_number'] != null) '${e['document_number']}': e
    };
    final localNumbers = <String>{};
    final rows = <_BonusTarget>[];
    for (final r in local) {
      final n = r['document_number'] as String?;
      if (n != null) localNumbers.add(n);
      rows.add(_fromLocal(r, n == null ? null : byNumber[n]?['id'] as int?));
    }
    for (final e in server) {
      final n = '${e['document_number'] ?? ''}';
      if (localNumbers.contains(n)) continue;
      rows.add(_BonusTarget(
        serverId: e['id'] as int?,
        number: n.isEmpty ? null : n,
        date: '${e['invoice_date'] ?? e['created_at'] ?? ''}'.split('T').first,
        net: double.tryParse('${e['net'] ?? ''}'),
        repName: e['rep_name'] as String?,
      ));
    }
    setState(() {
      _rows = rows;
      _serverNote = note;
      _loading = false;
    });
  }

  _BonusTarget _fromLocal(Map<String, Object?> r, int? serverId) => _BonusTarget(
        serverId: serverId,
        clientUuid: r['client_uuid'] as String?,
        number: r['document_number'] as String?,
        date: r['invoice_date'] as String?,
        net: (r['total'] as num?)?.toDouble(),
        onDevice: (r['synced'] as int? ?? 0) != 1,
      );

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.7,
      child: Column(
        children: [
          const SizedBox(height: 10),
          const Text('البونص على أنهي فاتورة بيع؟ (اختياري)',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                icon: const Icon(Icons.link_off, size: 18),
                label: const Text('من غير ربط — كمّل البونص'),
                onPressed: () => Navigator.pop(context, const _BonusTarget.none()),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
            child: Text('فواتير ${widget.customerName}',
                style: const TextStyle(fontSize: 12, color: Colors.black54)),
          ),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_serverNote != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(_serverNote!,
                  style: const TextStyle(fontSize: 11, color: AppColors.danger)),
            ),
          const Divider(height: 1),
          Expanded(
            child: _rows.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                          _loading
                              ? 'بيدوّر…'
                              : 'مافيش فواتير بيع للعميل ده.\n'
                                  'البونص يتحفظ عادي من غير ربط.',
                          textAlign: TextAlign.center),
                    ),
                  )
                : ListView.separated(
                    itemCount: _rows.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final t = _rows[i];
                      return ListTile(
                        leading: Icon(
                            t.onDevice ? Icons.schedule : Icons.receipt_long_outlined,
                            color: t.onDevice ? AppColors.accent : AppColors.primary),
                        title: Text(t.number ?? 'لسه على الجهاز — ما اترفعتش',
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text([
                          if (t.date != null && t.date!.isNotEmpty) t.date!,
                          if (t.net != null) '${_money(t.net!)}',
                          if (t.onDevice) 'في الطابور',
                          if (t.repName != null && t.repName!.isNotEmpty)
                            'مندوب: ${t.repName}',
                        ].join(' · ')),
                        onTap: () => Navigator.pop(context, t),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

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

String _blank(double v) => v == 0 ? '' : _trim(v);

class _OverLine {
  _OverLine(this.line, this.free, this.holds);
  final SaleDraftLine line;
  final double free;
  final List<PendingHold> holds;
}

String _holdLabel(PendingHold h) =>
    '${h.isBonus ? 'فاتورة بونص' : 'فاتورة'} ${h.customerName} اللي لسه ما اترفعتش';

String _qty(double v) => _trim(v);
