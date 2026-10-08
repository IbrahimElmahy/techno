import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'invoice_print_screen.dart';
import 'sale_coupons_section.dart';
import 'sale_invoice_screen.dart';
import 'bonus_invoice_screen.dart';
import '../services/app_updater.dart';
import '../services/auto_sync.dart';
import '../services/task_progress.dart';

class SalesReviewScreen extends StatefulWidget {
  const SalesReviewScreen({super.key});

  @override
  State<SalesReviewScreen> createState() => _SalesReviewScreenState();
}

class _SalesReviewScreenState extends State<SalesReviewScreen> {
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
            _inRange(r['invoice_date'] as String?))
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
    final rows = await LocalDb.instance.saleInvoices();
    if (mounted) setState(() { _rows = rows; _loading = false; });
  }

  Future<void> _push() async {
    setState(() => _pushing = true);
    final tr = TaskTracker.instance;
    tr.start(BgTask.upload, 'جارٍ رفع الفواتير…');
    try {
      final n = await ApiClient.instance.pushSaleInvoices(
          onProgress: (done, total) => tr.update(
              BgTask.upload, 'جارٍ رفع الفواتير ${done + 1}/$total',
              progress: total == 0 ? null : done / total));
      tr.finish(BgTask.upload, n == 0 ? 'لا توجد فواتير بانتظار الرفع' : 'تم رفع $n فاتورة ✔');
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
    final pending = _rows.where((r) => (r['synced'] as int?) != 1).length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('فواتيري'),
        actions: [
          IconButton(
            onPressed: _pushing ? null : _push,
            icon: _pushing
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
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
                      hintText: 'ابحث بالعميل أو رقم المستند',
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
                Expanded(
                  child: RefreshIndicator(
                          onRefresh: () async {
                            await AutoSync.instance.maybeRun(force: true);
                            await _load();
                          },
                    child: _visible.isEmpty
                        ? ListView(children: [
                            Padding(
                              padding: const EdgeInsets.all(40),
                              child: Text(
                                  _rows.isEmpty
                                      ? 'لا توجد فواتير على الجهاز.'
                                      : 'لا توجد فواتير مطابقة للتصفية.',
                                  textAlign: TextAlign.center),
                            )
                          ])
                        : ListView(
                            children: [
                              if (pending > 0)
                                Card(
                                  color: const Color(0xFFFFF6E5),
                                  child: ListTile(
                                    leading: const Icon(Icons.schedule,
                                        color: AppColors.accent),
                                    title: Text('$pending فاتورة بانتظار الرفع'),
                                  ),
                                ),
                              for (final r in _visible) _invoiceCard(r),
                            ],
                          ),
                  ),
                ),
              ],
            ),
    );
  }

  List<Map<String, Object?>> _couponRows(Map<String, Object?> r) {
    final raw = r['coupons'] as String?;
    if (raw == null || raw.trim().isEmpty) return const [];
    try {
      final v = jsonDecode(raw);
      if (v is! List) return const [];
      return [for (final e in v) if (e is Map) Map<String, Object?>.from(e)];
    } catch (_) {
      return const [];
    }
  }

  int _countOf(Map<String, Object?> c) =>
      (c['count'] as int?) ??
      couponCount(c['serial_from'] as String?, c['serial_to'] as String?) ??
      0;

  int _couponTotal(Map<String, Object?> r) =>
      _couponRows(r).fold(0, (t, c) => t + _countOf(c));

  String? _bonusForNumber(Map<String, Object?> r) {
    final uuid = r['bonus_for_client_uuid'] as String?;
    if (uuid != null) {
      for (final o in _rows) {
        if (o['client_uuid'] == uuid) {
          return (o['document_number'] as String?) ?? 'فاتورة لم تُرفع بعد';
        }
      }
    }
    return r['bonus_for_number'] as String?;
  }

  Widget _invoiceCard(Map<String, Object?> r) {
    final synced = (r['synced'] as int?) == 1;
    final isBonus = (r['is_bonus'] as int? ?? 0) == 1;
    final bonusFor = isBonus ? _bonusForNumber(r) : null;
    return Card(
      child: ExpansionTile(
        leading: Icon(
          synced ? Icons.check_circle : Icons.schedule,
          color: synced ? AppColors.success : AppColors.accent,
        ),
        title: Row(
          children: [
            Flexible(
              child: Text(r['customer_name'] as String? ?? '—',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
            if (isBonus) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: AppColors.accent.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text('بونص',
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: Colors.black87)),
              ),
            ],
          ],
        ),
        subtitle: Text([
          r['invoice_date'] as String? ?? '',
          '${(r['total'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
          if (bonusFor != null) 'على $bonusFor',
          if (_couponTotal(r) > 0) '${_couponTotal(r)} كوبون',
          if (synced) r['document_number'] as String? ?? '' else 'لم تُرفع بعد',
        ].where((s) => s.isNotEmpty).join(' · ')),
        children: [
          FutureBuilder<List<SaleDraftLine>>(
            future: LocalDb.instance.saleInvoiceLines(r['local_id'] as int),
            builder: (_, snap) {
              final lines = snap.data ?? const <SaleDraftLine>[];
              return Column(
                children: [
                  for (final l in lines)
                    ListTile(
                      dense: true,
                      title: Text(l.itemName),
                      subtitle: Text([
                        '${_trim(l.quantity)} × ${l.unitPrice.toStringAsFixed(2)}',
                        if (l.fixedDiscountPct > 0) 'ثابت ${_trim(l.fixedDiscountPct)}%',
                        if (isBonus)
                          'بونص'
                        else if (l.variableDiscountPct > 0)
                          'إضافي ${_trim(l.variableDiscountPct)}%',
                      ].join(' — ')),
                      trailing: Text('${l.net.toStringAsFixed(2)}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  for (final c in _couponRows(r))
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.confirmation_number_outlined,
                          size: 20, color: AppColors.accent),
                      title: Text('${c['coupon_kind'] ?? 'كوبونات'}'),
                      subtitle: Text(
                          'من ${c['serial_from'] ?? '—'} إلى ${c['serial_to'] ?? '—'}'),
                      trailing: Text('${_countOf(c)} كوبون',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        if (synced)
                          TextButton.icon(
                            onPressed: () => Navigator.push(
                              context,
                              MaterialPageRoute(
                                  builder: (_) => InvoicePrintScreen(invoice: r)),
                            ),
                            icon: const Icon(Icons.print_outlined),
                            label: const Text('طباعة / PDF'),
                          )
                        else
                          TextButton.icon(
                            onPressed: () async {
                              final changed = await Navigator.push<bool>(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => isBonus
                                        ? BonusInvoiceScreen(existing: r)
                                        : SaleInvoiceScreen(existing: r)),
                              );
                              if (changed == true) _load();
                            },
                            icon: const Icon(Icons.edit_outlined),
                            label: const Text('تعديل'),
                          ),
                        if (!synced)
                          const Padding(
                            padding: EdgeInsets.only(right: 8),
                            child: Text('تتاح الطباعة بعد المزامنة',
                                style: TextStyle(
                                    fontSize: 11, color: Colors.black45)),
                          ),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

String _trim(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}
