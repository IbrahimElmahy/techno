import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../db/local_db.dart';
import '../theme.dart';
import 'coupon_receipt_screen.dart';

/// مراجعة استلام الكوبونات — الإجمالي لكل عميل، بالنوع.
///
/// Reads what is ON THE PHONE, not the server: the rep needs to answer «العميل ده سلّم كام؟» while
/// he is standing in front of him, and that is exactly when there is no signal. Receipts still
/// waiting to sync are counted here too — they were taken, and leaving them out would make the
/// screen disagree with the receipts in the customer's hand.
class CouponReviewScreen extends StatefulWidget {
  const CouponReviewScreen({super.key});

  @override
  State<CouponReviewScreen> createState() => _CouponReviewScreenState();
}

/// إجمالي عميل واحد: العدد لكل نوع، والقيمة.
class _CustomerTotal {
  _CustomerTotal(this.name);
  final String name;
  /// عمليات الاستلام اللي الإجمالي ده اتجمّع منها — عشان الضغط يفتحها.
  final List<Map<String, Object?>> rows = [];
  final Map<String, int> byKind = {};
  double value = 0;
  int receipts = 0;
  int pending = 0;

  int get count => byKind.values.fold(0, (a, b) => a + b);
}

class _CouponReviewScreenState extends State<CouponReviewScreen> {
  // نفس منطق مراجعة الزيارات: التاريخ مكتوب من أول ما الشاشة تفتح.
  DateTime? _from = DateUtils.dateOnly(DateTime.now());
  DateTime? _to = DateUtils.dateOnly(DateTime.now());
  final _customerFilter = TextEditingController();
  List<_CustomerTotal> _rows = [];
  bool _loading = true;

  static const _kinds = <String, String>{
    'standard': 'عادي',
    'silver': 'فضي',
    'gold': 'ذهبي',
    'diamond': 'ماسي',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  static String? _iso(DateTime? d) =>
      d == null ? null : intl.DateFormat('yyyy-MM-dd').format(d);

  Future<void> _load() async {
    setState(() => _loading = true);
    final receipts = await LocalDb.instance.couponReceipts();
    final from = _iso(_from);
    final to = _iso(_to);

    final totals = <String, _CustomerTotal>{};
    for (final r in receipts) {
      // A receipt written before the date field existed has none; it is still a receipt, so it is
      // only dropped when a filter is actually set.
      final date = r['received_date'] as String?;
      if (from != null && (date == null || date.compareTo(from) < 0)) continue;
      if (to != null && (date == null || date.compareTo(to) > 0)) continue;

      final name = (r['customer_name'] as String?)?.trim();
      final key = name == null || name.isEmpty ? '— من غير اسم —' : name;
      final q = _customerFilter.text.trim();
      if (q.isNotEmpty && !key.toLowerCase().contains(q.toLowerCase())) continue;
      final t = totals.putIfAbsent(key, () => _CustomerTotal(key));
      t.rows.add(r);

      final kind = (r['coupon_kind'] as String?) ?? 'standard';
      final count = (r['coupon_count'] as int?) ?? 0;
      t.byKind[kind] = (t.byKind[kind] ?? 0) + count;
      t.value += ((r['coupon_value'] as num?)?.toDouble() ?? 0) * count;
      t.receipts += 1;
      if ((r['synced'] as int?) != 1) t.pending += 1;
    }

    final rows = totals.values.toList()
      ..sort((a, b) => b.count.compareTo(a.count));
    if (mounted) setState(() { _rows = rows; _loading = false; });
  }

  Widget _dateBox(String label, DateTime? value, void Function(DateTime?) set) {
    return InkWell(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? DateTime.now(),
          firstDate: DateTime(2024),
          lastDate: DateTime.now().add(const Duration(days: 1)),
        );
        if (picked == null) return;
        set(picked);
        _load();
      },
      // خانة بسيطة: الأيقونة وزرار المسح كانوا واكلين عرضها والتاريخ بيلف سطرين.
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        ),
        child: Text(
          value == null ? 'الكل' : intl.DateFormat('yyyy/MM/dd').format(value),
          maxLines: 1,
          softWrap: false,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _customerFilter.dispose();
    super.dispose();
  }

  /// عمليات الاستلام بتاعة عميل واحد — تعديل أو إلغاء طول ما هي متزامنتش.
  ///
  /// The row on the screen is a total across several handovers, so «اضغط عليه» cannot open one
  /// receipt — it opens the list of them. A synced receipt is a document on the server and is not
  /// touched here: correcting one is a new receipt, not a rewrite of history.
  void _showReceipts(_CustomerTotal t) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(20),
            children: [
              Text(t.name,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text('${t.rows.length} عملية استلام · ${t.count} كوبون',
                  style: const TextStyle(color: Colors.blueGrey)),
              const Divider(height: 24),
              for (final r in t.rows)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(_receiptLine(r)),
                  subtitle: Text((r['synced'] as int?) == 1
                      ? 'اتزامنت'
                      : 'لسه متزامنتش'),
                  trailing: (r['synced'] as int?) == 1
                      ? const Icon(Icons.cloud_done_outlined, color: AppColors.success)
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: 'تعديل',
                              icon: const Icon(Icons.edit_outlined),
                              onPressed: () async {
                                Navigator.pop(sheet);
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                      builder: (_) => CouponReceiptScreen(existing: r)),
                                );
                                _load();
                              },
                            ),
                            IconButton(
                              tooltip: 'إلغاء الاستلام',
                              icon: const Icon(Icons.delete_outline,
                                  color: AppColors.danger),
                              onPressed: () => _deleteReceipt(sheet, r),
                            ),
                          ],
                        ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// «٢٠٢٦/٠٨/١٤ · ذهبي ٣»
  String _receiptLine(Map<String, Object?> r) {
    final date = r['received_date'] ?? '—';
    final kind = _kinds[r['coupon_kind']] ?? (r['coupon_kind'] ?? '');
    return '$date · $kind ${r['coupon_count']}';
  }

  Future<void> _deleteReceipt(BuildContext sheet, Map<String, Object?> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('إلغاء الاستلام؟'),
          content: Text('${r['coupon_count']} كوبون هيتشالوا من الجهاز، '
              'والعملية دي لسه ما اترفعتش للسيرفر.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('رجوع')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(d, true),
              child: const Text('إلغاء الاستلام'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    await LocalDb.instance.deleteCouponReceipt(r['local_id'] as int);
    if (sheet.mounted) Navigator.pop(sheet);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final grand = _rows.fold<int>(0, (a, r) => a + r.count);
    final grandValue = _rows.fold<double>(0, (a, r) => a + r.value);

    return Scaffold(
      appBar: AppBar(title: const Text('مراجعة الكوبونات')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(child: _dateBox('من', _from, (d) => setState(() => _from = d))),
                const SizedBox(width: 8),
                Expanded(child: _dateBox('إلى', _to, (d) => setState(() => _to = d))),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  tooltip: 'كل التواريخ',
                  icon: const Icon(Icons.filter_alt_off_outlined),
                  onPressed: () {
                    setState(() { _from = null; _to = null; });
                    _load();
                  },
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: TextField(
              controller: _customerFilter,
              onChanged: (_) => _load(),
              decoration: InputDecoration(
                isDense: true,
                hintText: 'فلتر بإسم العميل',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _customerFilter.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () { _customerFilter.clear(); _load(); },
                      ),
              ),
            ),
          ),
          if (!_loading && _rows.isNotEmpty)
            Container(
              width: double.infinity,
              color: AppColors.primary.withOpacity(0.08),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('$grand كوبون من ${_rows.length} عميل',
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                  if (grandValue > 0)
                    Text('${grandValue.toStringAsFixed(2)} ج.م',
                        style: const TextStyle(
                            fontWeight: FontWeight.w800, color: AppColors.success)),
                ],
              ),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _rows.isEmpty
                    ? const Center(child: Text('مفيش كوبونات في المدة دي'))
                    : ListView.separated(
                        padding: const EdgeInsets.only(bottom: 20),
                        itemCount: _rows.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, i) {
                          final r = _rows[i];
                          return ListTile(
                            onTap: () => _showReceipts(r),
                            title: Text(r.name,
                                style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  for (final e in r.byKind.entries)
                                    _KindChip(label: _kinds[e.key] ?? e.key, count: e.value),
                                  if (r.pending > 0)
                                    _KindChip(
                                      label: 'مستني المزامنة',
                                      count: r.pending,
                                      color: AppColors.accent,
                                    ),
                                ],
                              ),
                            ),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text('${r.count}',
                                    style: const TextStyle(
                                        fontSize: 20, fontWeight: FontWeight.w800)),
                                if (r.value > 0)
                                  Text('${r.value.toStringAsFixed(0)} ج.م',
                                      style: const TextStyle(
                                          fontSize: 12, color: AppColors.success)),
                              ],
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}

class _KindChip extends StatelessWidget {
  const _KindChip({required this.label, required this.count, this.color});

  final String label;
  final int count;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: c.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text('$label · $count',
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: c)),
    );
  }
}
