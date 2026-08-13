import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
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

  @override
  void dispose() {
    _serialCtrl.dispose();
    _notesCtrl.dispose();
    _fromCtrl.dispose();
    _toCtrl.dispose();
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
