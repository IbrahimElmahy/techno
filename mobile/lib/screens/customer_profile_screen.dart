import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// ملف العميل — رصيده وحركته.
///
/// **الشاشة دي محتاجة شبكة، عن قصد.** الرصيد بيتغيّر من المكتب ومن مناديب تانيين وبقبض
/// مالوش علاقة بالجهاز ده؛ ورقم قديم متخزّن هنا أوحش من «مافيش شبكة»، لأن الواحد بيصدّقه
/// ويروح يطالب عميل بفلوس دفعها امبارح.
class CustomerProfileScreen extends StatefulWidget {
  const CustomerProfileScreen({super.key});

  @override
  State<CustomerProfileScreen> createState() => _CustomerProfileScreenState();
}

class _CustomerProfileScreenState extends State<CustomerProfileScreen> {
  List<CustomerRef> _customers = [];
  CustomerRef? _picked;
  Map<String, dynamic>? _profile;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    LocalDb.instance.customers(limit: 300).then((rows) {
      if (mounted) setState(() => _customers = rows);
    });
  }

  Future<void> _open(CustomerRef c) async {
    setState(() {
      _picked = c;
      _loading = true;
      _error = null;
      _profile = null;
    });
    try {
      final p = await ApiClient.instance.customerProfile(c.id);
      if (mounted) setState(() => _profile = p);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_picked?.name ?? 'حساب عميل')),
      body: _picked == null ? _list() : _detail(),
    );
  }

  Widget _list() => ListView.separated(
        itemCount: _customers.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) => ListTile(
          title: Text(_customers[i].name),
          subtitle: _customers[i].phone == null ? null : Text(_customers[i].phone!),
          trailing: const Icon(Icons.chevron_left),
          onTap: () => _open(_customers[i]),
        ),
      );

  Widget _detail() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off, size: 48, color: Colors.black26),
              const SizedBox(height: 12),
              // الرسالة بتقول السبب صريح: مش «حصل خطأ»، ده رقم لازم ييجي من السيرفر.
              const Text('الحساب محتاج شبكة — الرصيد بيتغيّر من المكتب كمان.',
                  textAlign: TextAlign.center),
              const SizedBox(height: 6),
              Text(_error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, color: Colors.black45)),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => _open(_picked!),
                icon: const Icon(Icons.refresh),
                label: const Text('جرّب تاني'),
              ),
              TextButton(
                onPressed: () => setState(() => _picked = null),
                child: const Text('رجوع للقايمة'),
              ),
            ],
          ),
        ),
      );
    }
    final p = _profile!;
    final invoices = (p['invoices'] as List?) ?? const [];
    final receipts = (p['receipts'] as List?) ?? const [];
    return RefreshIndicator(
      onRefresh: () => _open(_picked!),
      child: ListView(
        children: [
          Card(
            color: const Color(0xFFF3F8FB),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  const Text('عليه', style: TextStyle(color: Colors.black54)),
                  Text('${_num(p['balance'])} ج.م',
                      style: const TextStyle(
                          fontSize: 30, fontWeight: FontWeight.w800, color: AppColors.primary)),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _stat('مبيعات', _num(p['total_sales'])),
                      _stat('تحصيل', _num(p['total_receipts'])),
                      _stat('مرتجع', _num(p['total_returns'])),
                      _stat('نقاط', _num(p['points_balance'])),
                    ],
                  ),
                ],
              ),
            ),
          ),
          _section('آخر الفواتير', invoices),
          _section('آخر التحصيلات', receipts),
          Padding(
            padding: const EdgeInsets.all(12),
            child: OutlinedButton.icon(
              onPressed: () => setState(() {
                _picked = null;
                _profile = null;
              }),
              icon: const Icon(Icons.list),
              label: const Text('عميل تاني'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _section(String title, List rows) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Text(title,
              style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.black54)),
        ),
        for (final r in rows.take(15))
          ListTile(
            dense: true,
            title: Text('${r['document_number'] ?? ''}'),
            subtitle: Text('${r['date'] ?? r['created_at'] ?? ''}'.split('T').first),
            trailing: Text('${_num(r['amount'] ?? r['net'] ?? r['value'])} ج.م',
                style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
      ],
    );
  }

  Widget _stat(String label, String value) => Column(
        children: [
          Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.black54)),
        ],
      );
}

String _num(Object? v) => (double.tryParse('$v') ?? 0).toStringAsFixed(2);
