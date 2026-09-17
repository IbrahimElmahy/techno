import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../theme.dart';
import 'transfer_request_screen.dart';

/// طلبات التحويل بتاعة الجهاز — اللي راح واللي لسه.
///
/// الشاشة دي ماكانتش موجودة خالص: الطلب بيتكتب ويروح الطابور ومافيش طريق يوصّلك له
/// تاني. فاللي كتب صنف غلط أو كمية غلط ماكانش قدامه غير إنه يعمل طلب تاني ويسيب الأول
/// يوصل المكتب زي ما هو — والمسؤول بيلاقي طلبين متناقضين ومايعرفش أنهي واحد الصح.
///
/// **واللي اترفع مابيتعدلش.** الطلب اللي وصل السيرفر بقى مستند عند المكتب واللي بيراجعه
/// هناك بيبص عليه دلوقتي؛ تعديله على الجهاز بيخلّي الاتنين يقولوا حاجتين. اللي في الطابور
/// بيتعدّل ويتمسح، واللي وصل بيتقري وبس — نفس قاعدة فاتورة البيع بالحرف.
class TransfersReviewScreen extends StatefulWidget {
  const TransfersReviewScreen({super.key});

  @override
  State<TransfersReviewScreen> createState() => _TransfersReviewScreenState();
}

class _TransfersReviewScreenState extends State<TransfersReviewScreen> {
  List<Map<String, Object?>> _rows = [];
  Map<int, String> _wh = {};
  bool _loading = true;
  bool _pushing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await LocalDb.instance.transfers();
    final ws = await LocalDb.instance.warehouses();
    if (!mounted) return;
    setState(() {
      _rows = rows;
      _wh = {for (final w in ws) w['id'] as int: '${w['name']}'};
      _loading = false;
    });
  }

  String _place(String? kind, int? id) {
    if (kind == 'custody') return 'عربيتي (عهدتي)';
    return _wh[id] ?? 'مخزن #$id';
  }

  Future<void> _sync() async {
    setState(() => _pushing = true);
    try {
      final n = await ApiClient.instance.pushTransfers();
      if (!mounted) return;
      _say(n > 0 ? 'اترفع $n طلب' : 'مافيش طلبات مستنية');
      await _load();
    } on ApiException catch (e) {
      if (mounted) _say(e.message);
    } catch (_) {
      if (mounted) _say('مش قادر أوصل للسيرفر — جرّب تاني');
    } finally {
      if (mounted) setState(() => _pushing = false);
    }
  }

  void _say(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final pending = _rows.where((r) => (r['synced'] as int?) != 1).length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('طلبات التحويل'),
        actions: [
          IconButton(
            tooltip: 'ارفع اللي في الطابور',
            icon: _pushing
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.cloud_upload_outlined),
            onPressed: _pushing ? null : _sync,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final changed = await Navigator.push<bool>(context,
              MaterialPageRoute(builder: (_) => const TransferRequestScreen()));
          if (changed == true) _load();
        },
        icon: const Icon(Icons.add),
        label: const Text('طلب جديد'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _rows.isEmpty
                  ? ListView(children: const [
                      SizedBox(height: 120),
                      Center(child: Text('مافيش طلبات تحويل على الجهاز')),
                    ])
                  : ListView(
                      children: [
                        if (pending > 0)
                          Card(
                            color: const Color(0xFFFFF6E5),
                            child: ListTile(
                              leading: const Icon(Icons.schedule, color: AppColors.accent),
                              title: Text('$pending طلب مستني الرفع'),
                              subtitle: const Text('اضغط السحابة فوق عشان ترفعهم'),
                            ),
                          ),
                        for (final r in _rows) _card(r),
                        const SizedBox(height: 80),
                      ],
                    ),
            ),
    );
  }

  Widget _card(Map<String, Object?> r) {
    final synced = (r['synced'] as int?) == 1;
    final localId = r['local_id'] as int;
    return Card(
      child: ExpansionTile(
        leading: Icon(synced ? Icons.check_circle : Icons.schedule,
            color: synced ? AppColors.success : AppColors.accent),
        title: Text(
            '${_place(r['source_kind'] as String?, r['source_id'] as int?)}'
            '  ←  ${_place(r['dest_kind'] as String?, r['dest_id'] as int?)}',
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        subtitle: Text([
          (r['created_at'] as String? ?? '').split('T').first,
          if (synced) (r['document_number'] as String? ?? 'اترفع') else 'لسه على الجهاز',
        ].where((s) => s.isNotEmpty).join(' · ')),
        children: [
          FutureBuilder<List<Map<String, Object?>>>(
            future: LocalDb.instance.transferLines(localId),
            builder: (_, snap) {
              final lines = snap.data ?? const <Map<String, Object?>>[];
              return Column(
                children: [
                  for (final l in lines)
                    ListTile(
                      dense: true,
                      title: Text((l['item_name'] as String?) ?? ''),
                      trailing: Text(_trim((l['quantity'] as num?)?.toDouble() ?? 0),
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  if ((r['notes'] as String?)?.trim().isNotEmpty ?? false)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.notes, size: 18),
                      title: Text('${r['notes']}'),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        if (!synced)
                          TextButton.icon(
                            onPressed: () async {
                              final changed = await Navigator.push<bool>(
                                context,
                                MaterialPageRoute(
                                    builder: (_) =>
                                        TransferRequestScreen(existing: r)),
                              );
                              if (changed == true) _load();
                            },
                            icon: const Icon(Icons.edit_outlined),
                            label: const Text('تعديل'),
                          )
                        else
                          const Padding(
                            padding: EdgeInsets.only(right: 8),
                            child: Text('اترفع للنظام — التعديل من المكتب',
                                style: TextStyle(fontSize: 11, color: Colors.black45)),
                          ),
                        // **المسح للي في الطابور بس.** الطلب اللي وصل المكتب مستند
                        // اتقري؛ مسحه من الجهاز بيخلّي المندوب فاكر إنه اتلغى وهو
                        // لسه مستني الاعتماد هناك.
                        if (!synced)
                          TextButton.icon(
                            onPressed: () => _confirmDelete(localId),
                            icon: const Icon(Icons.delete_outline,
                                color: AppColors.danger),
                            label: const Text('مسح',
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

  Future<void> _confirmDelete(int localId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تمسح الطلب؟'),
          content: const Text('الطلب لسه ما اترفعش، فهيتشال من الجهاز خالص.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('لأ')),
            TextButton(
                onPressed: () => Navigator.pop(c, true),
                child: const Text('امسح', style: TextStyle(color: AppColors.danger))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final done = await LocalDb.instance.deleteQueuedTransfer(localId);
    if (!mounted) return;
    if (!done) {
      _say('الطلب اترفع قبل المسح — بقى مستند عند المكتب.');
    }
    _load();
  }
}

String _trim(double v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();
