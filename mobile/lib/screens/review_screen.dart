import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'inspection_form_screen.dart';

/// «مراجعة الزيارات» — inspections recorded on this device, filtered by date.
class ReviewScreen extends StatefulWidget {
  const ReviewScreen({super.key});

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  // «من – إلى» بدل يوم واحد: المندوب بيراجع أسبوعه، والفلتر بيوم واحد كان بيخليه يفتح
  // الشاشة سبع مرات عشان يشوف أسبوع.
  //
  // وبيفتحوا على تاريخ النهاردة مكتوب، مش فاضيين: «الكل» كانت بتحمّل كل زيارة اتسجلت من أول
  // يوم، والمندوب اللي فاتح الشاشة بيدور على شغل النهاردة. مكتوب قدامه يبقى يعدّله بضغطة،
  // و«كل التواريخ» جنبه لو عايز يرجّع الفلتر مفتوح.
  DateTime? _from = DateUtils.dateOnly(DateTime.now());
  DateTime? _to = DateUtils.dateOnly(DateTime.now());
  String? _kind; // null = الكل | technician | regular
  bool? _synced; // null = الكل | true متزامنة | false معلقة
  List<Inspection> _rows = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  static String? _iso(DateTime? d) =>
      d == null ? null : intl.DateFormat('yyyy-MM-dd').format(d);

  Future<void> _load() async {
    setState(() => _loading = true);
    final rows = await LocalDb.instance.listInspections(
        from: _iso(_from),
        to: _iso(_to),
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

  /// خانة تاريخ واحدة — «من» أو «إلى». فاضية معناها مفيش حد من الناحية دي.
  ///
  /// The box is deliberately spare — label, date, and nothing else. It used to carry a calendar
  /// icon on one side and a clear button on the other, which on a phone left «2026/08/14» about
  /// forty pixels to sit in and it wrapped mid-date («2026/0» over «8/14»). Tapping opens the
  /// picker, and «كل التواريخ» next to the pair clears both.
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
        // A range typed backwards would silently show nothing; nudging the other end keeps the
        // filter meaning what it says.
        if (_from != null && _to != null && _to!.isBefore(_from!)) {
          setState(() => label == 'من' ? _to = picked : _from = picked);
        }
        _load();
      },
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
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('مراجعة الزيارات')),
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

  Widget _chip(String label, bool selected, VoidCallback toggle) {
    return Padding(
      padding: const EdgeInsets.only(left: 8),
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
                  // التعديل طول ما هي متزامنتش.
                  //
                  // A visit that has not reached the server exists on this phone and nowhere else,
                  // so correcting it is just correcting a form. Once it HAS synced it is a record
                  // the office may already have acted on, and the phone is no longer where it gets
                  // corrected — hence the badge instead of a disabled button nobody can explain.
                  if (!insp.synced)
                    IconButton(
                      tooltip: 'تعديل',
                      icon: const Icon(Icons.edit_outlined, color: AppColors.primary),
                      onPressed: () async {
                        Navigator.pop(c);
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => InspectionFormScreen(
                              visitKind: insp.visitKind,
                              existing: insp,
                            ),
                          ),
                        );
                        _load();
                      },
                    )
                  else
                    const Padding(
                      padding: EdgeInsetsDirectional.only(end: 4),
                      child: Chip(
                        avatar: Icon(Icons.lock_outline, size: 16, color: AppColors.success),
                        label: Text('اتزامنت — مش بتتعدّل من التطبيق',
                            style: TextStyle(fontSize: 11)),
                        visualDensity: VisualDensity.compact,
                      ),
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
              // الأصناف والنقاط بيظهروا لو فيه أصناف بس.
              //
              // A «زيارة عادية» has no items by design, and the section still printed its heading
              // and «الإجمالي ٠ نقطة» under every one of them — a heading over nothing, and a
              // zero that reads like the rep forgot to record something.
              if (insp.lines.isNotEmpty) ...[
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
              // المرفقات — الصور اللي المندوب صوّرها في الزيارة.
              //
              // They were saved and synced but had nowhere to be seen: the sheet is the only place
              // a recorded visit can be read back, and it showed everything about the visit except
              // the photographs of it.
              _AttachmentsPreview(inspectionUuid: insp.clientUuid),
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

/// صور الزيارة — بتتقرا من قاعدة الجهاز لما التفاصيل تتفتح.
///
/// Loaded here rather than with the visit list: a hundred rows would each hit the attachment
/// table for photographs nobody has asked to see yet.
class _AttachmentsPreview extends StatefulWidget {
  const _AttachmentsPreview({required this.inspectionUuid});
  final String inspectionUuid;

  @override
  State<_AttachmentsPreview> createState() => _AttachmentsPreviewState();
}

class _AttachmentsPreviewState extends State<_AttachmentsPreview> {
  List<Map<String, Object?>> _rows = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    LocalDb.instance.attachments(widget.inspectionUuid).then((r) {
      if (mounted) setState(() { _rows = r; _loading = false; });
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 24),
        Text('المرفقات (${_rows.length})',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        SizedBox(
          height: 110,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _rows.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) {
              final path = _rows[i]['path'] as String;
              final file = File(path);
              return InkWell(
                onTap: () => _openFull(context, file),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: file.existsSync()
                      ? Image.file(file, width: 110, height: 110, fit: BoxFit.cover)
                      // The row is kept even when the file is gone — deleted from the gallery,
                      // or restored onto a different phone. Silently dropping it would say the
                      // visit had no photographs, which is a different and wronger claim.
                      : Container(
                          width: 110,
                          height: 110,
                          color: Colors.black12,
                          child: const Center(
                            child: Icon(Icons.image_not_supported_outlined,
                                color: Colors.blueGrey),
                          ),
                        ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  void _openFull(BuildContext context, File file) {
    if (!file.existsSync()) return;
    showDialog(
      context: context,
      builder: (c) => Dialog(
        insetPadding: const EdgeInsets.all(12),
        child: InteractiveViewer(child: Image.file(file)),
      ),
    );
  }
}
