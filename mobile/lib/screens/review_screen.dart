import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// «مراجعة الزيارات» — inspections recorded on this device, filtered by date.
class ReviewScreen extends StatefulWidget {
  const ReviewScreen({super.key});

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  DateTime? _date = DateTime.now();
  List<Inspection> _rows = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final rows = await LocalDb.instance.listInspections(
        date: _date == null ? null : intl.DateFormat('yyyy-MM-dd').format(_date!));
    if (mounted) {
      setState(() {
        _rows = rows;
        _loading = false;
      });
    }
  }

  static String _fmt(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('مراجعة الزيارات')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _date ?? DateTime.now(),
                        firstDate: DateTime(2024),
                        lastDate: DateTime.now().add(const Duration(days: 1)),
                      );
                      if (picked != null) {
                        setState(() => _date = picked);
                        _load();
                      }
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(
                          labelText: 'التاريخ', prefixIcon: Icon(Icons.calendar_today)),
                      child: Text(_date == null
                          ? 'كل التواريخ'
                          : intl.DateFormat('yyyy/MM/dd').format(_date!)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  tooltip: 'كل التواريخ',
                  icon: const Icon(Icons.filter_alt_off_outlined),
                  onPressed: () {
                    setState(() => _date = null);
                    _load();
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _rows.isEmpty
                    ? const Center(child: Text('مفيش زيارات في اليوم ده'))
                    : ListView.builder(
                        padding: const EdgeInsets.only(bottom: 16),
                        itemCount: _rows.length,
                        itemBuilder: (c, i) => _card(_rows[i]),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _card(Inspection insp) {
    final isTech = insp.visitKind == 'technician';
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        leading: CircleAvatar(
          backgroundColor: (isTech ? AppColors.primary : AppColors.success)
              .withOpacity(0.12),
          child: Icon(isTech ? Icons.engineering : Icons.home_work_outlined,
              color: isTech ? AppColors.primary : AppColors.success),
        ),
        title: Text(insp.ownerName,
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${isTech ? "معاينة فنيين" : "زيارة عادية"} • ${insp.inspectionDate}'),
            Row(
              children: [
                Icon(insp.synced ? Icons.cloud_done : Icons.cloud_off,
                    size: 14,
                    color: insp.synced ? AppColors.success : Colors.orange),
                const SizedBox(width: 4),
                Text(
                  insp.synced
                      ? 'متزامنة ${insp.documentNumber ?? ""}'
                      : 'في انتظار المزامنة',
                  style: TextStyle(
                      fontSize: 12,
                      color: insp.synced ? AppColors.success : Colors.orange),
                ),
              ],
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(_fmt(insp.totalPoints),
                style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary)),
            const Text('نقطة', style: TextStyle(fontSize: 11, color: Colors.grey)),
          ],
        ),
        onTap: () => _showDetail(insp),
      ),
    );
  }

  void _showDetail(Inspection insp) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.7,
          builder: (c, scroll) => ListView(
            controller: scroll,
            padding: const EdgeInsets.all(20),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(insp.ownerName,
                        style: const TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w800)),
                  ),
                  if (!insp.synced)
                    IconButton(
                      tooltip: 'حذف',
                      icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                      onPressed: () async {
                        final ok = await showDialog<bool>(
                          context: context,
                          builder: (d) => AlertDialog(
                            title: const Text('حذف المعاينة؟'),
                            content: const Text(
                                'المعاينة دي لسه ما اتزامنتش — لو اتحذفت مش هتترفع للسيرفر.'),
                            actions: [
                              TextButton(
                                  onPressed: () => Navigator.pop(d, false),
                                  child: const Text('إلغاء')),
                              FilledButton(
                                  onPressed: () => Navigator.pop(d, true),
                                  child: const Text('حذف')),
                            ],
                          ),
                        );
                        if (ok == true && insp.localId != null) {
                          await LocalDb.instance.deleteInspection(insp.localId!);
                          if (c.mounted) Navigator.pop(c);
                          _load();
                        }
                      },
                    ),
                ],
              ),
              const SizedBox(height: 8),
              _kv('التاريخ', insp.inspectionDate),
              _kv('تليفون المالك', insp.ownerPhone),
              _kv('رقم البطاقة', insp.nationalId),
              _kv('العنوان', insp.ownerAddress),
              _kv('الدور', insp.floorNumber),
              _kv('توصيف المعاينة', insp.description),
              _kv('نوع المعاينة', insp.inspectionType),
              _kv('اسم الفني', insp.technicianName),
              _kv('تليفون الفني', insp.technicianPhone),
              _kv('محل الشراء', insp.purchaseShop),
              _kv('تفاصيل الزيارة', insp.visitDetails),
              const Divider(height: 24),
              const Text('الأصناف',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              for (final l in insp.lines)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(l.itemName),
                  subtitle: Text('${_fmt(l.quantity)} × ${_fmt(l.points)} نقطة'),
                  trailing: Text(_fmt(l.total),
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
              const Divider(),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('الإجمالي',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  Text('${_fmt(insp.totalPoints)} نقطة',
                      style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _kv(String label, String? value) {
    if (value == null || value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 110,
              child: Text(label,
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 14))),
        ],
      ),
    );
  }
}
