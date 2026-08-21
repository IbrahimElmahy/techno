import 'dart:math';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
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
  DateTime _date = DateTime.now();
  final _notes = TextEditingController();
  final _cash = TextEditingController(text: '0');
  final List<SaleDraftLine> _lines = [];
  bool _saving = false;

  @override
  void dispose() {
    _notes.dispose();
    _cash.dispose();
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
        if (it != null) l.unitPrice = it.priceFor(_customer!.priceTier);
      }
    });
  }

  Future<void> _addItem() async {
    if (_customer == null) {
      _say('اختار العميل الأول — سعر الصنف بيتحدّد بفئته.');
      return;
    }
    final onInvoice = {for (final l in _lines) l.itemId: l.quantity};
    final picked = await Navigator.push<SaleItem>(
      context,
      MaterialPageRoute(builder: (_) => SaleItemPickerScreen(alreadyOnInvoice: onInvoice)),
    );
    if (picked == null) return;
    final existing = _lines.indexWhere((l) => l.itemId == picked.itemId);
    setState(() {
      if (existing >= 0) {
        _lines[existing].quantity += 1;
      } else {
        _lines.add(SaleDraftLine(
          itemId: picked.itemId,
          itemName: picked.name,
          quantity: 1,
          // السعر والخصم من الصنف — الواحد بيراجع رقم، مش بيخترعه.
          unitPrice: picked.priceFor(_customer!.priceTier),
          discountPct: picked.defaultDiscountPct,
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
    if (_customer == null) return _say('اختار العميل');
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
      await LocalDb.instance.saveSaleInvoice(
        clientUuid: uuid,
        customerId: _customer!.id,
        customerName: _customer!.name,
        invoiceDate: _date.toIso8601String().substring(0, 10),
        cashAmount: _cashAmount,
        creditAmount: _credit,
        total: _total,
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        lines: _lines,
      );
      if (!mounted) return;
      // بنحاول نرفعها على طول — لو في شبكة بتروح دلوقتي، ولو مافيش بتفضل في الطابور
      // ومحدش بيقف مستني. الفشل هنا مش غلط: الفاتورة محفوظة.
      var pushed = false;
      try {
        pushed = (await ApiClient.instance.pushSaleInvoices()) > 0;
      } catch (_) {/* الطابور بيحاول تاني في شاشة المزامنة */}
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(pushed ? 'الفاتورة اترفعت ✔' : 'الفاتورة اتحفظت — هترفع مع المزامنة'),
        backgroundColor: AppColors.success,
      ));
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('فاتورة بيع')),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 120),
        children: [
          Card(
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
                        ].join(' · ')),
                  trailing: const Icon(Icons.chevron_left),
                  onTap: _pickCustomer,
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.event_outlined, color: AppColors.primary),
                  title: const Text('تاريخ الفاتورة'),
                  subtitle: Text(_date.toIso8601String().substring(0, 10)),
                  trailing: const Icon(Icons.edit_calendar_outlined),
                  onTap: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _date,
                      firstDate: DateTime.now().subtract(const Duration(days: 60)),
                      lastDate: DateTime.now(),
                    );
                    if (d != null) setState(() => _date = d);
                  },
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
            child: FilledButton.icon(
              onPressed: _addItem,
              icon: const Icon(Icons.add),
              label: const Text('إضافة صنف'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            ),
          ),
          if (_lines.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('مافيش أصناف على الفاتورة لسه.', textAlign: TextAlign.center),
            )
          else
            for (var i = 0; i < _lines.length; i++) _lineCard(i),
          _totalsCard(),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(
                    width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save_outlined),
            label: Text(_saving ? 'بيحفظ…' : 'حفظ الفاتورة'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          ),
        ),
      ),
    );
  }

  Widget _lineCard(int i) {
    final l = _lines[i];
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(l.itemName,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                  onPressed: () => setState(() => _lines.removeAt(i)),
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: _numField(
                    label: 'الكمية',
                    value: l.quantity,
                    onChanged: (v) => setState(() => l.quantity = v),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _numField(
                    label: 'السعر',
                    value: l.unitPrice,
                    onChanged: (v) => setState(() => l.unitPrice = v),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _numField(
                    label: 'خصم %',
                    value: l.discountPct,
                    onChanged: (v) => setState(() => l.discountPct = v),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text('الإجمالي: ${_money(l.net)} ج.م',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
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

  Widget _totalsCard() {
    return Card(
      color: const Color(0xFFF3F8FB),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            _totalRow('إجمالي الفاتورة', _money(_total), big: true),
            const SizedBox(height: 10),
            TextField(
              controller: _cash,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'المدفوع نقداً',
                suffixText: 'ج.م',
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
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
