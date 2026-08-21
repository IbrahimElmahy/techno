import 'dart:math';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// تحصيل من عميل — سند قبض من الشارع.
///
/// البيع والتحصيل بيحصلوا في نفس الزيارة غالباً: المندوب بيسلّم بضاعة وبياخد فلوس عن
/// اللي فات. فالتحصيل بيتكتب هنا زي الفاتورة بالظبط — طابور على الجهاز، ورفع لما الشبكة
/// تيجي، ورقم جهاز بيمنع إنه يتقيّد مرتين لو الرفع اتعاد.
///
/// **والتحصيل بيروح على إجمالي المديونية.** العميل ممكن يكون مدين على أكتر من خط منتجات،
/// والمندوب في الشارع مش بيعرف على أنهي واحد — فالسيرفر بيوزّع بالنسبة بدل ما حد يخمّن.
class CollectCashScreen extends StatefulWidget {
  const CollectCashScreen({super.key});

  @override
  State<CollectCashScreen> createState() => _CollectCashScreenState();
}

class _CollectCashScreenState extends State<CollectCashScreen> {
  CustomerRef? _customer;
  DateTime _date = DateTime.now();
  final _amount = TextEditingController();
  final _notes = TextEditingController();
  bool _saving = false;
  List<Map<String, Object?>> _recent = [];

  @override
  void initState() {
    super.initState();
    _loadRecent();
  }

  @override
  void dispose() {
    _amount.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _loadRecent() async {
    final rows = await LocalDb.instance.receipts();
    if (mounted) setState(() => _recent = rows.take(20).toList());
  }

  Future<void> _pickCustomer() async {
    final rows = await LocalDb.instance.customers(limit: 200);
    if (!mounted) return;
    final picked = await showModalBottomSheet<CustomerRef>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _PickSheet(rows: rows),
    );
    if (picked != null) setState(() => _customer = picked);
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amount.text.trim()) ?? 0;
    if (_customer == null) return _say('اختار العميل');
    if (amount <= 0) return _say('اكتب المبلغ');

    setState(() => _saving = true);
    try {
      final uuid = 'rcp-${DateTime.now().microsecondsSinceEpoch}-'
          '${Random().nextInt(1 << 32).toRadixString(16)}';
      await LocalDb.instance.saveReceipt(
        clientUuid: uuid,
        customerId: _customer!.id,
        customerName: _customer!.name,
        amount: amount,
        receiptDate: _date.toIso8601String().substring(0, 10),
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      );
      var pushed = false;
      try {
        pushed = (await ApiClient.instance.pushReceipts()) > 0;
      } catch (_) {/* الطابور بيحاول تاني في المزامنة */}
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(pushed ? 'التحصيل اترفع ✔' : 'التحصيل اتحفظ — هيرفع مع المزامنة'),
        backgroundColor: AppColors.success,
      ));
      setState(() {
        _amount.clear();
        _notes.clear();
        _customer = null;
      });
      _loadRecent();
    } catch (e) {
      if (mounted) _say('تعذّر الحفظ: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _say(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تحصيل من عميل')),
      body: ListView(
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.person_outline, color: AppColors.primary),
                  title: Text(_customer?.name ?? 'اختار العميل'),
                  trailing: const Icon(Icons.chevron_left),
                  onTap: _pickCustomer,
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.event_outlined, color: AppColors.primary),
                  title: const Text('تاريخ التحصيل'),
                  subtitle: Text(_date.toIso8601String().substring(0, 10)),
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
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  TextField(
                    controller: _amount,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
                    textAlign: TextAlign.center,
                    decoration: const InputDecoration(
                      labelText: 'المبلغ المحصّل',
                      suffixText: 'ج.م',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _notes,
                    decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.payments_outlined),
              label: Text(_saving ? 'بيحفظ…' : 'حفظ التحصيل'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            ),
          ),
          if (_recent.isNotEmpty) ...[
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Align(
                alignment: AlignmentDirectional.centerStart,
                child: Text('آخر التحصيلات',
                    style: TextStyle(fontWeight: FontWeight.w700, color: Colors.black54)),
              ),
            ),
            for (final r in _recent)
              ListTile(
                leading: Icon(
                  (r['synced'] as int?) == 1 ? Icons.check_circle : Icons.schedule,
                  color: (r['synced'] as int?) == 1 ? AppColors.success : AppColors.accent,
                ),
                title: Text(r['customer_name'] as String? ?? '—'),
                subtitle: Text([
                  r['receipt_date'] as String? ?? '',
                  if ((r['synced'] as int?) == 1)
                    r['document_number'] as String? ?? ''
                  else
                    'لسه على الجهاز',
                ].where((s) => s.isNotEmpty).join(' · ')),
                trailing: Text('${(r['amount'] as num?)?.toStringAsFixed(2) ?? '0.00'} ج.م',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                onLongPress: (r['synced'] as int?) == 1
                    ? null
                    : () async {
                        await LocalDb.instance
                            .deleteUnsyncedReceipt(r['local_id'] as int);
                        _loadRecent();
                      },
              ),
          ],
        ],
      ),
    );
  }
}

class _PickSheet extends StatefulWidget {
  final List<CustomerRef> rows;
  const _PickSheet({required this.rows});

  @override
  State<_PickSheet> createState() => _PickSheetState();
}

class _PickSheetState extends State<_PickSheet> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows
        .where((c) => _q.isEmpty || c.name.contains(_q))
        .toList();
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.75,
      child: Column(
        children: [
          const SizedBox(height: 10),
          const Text('اختار العميل',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              onChanged: (v) => setState(() => _q = v.trim()),
              decoration: const InputDecoration(
                hintText: 'دوّر بالاسم',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          Expanded(
            child: ListView.separated(
              itemCount: rows.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) => ListTile(
                title: Text(rows[i].name),
                subtitle: rows[i].phone == null ? null : Text(rows[i].phone!),
                onTap: () => Navigator.pop(context, rows[i]),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
