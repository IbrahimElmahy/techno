import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../services/auto_sync.dart';
import '../theme.dart';

/// «مزامنة البيانات» — push pending inspections up, pull catalog + lookups down.
class SyncScreen extends StatefulWidget {
  const SyncScreen({super.key});

  @override
  State<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends State<SyncScreen> {
  /// إعدادات السيرفر مستخبية عن المندوب — بتظهر بضغطة طويلة على أيقونة السحابة.
  ///
  /// مش محذوفة: العنوان ده هو اللي أنقذ الدخول يوم ما الدومين القديم مات، وحذفه
  /// معناه إن أي مشكلة زيّها بكرة تحتاج نسخة تطبيق جديدة. بس المندوب مالوش دعوة
  /// بيه، وخانة URL قدام كل مستخدم بتتغيّر بالغلط — والتطبيق كله يقف بصمت.
  bool _showServer = false;

  int _pending = 0;
  String? _lastSync;
  String? _lastPull;
  bool _busy = false;
  String? _status;
  bool _error = false;
  final _serverCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    // Both queues are "work waiting to go up" as far as the rep is concerned.
    final p = await LocalDb.instance.pendingCount() +
        await LocalDb.instance.pendingCouponReceiptCount() +
        await LocalDb.instance.pendingSalesCount() +
        await LocalDb.instance.pendingReceiptsCount();
    final ls = await LocalDb.instance.getKv('last_sync');
    final lp = await LocalDb.instance.getKv('last_pull');
    _serverCtrl.text = await ApiClient.instance.baseUrl();
    if (mounted) {
      setState(() {
        _pending = p;
        _lastSync = ls;
        _lastPull = lp;
      });
    }
  }

  /// **نفس الكود بتاع المزامنة اللي بتحصل لوحدها**، مش نسخة تانية منه.
  ///
  /// كان فيه تنفيذين لنفس العملية — واحد هنا وواحد في الأوتوماتيك. نسختين من قاعدة
  /// واحدة هما إزاي واحدة منهم تفضل قديمة من غير ما حد ياخد باله: أي مستند جديد
  /// يتضاف للطابور ويتنسى في واحدة، فالمندوب اللي بيزامن من الشاشة يرفعه واللي
  /// بيعتمد على الأوتوماتيك لأ.
  Future<void> _syncNow() async {
    setState(() {
      _busy = true;
      _status = 'جاري المزامنة...';
      _error = false;
    });
    await AutoSync.instance.run();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = AutoSync.instance.state == AutoSyncState.failed;
      _status = _error
          ? 'فشلت المزامنة: ${AutoSync.instance.message}'
          : AutoSync.instance.message;
    });
    _refresh();
  }

  Future<void> _saveServer() async {
    final url = _serverCtrl.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (url.isEmpty) return;
    await LocalDb.instance.setKv('api_base', url);
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('تم حفظ عنوان السيرفر ✔')));
    }
  }

  String _fmtTime(String? iso) {
    if (iso == null) return '—';
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '—';
    return '${dt.year}/${dt.month.toString().padLeft(2, "0")}/${dt.day.toString().padLeft(2, "0")} '
        '${dt.hour.toString().padLeft(2, "0")}:${dt.minute.toString().padLeft(2, "0")}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('مزامنة البيانات')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  GestureDetector(
                    onLongPress: () => setState(() => _showServer = !_showServer),
                    child: Icon(
                      _pending > 0 ? Icons.cloud_upload_outlined : Icons.cloud_done,
                      size: 56,
                      color: _pending > 0 ? AppColors.accent : AppColors.success,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _pending > 0
                        ? 'في $_pending معاينة مستنية الرفع'
                        : 'كل المعاينات متزامنة ✔',
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Text('آخر مزامنة: ${_fmtTime(_lastSync)}',
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                  Text('آخر تحديث للأصناف: ${_fmtTime(_lastPull)}',
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: _busy ? null : _syncNow,
                    icon: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.sync),
                    label: const Text('مزامنة الآن'),
                  ),
                  if (_status != null) ...[
                    const SizedBox(height: 12),
                    Text(_status!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            color: _error ? AppColors.danger : AppColors.success,
                            fontWeight: FontWeight.w600)),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_showServer)
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('إعدادات السيرفر',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _serverCtrl,
                    keyboardType: TextInputType.url,
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(
                        labelText: 'عنوان السيرفر',
                        prefixIcon: Icon(Icons.dns_outlined)),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(onPressed: _saveServer, child: const Text('حفظ العنوان')),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
