import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// «مراجعة الزيارات» — inspections recorded on this device, filtered by date range (من وإلى).
class ReviewScreen extends StatefulWidget {
  const ReviewScreen({super.key});

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  DateTime? _fromDate;
  DateTime? _toDate;
  String? _kind; // null = الكل | technician | regular
  bool? _synced; // null = الكل | true متزامنة | false معلقة
  List<Inspection> _rows = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    // Default to current month or today
    _toDate = DateTime.now();
    _fromDate = DateTime(_toDate!.year, _toDate!.month, 1); // First of current month
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final rows = await LocalDb.instance.listInspections(
        fromDate: _fromDate == null ? null : intl.DateFormat('yyyy-MM-dd').format(_fromDate!),
        toDate: _toDate == null ? null : intl.DateFormat('yyyy-MM-dd').format(_toDate!),
        visitKind: _kind,
        synced: _synced);
    if (mounted) {
      setState(() {
        _rows = rows;
        _loading = false;
      });
    }
  }

  static String _fmt(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  Future<void> _pickFromDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _fromDate ?? DateTime.now(),
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      setState(() => _fromDate = picked);
      _load();
    }
  }

  Future<void> _pickToDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _toDate ?? DateTime.now(),
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      setState(() => _toDate = picked);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('مراجعة الزيارات')),
        body: Column(
          children: [
            // --- تصفية النطاق الزمني (التاريخ من وإلى) ---
            Padding(
              padding: const EdgeInsets.all(12),
              child: Card(
                elevation: 2,
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.date_range, color: AppColors.primary, size: 20),
                          SizedBox(width: 6),
                          Text('تحديد نطاق التاريخ (من وإلى)',
                              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: InkWell(
                              onTap: _pickFromDate,
                              child: InputDecorator(
                                decoration: const InputDecoration(
                                  labelText: 'التاريخ من',
                                  prefixIcon: Icon(Icons.calendar_today, size: 18),
                                  border: OutlineInputBorder(),
                                  contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                ),
                                child: Text(_fromDate == null
                                    ? 'من البداية'
                                    : intl.DateFormat('yyyy/MM/dd').format(_fromDate!)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: InkWell(
                              onTap: _pickToDate,
                              child: InputDecorator(
                                decoration: const InputDecoration(
                                  labelText: 'التاريخ إلى',
                                  prefixIcon: Icon(Icons.event, size: 18),
                                  border: OutlineInputBorder(),
                                  contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                ),
                                child: Text(_toDate == null
                                    ? 'إلى اليوم'
                                    : intl.DateFormat('yyyy/MM/dd').format(_toDate!)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          IconButton.filledTonal(
                            tooltip: 'إلغاء تصفية التاريخ',
                            icon: const Icon(Icons.filter_alt_off_outlined),
                            onPressed: () {
                              setState(() {
                                _fromDate = null;
                                _toDate = null;
                              });
                              _load();
                            },
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // --- فلتر نوع الزيارة والحالة ---
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  _chip('الكل', _kind == null && _synced == null, () {
                    _kind = null;
                    _synced = null;
                  }),
                  _chip('معاينات فنيين', _kind == 'technician',
                      () => _kind = _kind == 'technician' ? null : 'technician'),
                  _chip('زيارات عادية', _kind == 'regular',
                      () => _kind = _kind == 'regular' ? null : 'regular'),
                  _chip('متزامنة', _synced == true,
                      () => _synced = _synced == true ? null : true),
                  _chip('في انتظار المزامنة', _synced == false,
                      () => _synced = _synced == false ? null : false),
                ],
              ),
            ),
            const SizedBox(height: 4),

            // --- قائمة الزيارات ---
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _rows.isEmpty
                      ? const Center(child: Text('مفيش زيارات مسجلة في هذا النطاق'))
                      : ListView.builder(
                          padding: const EdgeInsets.only(bottom: 16),
                          itemCount: _rows.length,
                          itemBuilder: (c, i) => _card(_rows[i]),
                        ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, bool selected, VoidCallback toggle) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 8),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        selectedColor: AppColors.primary.withOpacity(0.15),
        checkmarkColor: AppColors.primary,
        onSelected: (_) {
          setState(toggle);
          _load();
        },
      ),
    );
  }

  Widget _card(Inspection insp) {
    final isTech = insp.visitKind == 'technician';
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
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
          initialChildSize: 0.75,
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
