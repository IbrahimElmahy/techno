import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/supervisor.dart';
import '../theme.dart';
import '../utils/format.dart';
import '../widgets/supervisor_widgets.dart';

class SupervisorDebtsScreen extends StatefulWidget {
  const SupervisorDebtsScreen({super.key, required this.reps, this.initialRepId});

  final List<SupRep> reps;
  final int? initialRepId;

  @override
  State<SupervisorDebtsScreen> createState() => _SupervisorDebtsScreenState();
}

class _SupervisorDebtsScreenState extends State<SupervisorDebtsScreen> {
  late int? _repId;
  Map<String, dynamic>? _data;
  Object? _error;
  bool _loading = false;
  String _query = '';
  int _req = 0;

  @override
  void initState() {
    super.initState();
    _repId = widget.initialRepId ?? (widget.reps.isNotEmpty ? widget.reps.first.id : null);
    _load();
  }

  Future<void> _load() async {
    final id = _repId;
    if (id == null) return;
    final my = ++_req;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j = await ApiClient.instance.supervisorRepDebts(id);
      if (!mounted || my != _req) return;
      setState(() {
        _data = j;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || my != _req) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  double _n(dynamic v) => double.tryParse('${v ?? 0}') ?? 0;

  List<Map<String, dynamic>> get _customers {
    final all = [
      for (final c in (_data?['customers'] as List? ?? const []))
        Map<String, dynamic>.from(c as Map)
    ];
    final q = _query.trim();
    if (q.isEmpty) return all;
    return all
        .where((c) =>
            '${c['name'] ?? ''}'.contains(q) ||
            '${c['code'] ?? ''}'.contains(q) ||
            '${c['phone'] ?? ''}'.contains(q))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('مديونية العملاء'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loading ? null : _load),
        ],
      ),
      body: Column(
        children: [
          _repChips(),
          if (_data != null) _summary(),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
            child: TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'بحث بالاسم أو الكود أو الهاتف',
                isDense: true,
                border: OutlineInputBorder(),
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _repChips() {
    return SizedBox(
      height: 54,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        children: [
          for (final r in widget.reps)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: ChoiceChip(
                label: Text(r.fullName),
                selected: r.id == _repId,
                selectedColor: AppColors.primary.withValues(alpha: 0.18),
                onSelected: (_) {
                  if (r.id == _repId) return;
                  setState(() {
                    _repId = r.id;
                    _data = null;
                  });
                  _load();
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _summary() {
    final d = _data!;
    final other = (d['customers'] as List? ?? const [])
        .fold<double>(0, (t, c) => t + _n((c as Map)['other']));
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text('إجمالي المديونية',
                    style: TextStyle(fontSize: 14, color: Colors.grey.shade800)),
              ),
              Text(fmtMoney(_n(d['debt_total'])),
                  style: const TextStyle(
                      fontSize: 19, fontWeight: FontWeight.w800, color: AppColors.danger)),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _pill('عملاء مدينون', '${d['debtors_count'] ?? 0}'),
              _pill('أبيض', fmtMoney(_n(d['white_total']))),
              _pill('بولي', fmtMoney(_n(d['poly_total']))),
              if (other.abs() > 0.004) _pill('أخرى', fmtMoney(other)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _pill(String label, String value) => Expanded(
        child: Column(
          children: [
            Text(label, style: TextStyle(fontSize: 12, color: Colors.grey.shade700)),
            Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
          ],
        ),
      );

  Widget _body() {
    if (_loading && _data == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _data == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(friendlyError(_error!), textAlign: TextAlign.center),
            const SizedBox(height: 8),
            TextButton(onPressed: _load, child: const Text('حاول مرة أخرى')),
          ],
        ),
      );
    }
    final rows = _customers;
    if (rows.isEmpty) {
      return Center(
        child: Text('لا توجد مديونيات',
            style: TextStyle(fontSize: 15, color: Colors.grey.shade700)),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
        itemCount: rows.length,
        separatorBuilder: (_, __) => const SizedBox(height: 6),
        itemBuilder: (_, i) => _customerCard(rows[i]),
      ),
    );
  }

  Widget _customerCard(Map<String, dynamic> c) {
    final total = _n(c['total']);
    final white = _n(c['white']);
    final poly = _n(c['poly']);
    final other = _n(c['other']);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('${c['name'] ?? ''}',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                ),
                Text(fmtMoney(total),
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: total > 0 ? AppColors.danger : AppColors.success)),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              [
                if ('${c['code'] ?? ''}'.isNotEmpty) '${c['code']}',
                if ('${c['phone'] ?? ''}'.isNotEmpty) '${c['phone']}',
                if (c['last_date'] != null) 'آخر حركة ${c['last_date']}',
              ].join(' · '),
              style: TextStyle(fontSize: 12, color: Colors.grey.shade700),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                if (white.abs() > 0.004) _tag('أبيض', white),
                if (poly.abs() > 0.004) _tag('بولي', poly),
                if (other.abs() > 0.004) _tag('أخرى', other),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _tag(String label, double v) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.grey.shade100,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.grey.shade300),
        ),
        child: Text('$label: ${fmtMoney(v)}',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
      );
}
