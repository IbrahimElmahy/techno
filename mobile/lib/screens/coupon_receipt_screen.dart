import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

class CouponReceiptScreen extends StatefulWidget {
  const CouponReceiptScreen({super.key, this.existing});

  final Map<String, Object?>? existing;

  @override
  State<CouponReceiptScreen> createState() => _CouponReceiptScreenState();
}

class _CouponEntry {
  _CouponEntry(this.serial);
  final String serial;

  String status = 'pending';
  String? customerName;
  int? customerId;
  String? documentNumber;

  List<String> kinds = const [];

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

  DateTime _received = DateTime.now();

  String _customerType = 'plumber';

  String _kind = 'عادي';
  final _valueCtrl = TextEditingController();

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
      final res =
          await ApiClient.instance.checkCoupon(entry.serial, couponKind: _kind);
      if (!mounted) return;
      setState(() {
        entry.status = res['status'] as String? ?? 'unknown';
        entry.customerName = res['customer_name'] as String?;
        entry.customerId = res['customer_id'] as int?;
        entry.documentNumber = res['document_number'] as String?;
        entry.kinds = [
          for (final k in (res['kinds'] as List? ?? const [])) k.toString(),
        ];
        if (entry.isGood && _customerId == null) {
          _customerId = entry.customerId;
          _customerName = entry.customerName;
        }
      });
      if (entry.status == 'unknown') {
        _toast('الكوبون ${entry.serial} مش متصرّف من النظام');
      } else if (entry.status == 'received') {
        _toast('الكوبون ${entry.serial} اتستلم قبل كده');
      } else if (entry.status == 'wrong_kind') {
        final where = entry.kinds.isEmpty ? '' : ' — موجود تحت: ${entry.kinds.join('، ')}';
        _toast('الكوبون ${entry.serial} مش متصرّف تحت «$_kind»$where');
      } else if (_customerId != null && entry.customerId != _customerId) {
        _toast('الكوبون ${entry.serial} متصرّف لعميل تاني');
      }
    } catch (_) {
      if (mounted) setState(() => entry.status = 'pending');
    }
  }

  static const _maxRange = 2000;

  Future<void> _addRange() async {
    final a = int.tryParse(_fromCtrl.text.trim());
    final b = int.tryParse(_toCtrl.text.trim());
    final first = a ?? b;
    final last = b ?? a;
    if (first == null || last == null) {
      _toast('اكتب رقم الكوبون في «من رقم»');
      return;
    }
    if (last < first) {
      _toast('رقم النهاية أصغر من البداية');
      return;
    }
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

  bool get _hasRejects => _entries.any((e) =>
      e.status == 'unknown' || e.status == 'received' || e.status == 'wrong_kind');

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
        _toast('اترفع للسيرفر — بانتظار اعتماد المكتب');
      } catch (e) {
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
      child: PopScope(
        canPop: _entries.isEmpty,
        onPopInvokedWithResult: (didPop, _) async {
          if (didPop || !mounted) return;
          final navigator = Navigator.of(context);
          if (await _confirmLeave() && mounted) navigator.pop();
        },
        child: Scaffold(
        appBar: AppBar(title: Text(_isEdit ? 'تعديل استلام' : 'استلام كوبونات')),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
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
                          onChanged: (_) => setState(() {}),
                          decoration: const InputDecoration(
                            isDense: true,
                            labelText: 'القيمة',
                            hintText: '0.00',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),

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

                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _fromCtrl,
                          keyboardType: TextInputType.number,
                          onSubmitted: (_) => _addRange(),
                          decoration: const InputDecoration(labelText: 'من رقم'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _toCtrl,
                          keyboardType: TextInputType.number,
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _addRange(),
                          decoration: const InputDecoration(
                              labelText: 'إلى رقم', hintText: 'فاضي = كوبون واحد'),
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
                      label: const Text('إضافة'),
                    ),
                  ),
                ],
              ),
            ),
            if (_customerName != null)
              Container(
                width: double.infinity,
                color: AppColors.primary.withValues(alpha: 0.08),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
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
                          dense: true,
                          leading: _statusIcon(e.status),
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
                          Text('${_totalValue.toStringAsFixed(2)}',
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
      case 'wrong_kind':
        return const Icon(Icons.rule_folder_outlined, color: AppColors.danger);
      default:
        return const Icon(Icons.cloud_off_outlined, color: Colors.grey);
    }
  }

  Widget _statusChip(_CouponEntry e) {
    final (text, color) = switch (e.status) {
      'valid' => ((e.customerName ?? 'سليم'), AppColors.success),
      'unknown' => ('مش متصرّف من النظام', AppColors.danger),
      'received' => ('اتستلم قبل كده', AppColors.accent),
      'wrong_kind' => (
          e.kinds.isEmpty ? 'فئة تانية' : 'فئته: ${e.kinds.join('، ')}',
          AppColors.danger,
        ),
      _ => ('هيتراجع مع المزامنة', Colors.blueGrey),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
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
