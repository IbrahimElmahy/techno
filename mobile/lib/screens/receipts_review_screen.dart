import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../services/app_updater.dart';
import '../services/task_progress.dart';
import '../theme.dart';
import 'receipt_print_screen.dart';

class ReceiptsReviewScreen extends StatefulWidget {
  const ReceiptsReviewScreen({super.key});

  @override
  State<ReceiptsReviewScreen> createState() => _ReceiptsReviewScreenState();
}

class _ReceiptsReviewScreenState extends State<ReceiptsReviewScreen> {
  List<Map<String, Object?>> _rows = [];
  bool _loading = true;
  bool _pushing = false;

  final _search = TextEditingController();
  DateTime? _from;
  DateTime? _to;

  String _bare(String x) => x
      .replaceAll(RegExp('[أإآ]'), 'ا')
      .replaceAll('ة', 'ه')
      .replaceAll('ى', 'ي');

  List<Map<String, Object?>> get _visible {
    final q = _bare(_search.text.trim());
    return [
      for (final r in _rows)
        if ((q.isEmpty ||
                _bare('${r['customer_name'] ?? ''}').contains(q) ||
                '${r['document_number'] ?? ''}'.contains(q)) &&
            _inRange(r['receipt_date'] as String?))
          r
    ];
  }

  bool _inRange(String? d) {
    if (d == null || d.isEmpty) return true;
    final day = DateTime.tryParse(d);
    if (day == null) return true;
    if (_from != null && day.isBefore(DateTime(_from!.year, _from!.month, _from!.day))) {
      return false;
    }
    if (_to != null && day.isAfter(DateTime(_to!.year, _to!.month, _to!.day))) {
      return false;
    }
    return true;
  }

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
        if (_to != null && _to!.isBefore(d)) _to = d;
      } else {
        _to = d;
        if (_from != null && _from!.isAfter(d)) _from = d;
      }
    });
  }

  String _d(DateTime? v) => v == null ? '' : v.toIso8601String().substring(0, 10);

  String _money(num v) {
    final s = v.toStringAsFixed(2);
    final parts = s.split('.');
    final whole = parts[0].replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
    return '$whole.${parts[1]}';
  }

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
    final rows = await LocalDb.instance.receipts();
    if (mounted) setState(() { _rows = rows; _loading = false; });
  }

  Future<void> _openPrint(Map<String, Object?> r) async {
    await Navigator.push(
        context, MaterialPageRoute(builder: (_) => ReceiptPrintScreen(receipt: r)));
    if (mounted) _load();
  }

  Future<void> _push() async {
    setState(() => _pushing = true);
    final tr = TaskTracker.instance;
    tr.start(BgTask.upload, 'جارٍ رفع التحصيلات…');
    try {
      final n = await ApiClient.instance.pushReceipts(
          onProgress: (done, total) => tr.update(
              BgTask.upload, 'جارٍ رفع التحصيلات ${done + 1}/$total',
              progress: total == 0 ? null : done / total));
      tr.finish(BgTask.upload, n == 0 ? 'لا توجد تحصيلات بانتظار الرفع' : 'تم رفع $n تحصيل ✔');
      unawaited(AppUpdater.instance.check());
    } catch (e) {
      tr.finish(BgTask.upload, '$e', error: true, hold: const Duration(seconds: 12));
    } finally {
      if (mounted) setState(() => _pushing = false);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _visible;
    final pending = _rows.where((r) => (r['synced'] as int?) != 1).length;
    final total = rows.fold<double>(
        0, (a, r) => a + ((r['amount'] as num?)?.toDouble() ?? 0));

    return Scaffold(
      appBar: AppBar(
        title: const Text('تحصيلاتي'),
        actions: [
          IconButton(
            onPressed: _pushing ? null : _push,
            icon: _pushing
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.cloud_upload_outlined),
            tooltip: 'رفع المعلّق',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: 'ابحث بالعميل أو رقم السند',
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
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _pickDate(from: true),
                          icon: const Icon(Icons.event_outlined, size: 16),
                          label: Text(_from == null ? 'من' : 'من ${_d(_from)}',
                              style: const TextStyle(fontSize: 12)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _pickDate(from: false),
                          icon: const Icon(Icons.event, size: 16),
                          label: Text(_to == null ? 'إلى' : 'إلى ${_d(_to)}',
                              style: const TextStyle(fontSize: 12)),
                        ),
                      ),
                      if (_from != null || _to != null)
                        IconButton(
                          tooltip: 'إلغاء الفترة',
                          icon: const Icon(Icons.filter_alt_off_outlined, size: 20),
                          onPressed: () => setState(() {
                            _from = null;
                            _to = null;
                          }),
                        ),
                    ],
                  ),
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  color: AppColors.surface,
                  child: Row(
                    children: [
                      Text('${rows.length} سند',
                          style: const TextStyle(fontSize: 13)),
                      const Spacer(),
                      Text('الإجمالي ${_money(total)}',
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w700,
                              color: AppColors.primary)),
                    ],
                  ),
                ),
                if (pending > 0)
                  Container(
                    width: double.infinity,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    color: const Color(0xFFFFF6E5),
                    child: Row(children: [
                      const Icon(Icons.schedule, size: 18, color: AppColors.accent),
                      const SizedBox(width: 8),
                      Expanded(
                          child: Text('$pending سند بانتظار الرفع',
                              style: const TextStyle(fontSize: 13))),
                    ]),
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: rows.isEmpty
                        ? ListView(children: const [
                            SizedBox(height: 80),
                            Center(child: Text('لا توجد تحصيلات')),
                          ])
                        : ListView.separated(
                            itemCount: rows.length,
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (_, i) {
                              final r = rows[i];
                              final done = (r['synced'] as int?) == 1;
                              final doc = '${r['document_number'] ?? ''}';
                              final family = '${r['family'] ?? ''}';
                              final notes = '${r['notes'] ?? ''}';
                              return ListTile(
                                leading: Icon(
                                  done ? Icons.check_circle : Icons.schedule,
                                  color: done ? AppColors.success : AppColors.accent,
                                ),
                                title: Text('${r['customer_name'] ?? ''}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700)),
                                subtitle: Text([
                                  '${r['receipt_date'] ?? ''}',
                                  if (family.isNotEmpty) family,
                                  if (doc.isNotEmpty) doc else 'لم يُرفع بعد',
                                  if (notes.isNotEmpty) notes,
                                ].join(' · '),
                                    style: const TextStyle(fontSize: 12)),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                        '${_money((r['amount'] as num?)?.toDouble() ?? 0)}',
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w700,
                                            color: AppColors.primary)),
                                    IconButton(
                                      tooltip: 'طباعة / إرسال',
                                      icon: const Icon(Icons.print_outlined,
                                          color: AppColors.primary),
                                      onPressed: () => _openPrint(r),
                                    ),
                                  ],
                                ),
                                onTap: () => _openPrint(r),
                              );
                            },
                          ),
                  ),
                ),
              ],
            ),
    );
  }
}
