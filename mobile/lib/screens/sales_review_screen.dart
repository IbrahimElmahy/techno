import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'invoice_print_screen.dart';

/// فواتير الجهاز — اللي راحت واللي لسه.
///
/// المندوب لازم يشوف بعينه إن اللي كتبه وصل. الطابور اللي محدش بيبص عليه هو اللي بيخلّي
/// فاتورة تفضل يومين على الجهاز ومحدش واخد باله — فالسطر بيقول حالته صريح، والمرفوعة
/// بترقمها اللي في الدفاتر.
class SalesReviewScreen extends StatefulWidget {
  const SalesReviewScreen({super.key});

  @override
  State<SalesReviewScreen> createState() => _SalesReviewScreenState();
}

class _SalesReviewScreenState extends State<SalesReviewScreen> {
  List<Map<String, Object?>> _rows = [];
  bool _loading = true;
  bool _pushing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await LocalDb.instance.saleInvoices();
    if (mounted) setState(() { _rows = rows; _loading = false; });
  }

  Future<void> _push() async {
    setState(() => _pushing = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final n = await ApiClient.instance.pushSaleInvoices();
      messenger.showSnackBar(SnackBar(
        content: Text(n == 0 ? 'مافيش فواتير مستنية' : 'اترفعت $n فاتورة ✔'),
        backgroundColor: n == 0 ? null : AppColors.success,
      ));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e'), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _pushing = false);
      _load();
    }
  }

  Future<void> _delete(Map<String, Object?> row) async {
    // المرفوعة مابتتشالش من هنا — دي بقت في الدفاتر، وشيلها من الجهاز مابيلغيهاش.
    if ((row['synced'] as int?) == 1) return;
    await LocalDb.instance.deleteUnsyncedSale(row['local_id'] as int);
    _load();
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
            tooltip: 'رفع المستني',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _rows.isEmpty
                  ? ListView(children: const [
                      Padding(
                        padding: EdgeInsets.all(40),
                        child: Text('مافيش فواتير على الجهاز.', textAlign: TextAlign.center),
                      )
                    ])
                  : ListView(
                      children: [
                        if (pending > 0)
                          Card(
                            color: const Color(0xFFFFF6E5),
                            child: ListTile(
                              leading: const Icon(Icons.schedule, color: AppColors.accent),
                              title: Text('$pending فاتورة مستنية الرفع'),
                              subtitle: const Text('اضغط السحابة فوق عشان ترفعهم'),
                            ),
                          ),
                        for (final r in _rows) _invoiceCard(r),
                      ],
                    ),
            ),
    );
  }

  Widget _invoiceCard(Map<String, Object?> r) {
    final synced = (r['synced'] as int?) == 1;
    return Card(
      child: ExpansionTile(
        leading: Icon(
          synced ? Icons.check_circle : Icons.schedule,
          color: synced ? AppColors.success : AppColors.accent,
        ),
        title: Text(r['customer_name'] as String? ?? '—',
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text([
          r['invoice_date'] as String? ?? '',
          '${(r['total'] as num?)?.toStringAsFixed(2) ?? '0.00'} ج.م',
          if (synced) r['document_number'] as String? ?? '' else 'لسه على الجهاز',
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
                        if (l.variableDiscountPct > 0)
                          'إضافي ${_trim(l.variableDiscountPct)}%',
                      ].join(' — ')),
                      trailing: Text('${l.net.toStringAsFixed(2)} ج.م',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // الطباعة متاحة للمسودّة كمان: المندوب بيسيب ورقة عند العميل وهو
                        // في الشارع، والفاتورة ساعتها لسه في الطابور. الورقة نفسها بتقول
                        // إنها مسودّة بدل ما تدّعي رقم مالوش وجود.
                        TextButton.icon(
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => InvoicePrintScreen(invoice: r)),
                          ),
                          icon: const Icon(Icons.print_outlined),
                          label: const Text('طباعة / PDF'),
                        ),
                        if (!synced)
                          TextButton.icon(
                            onPressed: () => _delete(r),
                            icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                            label: const Text('امسح',
                                style: TextStyle(color: AppColors.danger)),
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
