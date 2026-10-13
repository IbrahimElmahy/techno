import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'inspection_form_screen.dart';

class InspectionDraftsScreen extends StatefulWidget {
  const InspectionDraftsScreen({super.key});

  @override
  State<InspectionDraftsScreen> createState() => _InspectionDraftsScreenState();
}

class _InspectionDraftsScreenState extends State<InspectionDraftsScreen> {
  List<Inspection>? _drafts;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await LocalDb.instance.inspectionDrafts();
    if (!mounted) return;
    setState(() => _drafts = [for (final r in rows) Inspection.fromDraft(r)]);
  }

  Future<void> _open(Inspection d) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
          builder: (_) => InspectionFormScreen(visitKind: d.visitKind, draft: d)),
    );
    await Future<void>.delayed(const Duration(milliseconds: 150));
    _load();
  }

  Future<void> _delete(Inspection d) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('حذف المسودة'),
          content: Text('هل تريد حذف مسودة «${_titleOf(d)}» نهائياً؟'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(c, true),
              child: const Text('حذف'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    await LocalDb.instance.deleteInspectionDraft(d.clientUuid);
    _load();
  }

  static String _titleOf(Inspection d) =>
      d.ownerName.trim().isEmpty ? 'معاينة بلا اسم' : d.ownerName.trim();

  static String _fmt(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);

  static String _when(String? iso) {
    final t = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
    if (t == null) return '';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${t.year}/${two(t.month)}/${two(t.day)} ${two(t.hour)}:${two(t.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final drafts = _drafts;
    return Scaffold(
      appBar: AppBar(title: const Text('مسودات المعاينات')),
      body: drafts == null
          ? const Center(child: CircularProgressIndicator())
          : drafts.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.drafts_outlined, size: 52, color: Colors.grey.shade400),
                      const SizedBox(height: 10),
                      Text('لا توجد مسودات',
                          style: TextStyle(fontSize: 15, color: Colors.grey.shade700)),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: drafts.length,
                  itemBuilder: (_, i) {
                    final d = drafts[i];
                    final parts = <String>[
                      if (d.lines.isNotEmpty) '${d.lines.length} صنف',
                      if (d.lines.isNotEmpty) '${_fmt(d.totalPoints)} نقطة',
                      if ((d.purchaseShop ?? '').isNotEmpty) d.purchaseShop!,
                    ];
                    return Card(
                      child: ListTile(
                        leading: const CircleAvatar(
                          backgroundColor: Color(0xFFFFF6E5),
                          child: Icon(Icons.edit_note, color: AppColors.accent),
                        ),
                        title: Text(_titleOf(d),
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text([
                          if (parts.isNotEmpty) parts.join(' · '),
                          'آخر تعديل: ${_when(d.createdAt)}',
                        ].join('\n')),
                        isThreeLine: parts.isNotEmpty,
                        trailing: IconButton(
                          tooltip: 'حذف المسودة',
                          icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                          onPressed: () => _delete(d),
                        ),
                        onTap: () => _open(d),
                      ),
                    );
                  },
                ),
    );
  }
}
