import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../theme.dart';
import 'price_sheet_screen.dart';

String _money(double v) => v.toStringAsFixed(2);

class PriceSheetsScreen extends StatefulWidget {
  const PriceSheetsScreen({super.key});

  @override
  State<PriceSheetsScreen> createState() => _PriceSheetsScreenState();
}

class _PriceSheetsScreenState extends State<PriceSheetsScreen> {
  List<Map<String, Object?>> _rows = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await LocalDb.instance.priceSheets();
    if (!mounted) return;
    setState(() {
      _rows = rows;
      _loading = false;
    });
  }

  Future<void> _open({int? localId}) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
          builder: (_) => PriceSheetScreen(existingLocalId: localId)),
    );
    await _load();
  }

  Future<void> _delete(Map<String, Object?> row) async {
    final title = (row['title'] as String?) ?? 'الشيت';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('حذف الشيت؟'),
        content: Text('سيتم حذف «$title» من الجهاز نهائياً.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('رجوع')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('حذف'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await LocalDb.instance.deletePriceSheet(row['local_id'] as int);
    await _load();
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('تم حذف «$title»')));
    }
  }

  String _when(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final t = DateTime.tryParse(iso);
    if (t == null) return iso;
    final today = DateTime.now();
    final days = DateTime(today.year, today.month, today.day)
        .difference(DateTime(t.year, t.month, t.day))
        .inDays;
    if (days == 0) return 'اليوم';
    if (days == 1) return 'أمس';
    if (days < 7) return 'منذ $days أيام';
    return '${t.year}/${t.month.toString().padLeft(2, '0')}/'
        '${t.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('شيتات التسعير')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _open(),
        icon: const Icon(Icons.add),
        label: const Text('شيت جديد'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _rows.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(28),
                    child: Text(
                      'لا توجد شيتات محفوظة.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.black54),
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.only(bottom: 92),
                    itemCount: _rows.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) => _tile(_rows[i]),
                  ),
                ),
    );
  }

  Widget _tile(Map<String, Object?> row) {
    final count = (row['line_count'] as int?) ?? 0;
    final total = (row['total'] as num?)?.toDouble() ?? 0;
    return ListTile(
      leading: const CircleAvatar(
        backgroundColor: AppColors.primary,
        child: Icon(Icons.request_quote_outlined, color: Colors.white),
      ),
      title: Text((row['title'] as String?) ?? 'عرض سعر',
          maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text('$count صنف · ${_when(row['updated_at'] as String?)}'),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('${_money(total)}',
              style: const TextStyle(
                  fontWeight: FontWeight.w700, color: AppColors.primary)),
          IconButton(
            tooltip: 'حذف',
            icon: const Icon(Icons.delete_outline, color: AppColors.danger),
            onPressed: () => _delete(row),
          ),
        ],
      ),
      onTap: () => _open(localId: row['local_id'] as int),
    );
  }
}
