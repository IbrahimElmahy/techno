import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'sale_add_item_flow.dart';

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
  const TransferRequestScreen({super.key, this.existing});

  /// صف `stock_transfer` اللي بيتعدّل. `null` = طلب جديد.
  ///
  /// **واللي اترفع مابيتفتحش هنا أصلاً** — الشاشة اللي بتنده بتقرا `synced` وبتفتح
  /// المرفوع للقراءة. والحفظ كمان بيتأكد تاني من القاعدة، لأن المزامنة ممكن تخلص
  /// واللي بيعدّل لسه ماقفلش الشاشة.
  final Map<String, Object?>? existing;

  @override
  State<TransferRequestScreen> createState() => _TransferRequestScreenState();
}

class _Line {
  _Line(this.item);
  final SaleItem item;
  double? quantity;

  /// خانة الكمية بتاعة السطر ده — **بتعيش مع السطر، مش بتتعمل كل رندر**.
  ///
  /// كانت `TextFormField` بـ`key: ValueKey('q$id-$quantity')` و`initialValue`. المفتاح
  /// بيتغيّر مع كل حرف، فـFlutter بيرمي الخانة ويعمل واحدة جديدة قيمتها `quantity.toString()`
  /// — يعني اللي كتب «١» بتترسم له «1.0» والحرف اللي بعده بيتلزق على عشرية مالهاش لازمة.
  /// الكنترولر الثابت بيخلّي اللي مكتوب هو اللي المندوب كتبه وبس.
  final ctl = TextEditingController();

  /// الرقم اللي يتعرض: الفاضي والصفر بيفضلوا فاضيين — خانة رقم فيها «٠» عقبة مش قيمة.
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

  /// مكان المندوب نفسه — بيتقرا من اللي السيرفر قاله وقت السحب، مش مفترض.
  String? _myKind;
  int? _myId;

  /// المصدر والوجهة. `custody:12` أو `warehouse:3` — نفس شكل شاشة الويب.
  String? _source;
  String? _dest;
  /// تاريخ الطلب. بيبدأ بالنهارده والمندوب يقدر يغيّره — الطلب اللي بيتكتب الصبح على
  /// بضاعة خرجت امبارح لازم يقول امبارح، وإلا المخزون بيتقيّد على اليوم الغلط.
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

  /// الإذن اللي بيتعدّل — `null` لطلب جديد.
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
        // **الوجهة** هي اللي بتتحط لوحدها — عربية المندوب. والمصدر بيفضل فاضي
        // لحد ما يختار، لأنه هو السؤال: البضاعة جاية منين.
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

  /// الأماكن اللي ينفع تكون مصدر — كل حاجة ماعدا مكان المندوب نفسه.
  List<DropdownMenuItem<String>> get _otherPlaces {
    final mine = _myKind == 'warehouse' ? 'warehouse:$_myId' : '__me__';
    return [for (final d in _places) if (d.value != mine) d];
  }

  /// اسم مكان المندوب زي ما هو مكتوب على المخزن في المكتب.
  ///
  /// المخزن بينزل مع حزمة البيع، فالاسم موجود على الجهاز من غير شبكة. ولو الحزمة
  /// ماتسحبتش لسه، بيتقال إنها ماتسحبتش — مش بيتساب فاضي والمندوب يفتكر إنه اختيار.
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

  /// أصناف المصدر اللي اتختار — بتتجاب أول ما الصنف يتطلب.
  ///
  /// `null` = مافيش شبكة ساعتها، والشاشة بترجع لكتالوج الفرع. لسه أوسع من اللازم، بس
  /// أحسن من قايمة فاضية والمندوب واقف في المخزن.
  Future<List<SaleItem>?> _sourceItems() async {
    final src = _source;
    if (src == null) return null;
    final parts = _resolve(src).split(':');
    if (parts.length != 2) return null;
    try {
      return await ApiClient.instance
          .stockAtLocation(parts[0], int.parse(parts[1]));
    } catch (_) {
      return null;
    }
  }

  Future<void> _addItem() async {
    // بوبابات متتالية زي أصناف المعاينة: فئة ← صنف ← كمية، و«التالي» بيكمّل من
    // غير خروج. كانت شاشة كاملة بترجع صنف من غير كمية، والكمية تتكتب بعدين في
    // خانة صغيرة على السطر.
    //
    // المتاح حد **بس لما المصدر عربيته**: مايبعتش اللي مش معاه. الطلب من المخزن
    // مالوش الحد ده — هو أصلاً بيطلب حاجة ناقصاه، والمسؤول بيراجع قبل الاعتماد.
    // والسعر مش بيتعرض: إذن تحويل مافيهوش فلوس.
    // أصناف المخزن اللي اختاره — الطلب من مخزن مش من كتالوج.
    final atSource = await _sourceItems();
    if (!mounted) return;
    // **اللي في المصدر وبس — ومافيش رجوع للكتالوج.**
    //
    // كان لما قراءة رصيد المصدر تفشل (مافيش شبكة) بيفتح كتالوج الفرع كله. فالمندوب
    // بيلاقي أصناف المخزن ده مافيهوش منها ولا واحدة، ويطلبها، والطلب بيترفض عند
    // الاعتماد بعد يوم — أو أوحش، يتعدّل ويوصله غير اللي طلبه.
    //
    // الكتالوج مش «أوسع شوية» — هو إجابة على سؤال تاني خالص: «الشركة بتبيع إيه»
    // مش «المخزن ده فيه إيه». والقايمة الفاضية اللي بتقول السبب أصدق من قايمة مليانة
    // بتوعد بحاجة مش موجودة.
    if (atSource == null) {
      _say('مش قادر أقرا رصيد المخزن ده — اتأكد من النت وجرّب تاني');
      return;
    }
    if (atSource.isEmpty) {
      _say('المخزن ده مافيهوش رصيد لأي صنف دلوقتي');
      return;
    }
    await SaleAddItemFlow.show(
      context,
      alreadyOnInvoice: {
        for (final l in _lines) l.item.itemId: l.quantity ?? 0
      },
      // اللي في المصدر وبس — القايمة دي هي المصدر الوحيد للأصناف هنا.
      items0: atSource,
      priceTier: null,
      // **الطلب مايتحدش بالمتاح، ولا بيعرضه أصلاً.**
      //
      // المندوب بيطلب اللي محتاجه — ده معنى الطلب. ولو الكمية ناقصة عندنا، المكتب
      // بيعدّل الطلب أو يرفضه، وده قراره هو: هو اللي شايف المخزن كله والطلبات
      // التانية والوارد الجاي.
      //
      // وعرض المتاح كان بيشوّه الطلب من غير ما يمنعه: المندوب اللي محتاج ١٠٠ ويشوف
      // «عندك ٦٠» بيكتب ٦٠ — فالمكتب مايعرفش إن فيه نقص ٤٠، والرقم اللي وصله مش
      // احتياجه، ده الرصيد. المعلومة الغلط في المكان الغلط بتخبّي الطلب الحقيقي.
      capToAvailable: false,
      showAvailable: false,
      showPrice: false,
      // مالهاش أثر هنا: `items0` اتبعتت، فالمنتقي مابيروحش للكتالوج أصلاً.
      fromFullCatalog: false,
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
    // «من» مقفول على مخزن المندوب، فاللي ممكن يكون ناقص حاجة من اتنين: إنه ماسحبش
    // البيانات (فمخزنه مش معروف على الجهاز)، أو إنه ماختارش الوجهة. الرسالتين
    // مختلفتين لأن الحل مختلف — واحدة بتتصلّح بمزامنة والتانية بضغطة.
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
          // اترفع وهو بيعدّل. التعديل مابيتكتبش فوق طلب وصل المكتب — اللي بيراجعه
          // هناك بيبقى بيبص على محتوى تاني غير اللي على الجهاز.
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

  /// **الرسالة بتطلع عايمة فوق، مش ملزوقة في آخر الشاشة.**
  ///
  /// الشكل الافتراضي بيلزقها في آخر الشاشة ورا شريط التنقل بتاع أندرويد، فاللي بيقرا
  /// بيشوف نص مقصوص ومابيعرفش حصل إيه — وهي الرسالة الوحيدة اللي بتقوله ليه الشاشة
  /// مش شغّالة. والمدة أطول من الافتراضي لأن دي جملة تتقرا مش تأكيد ضغطة.
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
          // **التاريخ أول حاجة — زي كل مستند في النظام.**
          //
          // اليوم اللي البضاعة اتحركت فيه حقيقة عن البضاعة، مش عن إمتى المندوب فتح
          // الشاشة. والطلب اللي بيتكتب الصبح على حاجة خرجت امبارح كان بيتقيّد على
          // النهارده، فالمخزون بيقول إن الحركة حصلت في يوم ما حصلتش فيه.
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
          // **«إلى» هي المقفولة، مش «من».**
          //
          // ده **طلب** مش إذن صرف: المندوب بيطلب بضاعة **تيجي له** — من المخزن
          // الرئيسي أو من عربية مندوب تاني — والمسؤول هو اللي بيعتمد وبيصرف.
          // فالوجهة دايماً عربيته هو، والمصدر هو السؤال الحقيقي.
          //
          // (كانت مقفولة على «من» بالغلط: ده شكل إذن الصرف اللي المكتب بيكتبه،
          // مش شكل الطلب اللي المندوب بيكتبه.)
          DropdownButtonFormField<String>(
            initialValue: _source,
            decoration: const InputDecoration(
              labelText: 'من',
              border: OutlineInputBorder(),
            ),
            // مكان المندوب نفسه مش في القايمة: طلب من مخزنه لمخزنه مالوش معنى،
            // والسيرفر بيرفضه — فمافيش داعي يبقى قدامه أصلاً.
            items: _otherPlaces,
            onChanged: (v) => setState(() => _source = v),
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
            for (final l in _lines)
              Card(
                child: ListTile(
                  title: Text(l.item.name),
                  subtitle: Text('المتاح عندك: ${l.item.onHand}'),
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
