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
  /// حسابات الخطوط — بتيجي مع البروفايل في نفس الفتحة. فاضية = لسه، أو العميل
  /// مالوش حسابات (ورصيده صفر — ودي مش حالة خطأ).
  List<Map<String, dynamic>> _accounts = const [];
  bool _loading = false;
  String? _error;

  /// بحث القايمة وفترة الحركة — نفس فلتر «فواتيري» بالحرف.
  final _search = TextEditingController();
  DateTime? _from;
  DateTime? _to;

  String _bare(String x) => x
      .replaceAll(RegExp('[أإآ]'), 'ا')
      .replaceAll('ة', 'ه')
      .replaceAll('ى', 'ي');

  List<CustomerRef> get _visibleCustomers {
    final q = _bare(_search.text.trim());
    if (q.isEmpty) return _customers;
    return [
      for (final c in _customers)
        if (_bare(c.name).contains(q)) c
    ];
  }

  bool _inRange(Object? d) {
    final raw = '${d ?? ''}'.split('T').first;
    if (raw.isEmpty) return true;
    final day = DateTime.tryParse(raw);
    if (day == null) return true;
    if (_from != null &&
        day.isBefore(DateTime(_from!.year, _from!.month, _from!.day))) {
      return false;
    }
    if (_to != null && day.isAfter(DateTime(_to!.year, _to!.month, _to!.day))) {
      return false;
    }
    return true;
  }

  List _ranged(List rows) =>
      [for (final r in rows) if (_inRange(r['date'] ?? r['created_at'])) r];

  Future<void> _pickDate({required bool from}) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: (from ? _from : _to) ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
        // «من» بعد «إلى» مالوش معنى — الحد التاني بيتظبط بدل ما القايمة تفضى بصمت.
        if (_to != null && _to!.isBefore(d)) _to = d;
      } else {
        _to = d;
        if (_from != null && _from!.isAfter(d)) _from = d;
      }
    });
  }

  String _fmtD(DateTime? v) => v == null ? '' : v.toIso8601String().substring(0, 10);

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

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
      // الحسابات بالخط — لو وقعت لوحدها الشاشة بتكمل من غير السطرين، مش بتقع كلها.
      var accounts = const <Map<String, dynamic>>[];
      try {
        accounts = await ApiClient.instance.customerAccounts(c.id);
      } catch (_) {}
      if (mounted) {
        setState(() {
          _profile = p;
          _accounts = accounts;
        });
      }
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

  Widget _list() {
    final rows = _visibleCustomers;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            controller: _search,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'دوّر باسم العميل',
              prefixIcon: const Icon(Icons.search),
              isDense: true,
              suffixIcon: _search.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () => setState(_search.clear),
                    ),
            ),
          ),
        ),
        Expanded(
          child: rows.isEmpty
              ? const Center(child: Text('مافيش عميل بالاسم ده'))
              : ListView.separated(
                  itemCount: rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => ListTile(
                    title: Text(rows[i].name),
                    subtitle:
                        rows[i].phone == null ? null : Text(rows[i].phone!),
                    trailing: const Icon(Icons.chevron_left),
                    onTap: () => _open(rows[i]),
                  ),
                ),
        ),
      ],
    );
  }

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
                  // المديونية بالخط — نفس السطرين اللي في الفاتورة والتحصيل.
                  if (_accounts.any((a) => a['family'] != null)) ...[
                    const SizedBox(height: 6),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        for (final a in _accounts)
                          if (a['family'] != null)
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 8),
                              child: Text(
                                  '${a['family']}: ${_num(a['balance'])} ج.م',
                                  style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700,
                                      color: Colors.black54)),
                            ),
                      ],
                    ),
                  ],
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
          // فترة الحركة — بتفلتر الفواتير والتحصيلات اللي تحت مع بعض.
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickDate(from: true),
                    icon: const Icon(Icons.event_outlined, size: 16),
                    label: Text(_from == null ? 'من' : 'من ${_fmtD(_from)}',
                        style: const TextStyle(fontSize: 12)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickDate(from: false),
                    icon: const Icon(Icons.event, size: 16),
                    label: Text(_to == null ? 'إلى' : 'إلى ${_fmtD(_to)}',
                        style: const TextStyle(fontSize: 12)),
                  ),
                ),
                if (_from != null || _to != null)
                  IconButton(
                    tooltip: 'شيل الفترة',
                    icon: const Icon(Icons.filter_alt_off_outlined, size: 20),
                    onPressed: () => setState(() {
                      _from = null;
                      _to = null;
                    }),
                  ),
              ],
            ),
          ),
          if ((_from != null || _to != null) &&
              _ranged(invoices).isEmpty &&
              _ranged(receipts).isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('مافيش حركة في الفترة دي')),
            ),
          _section('آخر الفواتير', _ranged(invoices)),
          _section('آخر التحصيلات', _ranged(receipts)),
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
