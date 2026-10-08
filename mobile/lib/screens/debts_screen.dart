import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'collect_cash_screen.dart';
import 'customer_profile_screen.dart';
import '../services/auto_sync.dart';

class DebtsScreen extends StatefulWidget {
  const DebtsScreen({super.key});

  @override
  State<DebtsScreen> createState() => _DebtsScreenState();
}

enum _Kind { all, white, poly, both, credit }

extension on _Kind {
  String get label => switch (this) {
        _Kind.all => 'الكل',
        _Kind.white => 'أبيض',
        _Kind.poly => 'بولي',
        _Kind.both => 'على الخطين',
        _Kind.credit => 'ليهم فلوس',
      };
}

const _kWhite = 'أبيض';
const _kPoly = 'بولي';

const _eps = 0.5;

class _DebtsScreenState extends State<DebtsScreen> {
  final _search = TextEditingController();
  List<CustomerRef> _all = [];
  bool _loading = true;
  _Kind _kind = _Kind.all;

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
    final rows = await LocalDb.instance.customers(limit: 100000);
    if (!mounted) return;
    setState(() {
      _all = rows;
      _loading = false;
    });
  }

  double _white(CustomerRef c) => c.familyBalances[_kWhite] ?? 0;
  double _poly(CustomerRef c) => c.familyBalances[_kPoly] ?? 0;

  double _total(CustomerRef c) {
    final f = _white(c) + _poly(c);
    return c.familyBalances.isEmpty ? c.balance : f;
  }

  bool _match(CustomerRef c) {
    final w = _white(c), p = _poly(c), t = _total(c);
    return switch (_kind) {
      _Kind.all => t.abs() > _eps,
      _Kind.white => w > _eps,
      _Kind.poly => p > _eps,
      _Kind.both => w > _eps && p > _eps,
      _Kind.credit => t < -_eps,
    };
  }

  List<CustomerRef> get _rows {
    final q = _search.text.trim().toLowerCase();
    final out = [
      for (final c in _all)
        if (_match(c) && (q.isEmpty || c.name.toLowerCase().contains(q))) c
    ];
    out.sort((a, b) => _total(b).abs().compareTo(_total(a).abs()));
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final sum = rows.fold<double>(0, (t, c) => t + _total(c));
    return Scaffold(
      appBar: AppBar(title: const Text('كشف المديونيات')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Card(
                  color: const Color(0xFFF3F8FB),
                  margin: const EdgeInsets.fromLTRB(8, 8, 8, 4),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _stat('عملاء', '${rows.length}'),
                        _stat('الإجمالي', _money(sum),
                            color: sum > 0 ? AppColors.danger : AppColors.success),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: 'دوّر باسم العميل',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () => setState(_search.clear),
                            ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  height: 38,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    children: [
                      for (final k in _Kind.values)
                        Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: ChoiceChip(
                            label: Text(k.label),
                            selected: _kind == k,
                            onSelected: (_) => setState(() => _kind = k),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                Expanded(
                  child: rows.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(
                                _all.isEmpty
                                    ? 'مافيش عملاء على الجهاز.\n'
                                        'افتح «مزامنة البيانات» واعمل مزامنة.'
                                    : 'مافيش عميل بالمواصفات دي.',
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: Colors.black54)),
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: () async {
                            await AutoSync.instance.maybeRun(force: true);
                            await _load();
                          },
                          child: ListView.separated(
                            itemCount: rows.length,
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (_, i) => _tile(rows[i]),
                          ),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _tile(CustomerRef c) {
    final w = _white(c), p = _poly(c), t = _total(c);
    return ListTile(
      title: Text(c.name,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (c.familyBalances.isNotEmpty)
            Wrap(spacing: 6, runSpacing: 2, children: [
              if (w.abs() > _eps) _pill('أبيض ${_money(w)}', w),
              if (p.abs() > _eps) _pill('بولي ${_money(p)}', p),
            ]),
          if ((c.phone ?? '').trim().isNotEmpty)
            Text(c.phone!,
                style: const TextStyle(fontSize: 11, color: Colors.black45)),
        ],
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(_money(t),
              style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: t > _eps ? AppColors.danger : AppColors.success)),
          Text(t > _eps ? 'عليه' : 'ليه',
              style: const TextStyle(fontSize: 10, color: Colors.black45)),
        ],
      ),
      onTap: () => _actions(c),
    );
  }

  void _actions(CustomerRef c) {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(c.name,
                  style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('عليه ${_money(_total(c))}'),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.payments_outlined,
                  color: AppColors.success),
              title: const Text('تحصيل منه'),
              onTap: () {
                Navigator.pop(sheet);
                Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => const CollectCashScreen()));
              },
            ),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined,
                  color: AppColors.primary),
              title: const Text('كشف حسابه'),
              onTap: () {
                Navigator.pop(sheet);
                Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => const CustomerProfileScreen()));
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _pill(String text, double v) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: (v > 0 ? AppColors.danger : AppColors.success)
              .withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(text,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
      );

  Widget _stat(String label, String value, {Color? color}) => Column(
        children: [
          Text(value,
              style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: color ?? AppColors.primary)),
          Text(label,
              style: const TextStyle(fontSize: 12, color: Colors.black54)),
        ],
      );
}

String _money(double v) => v.toStringAsFixed(2);
