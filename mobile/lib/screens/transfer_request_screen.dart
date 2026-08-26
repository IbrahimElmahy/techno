import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'sale_item_picker_screen.dart';

/// طلب تحويل بضاعة — من مخزن لمخزن، أو من عربية المندوب لمخزن.
///
/// المندوب كان مالوش أي طريق يطلب بيه بضاعة أو يرجّعها: صلاحية `transfer.initiate`
/// ماكانتش معاه أصلاً، فالسيرفر كان بيرد 403 على أي محاولة. والنتيجة إن البضاعة اللي في
/// العربية والبضاعة اللي محتاجها من المخزن كانوا بيتنقلوا بتليفون وورقة.
///
/// الإذن بيتكتب **وهو من غير شبكة** زي الفاتورة بالظبط، وبيتخزّن على الجهاز لحد المزامنة.
/// وبيوصل السيرفر **معلّق**: المندوب بيطلب، والمسؤول بيراجع ويعدّل أو يرفض أو يعتمد —
/// والاعتماد هو اللي بيحرّك البضاعة. المندوب مالوش صلاحية يعتمد لنفسه، والسيرفر هو اللي
/// بيمنعها مش الشاشة.
class TransferRequestScreen extends StatefulWidget {
  const TransferRequestScreen({super.key});

  @override
  State<TransferRequestScreen> createState() => _TransferRequestScreenState();
}

class _Line {
  _Line(this.item);
  final SaleItem item;
  double? quantity;
}

class _TransferRequestScreenState extends State<TransferRequestScreen> {
  List<Map<String, Object?>> _warehouses = [];
  final _lines = <_Line>[];
  final _notes = TextEditingController();

  /// مكان المندوب نفسه — بيتقرا من اللي السيرفر قاله وقت السحب، مش مفترض.
  String? _myKind;
  int? _myId;

  /// المصدر والوجهة. `custody:12` أو `warehouse:3` — نفس شكل شاشة الويب.
  String? _source;
  String? _dest;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ws = await LocalDb.instance.warehouses();
    final kind = await LocalDb.instance.getKv('store_kind');
    final id = int.tryParse(await LocalDb.instance.getKv('store_id') ?? '');
    if (!mounted) return;
    setState(() {
      _warehouses = ws;
      _myKind = kind;
      _myId = id;
      // المصدر بيفتح على مكان المندوب: أغلب الأذون بتطلع من عربيته، واللي عايز
      // العكس بيغيّرها بضغطة.
      if (kind != null && id != null) _source = '$kind:$id';
    });
  }

  /// الأماكن اللي ينفع تكون مصدر أو وجهة: كل المخازن، ومعاها مكان المندوب نفسه.
  List<DropdownMenuItem<String>> get _places {
    final out = <DropdownMenuItem<String>>[];
    if (_myKind == 'custody' && _myId != null) {
      out.add(const DropdownMenuItem(
          value: '__me__', child: Text('عربيتي (عهدتي)')));
    }
    for (final w in _warehouses) {
      out.add(DropdownMenuItem(
        value: 'warehouse:${w['id']}',
        child: Text('${w['name']}'),
      ));
    }
    return out;
  }

  String _resolve(String v) =>
      v == '__me__' ? '$_myKind:$_myId' : v;

  Future<void> _addItem() async {
    final picked = await Navigator.push<SaleItem>(
      context,
      MaterialPageRoute(builder: (_) => const SaleItemPickerScreen()),
    );
    if (picked == null) return;
    if (!mounted) return;
    if (_lines.any((l) => l.item.itemId == picked.itemId)) {
      _say('«${picked.name}» موجود — عدّل الكمية من السطر');
      return;
    }
    setState(() => _lines.add(_Line(picked)));
  }

  Future<void> _save() async {
    final src = _source, dst = _dest;
    if (src == null || dst == null) {
      _say('اختر المصدر والوجهة');
      return;
    }
    if (_resolve(src) == _resolve(dst)) {
      _say('المصدر والوجهة لازم يكونوا مكانين مختلفين');
      return;
    }
    final valid = _lines.where((l) => (l.quantity ?? 0) > 0).toList();
    if (valid.isEmpty) {
      _say('أضف صنف واحد على الأقل بكمية أكبر من صفر');
      return;
    }

    setState(() => _saving = true);
    try {
      final s = _resolve(src).split(':');
      final d = _resolve(dst).split(':');
      await LocalDb.instance.saveTransfer(
        clientUuid: DateTime.now().microsecondsSinceEpoch.toString(),
        sourceKind: s[0],
        sourceId: int.parse(s[1]),
        destKind: d[0],
        destId: int.parse(d[1]),
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        lines: [
          for (final l in valid)
            {
              'item_id': l.item.itemId,
              'item_name': l.item.name,
              'quantity': l.quantity,
            }
        ],
      );
      if (!mounted) return;
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('اتسجّل الطلب — هيترفع مع المزامنة ويستنى الاعتماد'),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _say(String m) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('طلب تحويل بضاعة')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DropdownButtonFormField<String>(
            initialValue: _source,
            decoration: const InputDecoration(
              labelText: 'من',
              border: OutlineInputBorder(),
            ),
            items: _places,
            onChanged: (v) => setState(() => _source = v),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _dest,
            decoration: const InputDecoration(
              labelText: 'إلى',
              border: OutlineInputBorder(),
            ),
            items: _places,
            onChanged: (v) => setState(() => _dest = v),
          ),
          const SizedBox(height: 16),

          FilledButton.icon(
            onPressed: _addItem,
            icon: const Icon(Icons.add),
            label: const Text('إضافة صنف'),
          ),
          const SizedBox(height: 8),

          if (_lines.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: Text('مافيش أصناف على الطلب لسه')),
            )
          else
            for (final l in _lines)
              Card(
                child: ListTile(
                  title: Text(l.item.name),
                  subtitle: Text('المتاح عندك: ${l.item.onHand}'),
                  trailing: SizedBox(
                    width: 96,
                    child: TextFormField(
                      initialValue: l.quantity?.toString() ?? '',
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'الكمية',
                        isDense: true,
                      ),
                      onChanged: (v) =>
                          setState(() => l.quantity = double.tryParse(v)),
                    ),
                  ),
                  onLongPress: () => setState(() => _lines.remove(l)),
                ),
              ),

          const SizedBox(height: 12),
          TextField(
            controller: _notes,
            decoration: const InputDecoration(
              labelText: 'ملاحظات',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 20),

          // النص ده مش تجميل: المندوب اللي بيبعت الطلب ويروح يبص على بضاعته يلاقيها
          // زي ما هي، لازم يعرف إن ده صح — البضاعة بتتحرك عند الاعتماد مش عند الطلب.
          const Text(
            'الطلب بيروح للمسؤول — البضاعة بتتحرك بعد ما يعتمده.',
            style: TextStyle(color: Colors.black54),
          ),
          const SizedBox(height: 12),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              minimumSize: const Size.fromHeight(48),
            ),
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'بيتحفظ…' : 'إرسال الطلب'),
          ),
        ],
      ),
    );
  }
}
