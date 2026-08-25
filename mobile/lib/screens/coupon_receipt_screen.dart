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
  const CouponReceiptScreen({super.key, this.existing});

  /// استلام متسجّل قبل كده وجاي يتعدّل — من صفحة المراجعة.
  ///
  /// Only ever passed for a receipt that has NOT synced. Once it is on the server it is a
  /// document, and a document is corrected by a new one, not by editing history under it.
  final Map<String, Object?>? existing;

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
  String _kind = 'عادي';
  final _valueCtrl = TextEditingController();

  /// العملاء المتاحين للمندوب — من الكاش، فبيشتغلوا من غير نت.
  List<CustomerRef> _customers = [];
  final _customerSearch = TextEditingController();

  static const kinds = <String, String>{
    'عادي': 'عادي',
    'فضي': 'فضي',
    'ذهبي': 'ذهبي',
    'ماسي': 'ماسي',
  };

  Map<String, String> _tiers = kinds;

  Future<void> _loadTiers() async {
    final rows = await LocalDb.instance.lookups('coupon_kind');
    if (!mounted) return;
    if (rows.isEmpty) {
      setState(() => _tiers = kinds);
      return;
    }
    setState(() {
      _tiers = {for (final o in rows) o.value: o.label};
      if (!_tiers.containsKey(_kind)) _kind = _tiers.keys.first;
    });
  }

  /// رقم الاستلام — ثابت من أول ما الشاشة فتحت، وبيتقفل على القديم لو بنعدّل.
  late final String _uuid;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _loadCustomers();
    _loadTiers();
    final e = widget.existing;
    _uuid = (e?['client_uuid'] as String?) ??
        'cr-${DateTime.now().microsecondsSinceEpoch}';
    if (e == null) return;
    // The saved row is flat text; unpacking it here is what makes «اضغط عليه وعدّل فيه» possible
    // at all — every field the rep typed has to come back exactly as he left it.
    _customerId = e['customer_id'] as int?;
    _customerName = e['customer_name'] as String?;
    _customerType = (e['customer_type'] as String?) ?? 'plumber';
    _kind = (e['coupon_kind'] as String?) ?? 'عادي';
    final v = e['coupon_value'] as num?;
    if (v != null) _valueCtrl.text = _fmtValue(v.toDouble());
    _notesCtrl.text = (e['notes'] as String?) ?? '';
    final d = e['received_date'] as String?;
    if (d != null) _received = DateTime.tryParse(d) ?? _received;
    for (final serial in ((e['serials'] as String?) ?? '').split(',')) {
      final t = serial.trim();
      if (t.isEmpty) continue;
      final entry = _CouponEntry(t)..status = 'valid'..customerName = _customerName;
      _entries.add(entry);
    }
  }

  static String _fmtValue(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

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

  /// أقصى عدد كوبونات في النطاق الواحد.
  static const _maxRange = 2000;

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
    // Raised from a hundred because a real book runs longer than that and the cap was refusing
    // honest work. It cannot go altogether: «من ١٢٠٠ إلى ١٢٠٠٠٠٠» is a slip of one finger, and
    // with no ceiling it builds a million rows and takes the screen down with it.
    if (last - first + 1 > _maxRange) {
      _toast('النطاق كبير — أقصى $_maxRange كوبون في المرة');
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
    return [(_tiers[_kind] ?? _kind, counted)];
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
      // نفس الـuuid لو بنعدّل: السطر القديم بيتشال والجديد بياخد مكانه، فمابيبقاش في
      // استلامين لنفس العملية.
      if (_isEdit) {
        await LocalDb.instance.deleteCouponReceipt(widget.existing!['local_id'] as int);
      }
      await LocalDb.instance.saveCouponReceipt(
        clientUuid: _uuid,
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
      // رجوع بالغلط كان بيضيّع الشغل.
      //
      // Nothing on this screen is saved until «تسجيل الاستلام»: a rep who has typed a book of
      // coupons and hits the back gesture loses every one of them with no warning and no way
      // back. It only asks when there IS something to lose.
      child: PopScope(
        canPop: _entries.isEmpty,
        onPopInvokedWithResult: (didPop, _) async {
          if (didPop || !mounted) return;
          if (await _confirmLeave()) {
            if (mounted) Navigator.pop(context);
          }
        },
        child: Scaffold(
        appBar: AppBar(title: Text(_isEdit ? 'تعديل استلام' : 'استلام كوبونات')),
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

                  // ٢) النوع والقيمة جنب بعض — سؤالين عن نفس الكوبون، فسطر واحد.
                  Row(
                    children: [
                      Expanded(
                        flex: 3,
                        child: DropdownButtonFormField<String>(
                          initialValue: _kind,
                          isDense: true,
                          decoration: const InputDecoration(
                            labelText: 'نوع الكوبون',
                            prefixIcon: Icon(Icons.workspace_premium_outlined),
                          ),
                          items: [
                            for (final e in _tiers.entries)
                              DropdownMenuItem(value: e.key, child: Text(e.value)),
                          ],
                          onChanged: (v) => setState(() => _kind = v ?? _kind),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: _valueCtrl,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          // عشان الإجمالي في الملخص يتحرك مع الكتابة.
                          onChanged: (_) => setState(() {}),
                          decoration: const InputDecoration(
                            isDense: true,
                            labelText: 'القيمة',
                            hintText: '0.00',
                            suffixText: 'ج.م',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),

                  // ٣) نوع العميل واسمه جنب بعض — «سباك أحمد» جملة واحدة مش سطرين.
                  Row(
                    children: [
                      SegmentedButton<String>(
                        style: const ButtonStyle(
                          visualDensity: VisualDensity(horizontal: -2, vertical: -2),
                        ),
                        segments: const [
                          ButtonSegment(value: 'plumber', label: Text('سباك')),
                          ButtonSegment(value: 'merchant', label: Text('تاجر')),
                        ],
                        selected: {_customerType},
                        showSelectedIcon: false,
                        onSelectionChanged: (v) => setState(() => _customerType = v.first),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Autocomplete<CustomerRef>(
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
                              // Typing past a chosen name unlinks it: a receipt credited to
                              // somebody the rep already moved on from is worse than one with no
                              // name yet.
                              if (_customerName != null && q != _customerName) {
                                setState(() { _customerId = null; _customerName = null; });
                              }
                            },
                            decoration: InputDecoration(
                              isDense: true,
                              labelText: 'العميل',
                              hintText: 'ابحث بالاسم',
                              suffixIcon: _customerId == null
                                  ? null
                                  : const Icon(Icons.check_circle,
                                      color: AppColors.success, size: 20),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 22),

                  // ٤) النطاق — ودي الطريقة الوحيدة لإدخال الكوبونات.
                  //
                  // The single «رقم الكوبون» box is gone: coupons are issued in numbered books, so
                  // a rep is always holding a run. One number is just a run of one — «من ١٢٠٠ إلى
                  // ١٢٠٠» — and keeping a second box for it meant two ways to do the same thing,
                  // with the wrong one grabbing the keyboard on open.
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
                          textInputAction: TextInputAction.done,
                          // Enter on «إلى» adds the run — the rep's hands are already on the
                          // number pad and reaching for a button breaks the rhythm.
                          onSubmitted: (_) => _addRange(),
                          decoration: const InputDecoration(labelText: 'إلى رقم'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _addRange,
                      icon: const Icon(Icons.playlist_add),
                      label: const Text('إضافة النطاق'),
                    ),
                  ),
                ],
              ),
            ),
            if (_customerName != null)
              Container(
                width: double.infinity,
                color: AppColors.primary.withOpacity(0.08),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text('العميل: $_customerName',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
            // القايمة بتاخد كل اللي فاضل — دي الحتة اللي المندوب بيراجعها قدام العميل، والحقول
            // فوق بقت مضغوطة عشان تسيبلها مكان.
            Expanded(
              child: _entries.isEmpty
                  ? const Center(child: Text('مافيش كوبونات مضافة'))
                  : ListView.separated(
                      itemCount: _entries.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final e = _entries[i];
                        return ListTile(
                          dense: true,
                          leading: _statusIcon(e.status),
                          // الحالة جنب الرقم، مش سطر تحته.
                          //
                          // A rejected coupon used to give «مش متصرّف من النظام» a full line of its
                          // own under the number, so a book of a hundred was a hundred repetitions
                          // of the same sentence and four numbers fit on the screen. Beside the
                          // number it is a chip the eye skips once it has read it — and for a
                          // coupon the system DOES know, that chip is the far more useful fact:
                          // اسم التاجر اللي الكوبون متصرّف له.
                          title: Row(
                            children: [
                              Text(e.serial,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700, fontSize: 15)),
                              const SizedBox(width: 10),
                              Flexible(child: _statusChip(e)),
                            ],
                          ),
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
                          label: Text(_saving
                              ? 'جارِ الحفظ…'
                              : (_isEdit ? 'حفظ التعديل' : 'تسجيل الاستلام')),
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
      ),
    );
  }

  /// سؤال قبل ما الشغل يضيع.
  Future<bool> _confirmLeave() async {
    final leave = await showDialog<bool>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تسيب الاستلام؟'),
          content: Text('عندك ${_entries.length} كوبون متسجّلين ولسه متسجّلوش. '
              'لو خرجت دلوقتي هيروحوا.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('أكمّل')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(c, true),
              child: const Text('اخرج وامسح'),
            ),
          ],
        ),
      ),
    );
    return leave ?? false;
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

  /// الكلمة اللي جنب الرقم — واسم التاجر لو النظام عارف الكوبون.
  Widget _statusChip(_CouponEntry e) {
    final (text, color) = switch (e.status) {
      // اسم التاجر هو المطلوب هنا، مش كلمة «سليم»: الكوبون السليم اللي المندوب بيستلمه من
      // تاجر، اللي يهمه يشوفه إن ده كوبون التاجر ده فعلاً.
      'valid' => ((e.customerName ?? 'سليم'), AppColors.success),
      'unknown' => ('مش متصرّف من النظام', AppColors.danger),
      'received' => ('اتستلم قبل كده', AppColors.accent),
      _ => ('هيتراجع مع المزامنة', Colors.blueGrey),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}
