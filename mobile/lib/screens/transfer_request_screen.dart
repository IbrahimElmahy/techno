import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'sale_add_item_flow.dart';

class TransferRequestScreen extends StatefulWidget {
  const TransferRequestScreen({super.key, this.existing});

  final Map<String, Object?>? existing;

  @override
  State<TransferRequestScreen> createState() => _TransferRequestScreenState();
}

class _Line {
  _Line(this.item);
  final SaleItem item;
  double? quantity;

  final ctl = TextEditingController();

  String get text {
    final q = quantity;
    if (q == null || q == 0) return '';
    return q == q.roundToDouble() ? q.toInt().toString() : q.toString();
  }
}

class _TransferRequestScreenState extends State<TransferRequestScreen> {
  List<Map<String, Object?>> _warehouses = [];
  final _lines = <_Line>[];
  final _notes = TextEditingController();

  String? _myKind;
  int? _myId;

  String? _source;
  String? _dest;
  DateTime _date = DateTime.now();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _notes.dispose();
    for (final l in _lines) {
      l.ctl.dispose();
    }
    super.dispose();
  }

  Map<String, Object?>? get _existing => widget.existing;
  bool get _isEditing => _existing != null;
  int? get _editingId => _existing?['local_id'] as int?;

  Future<void> _load() async {
    final ws = await LocalDb.instance.warehouses();
    final kind = await LocalDb.instance.getKv('store_kind');
    final id = int.tryParse(await LocalDb.instance.getKv('store_id') ?? '');
    final r = _existing;
    final lines = r == null
        ? const <Map<String, Object?>>[]
        : await LocalDb.instance.transferLines(r['local_id'] as int);
    if (!mounted) return;
    setState(() {
      _warehouses = ws;
      _myKind = kind;
      _myId = id;
      if (r == null) {
        if (kind != null && id != null) _dest = '$kind:$id';
        return;
      }
      _source = '${r['source_kind']}:${r['source_id']}';
      _dest = '${r['dest_kind']}:${r['dest_id']}';
      _notes.text = (r['notes'] as String?) ?? '';
      final d = DateTime.tryParse((r['transfer_date'] as String?) ?? '');
      if (d != null) _date = d;
      for (final l in lines) {
        final line = _Line(SaleItem(
          itemId: l['item_id'] as int,
          name: (l['item_name'] as String?) ?? '',
        ));
        line.quantity = (l['quantity'] as num?)?.toDouble();
        line.ctl.text = line.text;
        _lines.add(line);
      }
    });
  }

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

  List<DropdownMenuItem<String>> get _otherPlaces {
    final mine = _myKind == 'warehouse' ? 'warehouse:$_myId' : '__me__';
    return [for (final d in _places) if (d.value != mine) d];
  }

  String _myPlaceName() {
    if (_myId == null) return 'اسحب البيانات الأول — مخزنك مش معروف';
    if (_myKind == 'custody') return 'عربيتي (عهدتي)';
    for (final w in _warehouses) {
      if (w['id'] == _myId) return '${w['name']}';
    }
    return 'مخزني (#$_myId)';
  }

  String _resolve(String v) =>
      v == '__me__' ? '$_myKind:$_myId' : v;

  bool get _sourceIsMine =>
      _source == '__me__' ||
      (_myKind != null && _myId != null && _source == '$_myKind:$_myId');

  Future<List<SaleItem>?> _sourceItems() async {
    if (_sourceIsMine) return null;
    final id = int.tryParse((_source ?? '').split(':').last);
    if (id == null) return const <SaleItem>[];
    return LocalDb.instance.warehouseItems(id);
  }

  Future<void> _addItem() async {
    if (_source == null) {
      _say('اختر المخزن اللي البضاعة جاية منه الأول');
      return;
    }
    final source = await _sourceItems();
    if (!mounted) return;
    await SaleAddItemFlow.show(
      context,
      source: source,
      alreadyOnInvoice: {
        for (final l in _lines) l.item.itemId: l.quantity ?? 0
      },
      priceTier: null,
      capToAvailable: false,
      showAvailable: false,
      showPrice: false,
      onAdd: (picked, qty) {
        setState(() {
          final i = _lines.indexWhere((l) => l.item.itemId == picked.itemId);
          if (i >= 0) {
            final l = _lines[i];
            l.quantity = (l.quantity ?? 0) + qty;
            l.ctl.text = l.text;
          } else {
            final l = _Line(picked)..quantity = qty;
            l.ctl.text = l.text;
            _lines.add(l);
          }
        });
      },
    );
  }

  Future<void> _save() async {
    final src = _source, dst = _dest;
    if (dst == null) {
      _say('مخزنك مش معروف على الجهاز — اعمل مزامنة الأول');
      return;
    }
    if (src == null) {
      _say('اختر المخزن اللي البضاعة جاية منه');
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
      final rows = [
        for (final l in valid)
          {
            'item_id': l.item.itemId,
            'item_name': l.item.name,
            'quantity': l.quantity,
          }
      ];
      if (_isEditing) {
        final ok = await LocalDb.instance.updateQueuedTransfer(
          localId: _editingId!,
          sourceKind: s[0],
          sourceId: int.parse(s[1]),
          destKind: d[0],
          destId: int.parse(d[1]),
          notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
          transferDate: _date.toIso8601String().substring(0, 10),
          lines: rows,
        );
        if (!mounted) return;
        if (!ok) {
          _say('الطلب اترفع للنظام وهو بيتعدّل — التعديل اتلغى. '
              'عدّله من النظام أو اعمل طلب جديد.');
          Navigator.pop(context, true);
          return;
        }
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('اتعدّل — هيترفع مع المزامنة')),
        );
        return;
      }
      await LocalDb.instance.saveTransfer(
        clientUuid: DateTime.now().microsecondsSinceEpoch.toString(),
        sourceKind: s[0],
        sourceId: int.parse(s[1]),
        destKind: d[0],
        destId: int.parse(d[1]),
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        transferDate: _date.toIso8601String().substring(0, 10),
        lines: rows,
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
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(m, style: const TextStyle(fontSize: 14)),
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 24),
      duration: const Duration(seconds: 5),
    ));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          title: Text(_isEditing ? 'تعديل طلب التحويل' : 'طلب تحويل بضاعة')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          InkWell(
            onTap: () async {
              final d = await showDatePicker(
                context: context,
                initialDate: _date,
                firstDate: DateTime.now().subtract(const Duration(days: 90)),
                lastDate: DateTime.now(),
                locale: const Locale('ar'),
              );
              if (d != null) setState(() => _date = d);
            },
            child: InputDecorator(
              decoration: const InputDecoration(
                labelText: 'التاريخ',
                border: OutlineInputBorder(),
                suffixIcon: Icon(Icons.edit_calendar_outlined),
              ),
              child: Text(_date.toIso8601String().substring(0, 10),
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _source,
            decoration: const InputDecoration(
              labelText: 'من',
              border: OutlineInputBorder(),
            ),
            items: _otherPlaces,
            onChanged: (v) => setState(() {
              if (v != _source && _lines.isNotEmpty) {
                _lines.clear();
                _say('الأصناف اتشالت — المصدر اتغيّر');
              }
              _source = v;
            }),
          ),
          const SizedBox(height: 12),
          InputDecorator(
            decoration: const InputDecoration(
              labelText: 'إلى',
              border: OutlineInputBorder(),
            ),
            child: Row(
              children: [
                const Icon(Icons.lock_outline, size: 15, color: Colors.black38),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(_myPlaceName(),
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 14)),
                ),
              ],
            ),
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
            for (final (n, l) in _lines.indexed)
              Card(
                child: ListTile(
                  leading: Text('${n + 1}',
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w700,
                          color: Colors.black54)),
                  title: Text(l.item.name),
                  subtitle: Text(_sourceIsMine
                      ? 'المتاح عندك: ${l.item.onHand}'
                      : (l.item.category ?? '')),
                  trailing: SizedBox(
                    width: 96,
                    child: TextField(
                      controller: l.ctl,
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
                  onLongPress: () => setState(() {
                    l.ctl.dispose();
                    _lines.remove(l);
                  }),
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
