import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart' as intl;

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// استلام الكوبونات من العميل.
///
/// A coupon is a piece of paper with a number on it, and the number alone proves nothing —
/// anyone can write one. It only counts if it falls inside the serial range issued on a real
/// invoice to this customer, which is what the server checks.
///
/// So each coupon is checked AS IT IS TYPED, not when the handover is posted. The rep finds out
/// a coupon is bad while the customer is still standing in front of him, which is the only
/// moment the information is worth anything.
///
/// With no signal the coupon still goes on the list — it is queued and checked when the phone
/// next reaches the server. A rep at a door in a village cannot be told to come back later.
class CouponReceiptScreen extends StatefulWidget {
  const CouponReceiptScreen({super.key});

  @override
  State<CouponReceiptScreen> createState() => _CouponReceiptScreenState();
}

class _CouponEntry {
  _CouponEntry(this.serial);
  final String serial;

  /// valid | unknown | received | pending (couldn't reach the server yet)
  String status = 'pending';
  String? customerName;
  int? customerId;
  String? documentNumber;

  bool get isGood => status == 'valid';
}

class _CouponReceiptScreenState extends State<CouponReceiptScreen> {
  final _serialCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  final _fromCtrl = TextEditingController();
  final _toCtrl = TextEditingController();
  final _entries = <_CouponEntry>[];
  final _focus = FocusNode();

  int? _customerId;
  String? _customerName;
  bool _saving = false;

  /// تاريخ الاستلام — مش وقت الكتابة.
  ///
  /// A rep writes up yesterday's round this morning. Stamping «now» would file every receipt on
  /// the day it was typed, and the totals per customer would sit in the wrong week.
  DateTime _received = DateTime.now();

  /// «سباك» أو «تاجر» — بيضيّق قايمة العملاء.
  String _customerType = 'plumber';

  /// نوع الكوبون وقيمته زي ما المندوب قالهم.
  ///
  /// The server works the true kind out from the serial's issued range, but only once the phone
  /// reaches it. A rep with no signal still has to tell the customer «ثلاثة ذهبي» before he walks
  /// away, so what he declares is what the screen adds up and what travels with the sync.
  String _kind = 'silver';
  final _valueCtrl = TextEditingController();

  /// العملاء المتاحين للمندوب — من الكاش، فبيشتغلوا من غير نت.
  List<CustomerRef> _customers = [];
  final _customerSearch = TextEditingController();

  static const kinds = <String, String>{
    'standard': 'عادي',
    'silver': 'فضي',
    'gold': 'ذهبي',
    'diamond': 'ماسي',
  };

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  Future<void> _loadCustomers([String q = '']) async {
    final rows = await LocalDb.instance.customers(query: q);
    if (mounted) setState(() => _customers = rows);
  }

  @override
  void dispose() {
    _serialCtrl.dispose();
    _notesCtrl.dispose();
    _fromCtrl.dispose();
    _toCtrl.dispose();
    _valueCtrl.dispose();
    _customerSearch.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _add(String raw) async {
    final serial = raw.trim();
    if (serial.isEmpty) return;
    if (_entries.any((e) => e.serial == serial)) {
      _toast('الكوبون ده مضاف بالفعل');
      return;
    }
    final entry = _CouponEntry(serial);
    setState(() => _entries.insert(0, entry));
    _serialCtrl.clear();
    _focus.requestFocus();
    await _verify(entry);
  }

  Future<void> _verify(_CouponEntry entry) async {
    try {
      final res = await ApiClient.instance.checkCoupon(entry.serial);
      if (!mounted) return;
      setState(() {
        entry.status = res['status'] as String? ?? 'unknown';
        entry.customerName = res['customer_name'] as String?;
        entry.customerId = res['customer_id'] as int?;
        entry.documentNumber = res['document_number'] as String?;
        // The first verified coupon settles whose handover this is; the rest must agree,
        // because a receipt credited to the wrong customer is worse than no receipt.
        if (entry.isGood && _customerId == null) {
          _customerId = entry.customerId;
          _customerName = entry.customerName;
        }
      });
      if (entry.status == 'unknown') {
        _toast('الكوبون ${entry.serial} مش متصرّف من النظام');
      } else if (entry.status == 'received') {
        _toast('الكوبون ${entry.serial} اتستلم قبل كده');
      } else if (_customerId != null && entry.customerId != _customerId) {
        _toast('الكوبون ${entry.serial} متصرّف لعميل تاني');
      }
    } catch (_) {
      // Offline: leave it pending. The server checks it again on sync and rejects the whole
      // handover if it is bad — nothing here can be accepted on the phone's word alone.
      if (mounted) setState(() => entry.status = 'pending');
    }
  }

  Future<void> _addRange() async {
    final first = int.tryParse(_fromCtrl.text.trim());
    final last = int.tryParse(_toCtrl.text.trim());
    if (first == null || last == null) {
      _toast('النطاق لازم يكون أرقام');
      return;
    }
    if (last < first) {
      _toast('رقم النهاية أصغر من البداية');
      return;
    }
    if (last - first + 1 > 100) {
      _toast('النطاق كبير — أقصى ١٠٠ كوبون في المرة');
      return;
    }
    _fromCtrl.clear();
    _toCtrl.clear();
    for (var n = first; n <= last; n++) {
      await _add(n.toString());
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg)));
  }

  /// الكوبونات المقبولة مجمّعة بالنوع — النوع اللي المندوب قاله.
  List<(String, int)> get _summary {
    final counted = _entries.where((e) => e.isGood || e.status == 'pending').length;
    if (counted == 0) return const [];
    return [(kinds[_kind] ?? _kind, counted)];
  }

  double get _totalValue {
    final each = double.tryParse(_valueCtrl.text.trim()) ?? 0;
    final counted = _entries.where((e) => e.isGood || e.status == 'pending').length;
    return each * counted;
  }

  bool get _hasRejects =>
      _entries.any((e) => e.status == 'unknown' || e.status == 'received');

  Future<void> _save() async {
    if (_entries.isEmpty) {
      _toast('مافيش كوبونات');
      return;
    }
    if (_hasRejects) {
      _toast('شيل الكوبونات المرفوضة الأول');
      return;
    }
    setState(() => _saving = true);
    try {
      final uuid = 'cr-${DateTime.now().microsecondsSinceEpoch}';
      await LocalDb.instance.saveCouponReceipt(
        clientUuid: uuid,
        serials: [for (final e in _entries) e.serial],
        customerId: _customerId,
        customerName: _customerName,
        customerType: _customerType,
        receivedDate: intl.DateFormat('yyyy-MM-dd').format(_received),
        couponKind: _kind,
        couponValue: double.tryParse(_valueCtrl.text.trim()),
        notes: _notesCtrl.text.trim().isEmpty ? null : _notesCtrl.text.trim(),
      );
      try {
        await ApiClient.instance.pushCouponReceipts();
        _toast('اتسجّل الاستلام واترفع للسيرفر');
      } catch (e) {
        // Saved locally either way — the sync screen will push it when there is signal.
        _toast('اتسجّل على الجهاز، هيترفع مع المزامنة (${e.toString()})');
      }
      if (mounted) Navigator.pop(context, true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final good = _entries.where((e) => e.isGood).length;
    final pending = _entries.where((e) => e.status == 'pending').length;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('استلام كوبونات')),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // ١) تاريخ الاستلام
                  InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _received,
                        firstDate: DateTime(2024),
                        lastDate: DateTime.now().add(const Duration(days: 1)),
                      );
                      if (picked != null) setState(() => _received = picked);
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'تاريخ الاستلام',
                        prefixIcon: Icon(Icons.event_outlined),
                      ),
                      child: Text(intl.DateFormat('yyyy/MM/dd').format(_received)),
                    ),
                  ),
                  const SizedBox(height: 10),

                  // ٢) نوع الكوبون
                  DropdownButtonFormField<String>(
                    initialValue: _kind,
                    decoration: const InputDecoration(
                      labelText: 'نوع الكوبون',
                      prefixIcon: Icon(Icons.workspace_premium_outlined),
                    ),
                    items: [
                      for (final e in kinds.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (v) => setState(() => _kind = v ?? _kind),
                  ),
                  const SizedBox(height: 10),

                  // ٣) قيمة الكوبون — فاضية عشان المندوب يكتبها بنفسه
                  TextField(
                    controller: _valueCtrl,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    // عشان الإجمالي في الملخص يتحرك مع الكتابة.
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'قيمة الكوبون',
                      hintText: 'اكتب القيمة',
                      prefixIcon: Icon(Icons.payments_outlined),
                      suffixText: 'ج.م',
                    ),
                  ),
                  const SizedBox(height: 10),

                  // ٤) سباك ولا تاجر
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'plumber', label: Text('سباك')),
                      ButtonSegment(value: 'merchant', label: Text('تاجر')),
                    ],
                    selected: {_customerType},
                    onSelectionChanged: (v) => setState(() => _customerType = v.first),
                  ),
                  const SizedBox(height: 10),

                  // ٥) العميل — من المتاحين للمندوب، من الكاش فبيشتغل من غير نت
                  Autocomplete<CustomerRef>(
                    displayStringForOption: (c) => c.name,
                    optionsBuilder: (v) {
                      final q = v.text.trim();
                      if (q.isEmpty) return _customers.take(15);
                      return _customers.where((c) => c.name.contains(q));
                    },
                    onSelected: (c) => setState(() {
                      _customerId = c.id;
                      _customerName = c.name;
                    }),
                    fieldViewBuilder: (ctx, ctrl, focus, _) => TextField(
                      controller: ctrl,
                      focusNode: focus,
                      onChanged: (q) {
                        _loadCustomers(q);
                        // Typing past a chosen name unlinks it: a receipt credited to somebody the
                        // rep already moved on from is worse than one with no name yet.
                        if (_customerName != null && q != _customerName) {
                          setState(() { _customerId = null; _customerName = null; });
                        }
                      },
                      decoration: InputDecoration(
                        labelText: 'العميل',
                        hintText: 'ابحث بالاسم',
                        prefixIcon: const Icon(Icons.person_outline),
                        suffixIcon: _customerId == null
                            ? null
                            : const Icon(Icons.check_circle, color: AppColors.success),
                      ),
                    ),
                  ),
                  const Divider(height: 26),

                  TextField(
                    controller: _serialCtrl,
                    focusNode: _focus,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.done,
                    inputFormatters: [LengthLimitingTextInputFormatter(24)],
                    decoration: const InputDecoration(
                      labelText: 'رقم الكوبون',
                      hintText: 'اكتب الرقم واضغط إدخال',
                      prefixIcon: Icon(Icons.confirmation_number_outlined),
                    ),
                    onSubmitted: _add,
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _fromCtrl,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'من رقم'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _toCtrl,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'إلى رقم'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.tonal(
                        onPressed: _addRange,
                        child: const Text('إضافة نطاق'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (_customerName != null)
              Container(
                width: double.infinity,
                color: AppColors.primary.withOpacity(0.08),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Text('العميل: $_customerName',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
            Expanded(
              child: _entries.isEmpty
                  ? const Center(child: Text('مافيش كوبونات مضافة'))
                  : ListView.separated(
                      itemCount: _entries.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final e = _entries[i];
                        return ListTile(
                          leading: _statusIcon(e.status),
                          title: Text(e.serial,
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(_statusText(e)),
                          trailing: IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () => setState(() => _entries.removeAt(i)),
                          ),
                        );
                      },
                    ),
            ),
            // قايمة المراجعة — اللي اتستلم فعلاً، مجمّع بالنوع.
            //
            // What the rep reads back to the customer before he leaves. It counts only the coupons
            // that were ACCEPTED: a rejected serial sitting in the list above is not something
            // anybody was handed.
            if (_entries.any((e) => e.isGood || e.status == 'pending'))
              Container(
                width: double.infinity,
                margin: const EdgeInsets.symmetric(horizontal: 12),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.blueGrey.shade100),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('ملخص الاستلام',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    for (final row in _summary)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(row.$1),
                            Text('${row.$2} كوبون',
                                style: const TextStyle(fontWeight: FontWeight.w700)),
                          ],
                        ),
                      ),
                    if (_totalValue > 0) ...[
                      const Divider(height: 18),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('الإجمالي',
                              style: TextStyle(fontWeight: FontWeight.w800)),
                          Text('${_totalValue.toStringAsFixed(2)} ج.م',
                              style: const TextStyle(
                                  fontWeight: FontWeight.w800, color: AppColors.success)),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    TextField(
                      controller: _notesCtrl,
                      decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'مقبول $good'
                            '${pending > 0 ? ' · بانتظار الاتصال $pending' : ''}'
                            '${_hasRejects ? ' · فيه مرفوض' : ''}',
                            style: TextStyle(
                                color: _hasRejects ? AppColors.danger : AppColors.success,
                                fontWeight: FontWeight.w700),
                          ),
                        ),
                        FilledButton.icon(
                          onPressed: _saving ? null : _save,
                          icon: const Icon(Icons.save_outlined),
                          label: Text(_saving ? 'جارِ الحفظ…' : 'تسجيل الاستلام'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusIcon(String status) {
    switch (status) {
      case 'valid':
        return const Icon(Icons.check_circle, color: AppColors.success);
      case 'unknown':
        return const Icon(Icons.cancel, color: AppColors.danger);
      case 'received':
        return const Icon(Icons.history, color: AppColors.accent);
      default:
        return const Icon(Icons.cloud_off_outlined, color: Colors.grey);
    }
  }

  String _statusText(_CouponEntry e) {
    switch (e.status) {
      case 'valid':
        return 'سليم — ${e.documentNumber ?? ''} · ${e.customerName ?? ''}';
      case 'unknown':
        return 'مش متصرّف من النظام';
      case 'received':
        return 'اتستلم قبل كده';
      default:
        return 'هيتراجع مع المزامنة';
    }
  }
}
