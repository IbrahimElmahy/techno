import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../theme.dart';

/// ملخّص اليوم — بعت بكام وحصّلت كام.
///
/// السؤال اللي المندوب بيسأله لنفسه آخر اليوم قبل ما يورّد. وبيتحسب **من على الجهاز**
/// مش من السيرفر، عشان يشتغل وهو في الشارع — وعشان الرقم اللي في إيده يبقى هو نفسه
/// الرقم اللي كتبه، حتى لو لسه ما اترفعش.
class DaySummaryScreen extends StatefulWidget {
  const DaySummaryScreen({super.key});

  @override
  State<DaySummaryScreen> createState() => _DaySummaryScreenState();
}

class _DaySummaryScreenState extends State<DaySummaryScreen> {
  DateTime _day = DateTime.now();
  Map<String, double> _t = {};
  int _pendingInvoices = 0;
  int _pendingReceipts = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final iso = _day.toIso8601String().substring(0, 10);
    final t = await LocalDb.instance.dayTotals(iso);
    final pi = await LocalDb.instance.pendingSalesCount();
    final pr = await LocalDb.instance.pendingReceiptsCount();
    if (!mounted) return;
    setState(() {
      _t = t;
      _pendingInvoices = pi;
      _pendingReceipts = pr;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final pending = _pendingInvoices + _pendingReceipts;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ملخّص اليوم'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_calendar_outlined),
            onPressed: () async {
              final d = await showDatePicker(
                context: context,
                initialDate: _day,
                firstDate: DateTime.now().subtract(const Duration(days: 90)),
                lastDate: DateTime.now(),
              );
              if (d != null) {
                setState(() => _day = d);
                _load();
              }
            },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: Text(_day.toIso8601String().substring(0, 10),
                        style: const TextStyle(fontSize: 15, color: Colors.black54)),
                  ),
                  _big('مبيعات اليوم', _t['sales'] ?? 0, AppColors.primary),
                  _big('تحصيل اليوم', _t['collected'] ?? 0, AppColors.success),
                  Card(
                    child: Column(
                      children: [
                        ListTile(
                          leading: const Icon(Icons.receipt_long_outlined),
                          title: const Text('عدد الفواتير'),
                          trailing: Text('${(_t['invoices'] ?? 0).toInt()}',
                              style: const TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w800)),
                        ),
                        const Divider(height: 1),
                        ListTile(
                          leading: const Icon(Icons.payments_outlined),
                          title: const Text('نقدي على الفواتير'),
                          subtitle: const Text('اللي اتدفع مع البيع نفسه'),
                          trailing: Text(_money(_t['cash_on_invoices'] ?? 0),
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                        ),
                      ],
                    ),
                  ),
                  // اللي في إيده فلوس ولسه ما رفعش — ده الرقم اللي بيفرق وقت التوريد.
                  Card(
                    color: pending > 0 ? const Color(0xFFFFF6E5) : null,
                    child: ListTile(
                      leading: Icon(pending > 0 ? Icons.cloud_off : Icons.cloud_done,
                          color: pending > 0 ? AppColors.accent : AppColors.success),
                      title: Text(pending > 0
                          ? '$pending مستند لسه ما اترفعش'
                          : 'كل حاجة اترفعت ✔'),
                      subtitle: pending > 0
                          ? Text([
                              if (_pendingInvoices > 0) '$_pendingInvoices فاتورة',
                              if (_pendingReceipts > 0) '$_pendingReceipts تحصيل',
                            ].join(' و'))
                          : null,
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _big(String label, double value, Color color) => Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 18),
          child: Column(
            children: [
              Text(label, style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 4),
              Text('${_money(value)} ج.م',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: color)),
            ],
          ),
        ),
      );
}

String _money(double v) => v.toStringAsFixed(2);
