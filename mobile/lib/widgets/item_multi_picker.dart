import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/arabic_sort.dart';
import '../theme.dart';

class PickerEntry {
  const PickerEntry({
    required this.key,
    required this.name,
    this.category,
    this.unit,
    this.info,
    this.note,
    this.max,
    this.disabledReason,
  });

  final int key;
  final String name;
  final String? category;
  final String? unit;
  final String? info;
  final String? note;
  final double? max;
  final String? disabledReason;

  bool get disabled => disabledReason != null;
}

class PickedQty {
  const PickedQty(this.key, this.quantity);
  final int key;
  final double quantity;
}

const _noCategory = 'بدون فئة';

String _categoryOf(PickerEntry e) {
  final c = e.category?.trim() ?? '';
  return c.isEmpty ? _noCategory : c;
}

String _fmtQty(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v
      .toStringAsFixed(3)
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
}

double? _parseQty(String raw) {
  final t = asciiDigits(raw.trim()).replaceAll(RegExp('[٫,]'), '.');
  if (t.isEmpty) return null;
  return double.tryParse(t);
}

class _Memory {
  String? category;
  String query = '';
}

final Map<String, _Memory> _memories = {};

Future<List<PickedQty>> showItemMultiPicker(
  BuildContext context, {
  required List<PickerEntry> entries,
  String title = 'اختيار الأصناف',
  String confirmLabel = 'إضافة الأصناف',
  String? memoryKey,
  String emptyMessage = 'لا توجد أصناف',
}) async {
  final picked = await showDialog<List<PickedQty>>(
    context: context,
    builder: (_) => Directionality(
      textDirection: TextDirection.rtl,
      child: _ItemMultiPickerDialog(
        entries: entries,
        title: title,
        confirmLabel: confirmLabel,
        memory: _memories.putIfAbsent(memoryKey ?? title, _Memory.new),
        emptyMessage: emptyMessage,
      ),
    ),
  );
  return picked ?? const [];
}

class _ItemMultiPickerDialog extends StatefulWidget {
  const _ItemMultiPickerDialog({
    required this.entries,
    required this.title,
    required this.confirmLabel,
    required this.memory,
    required this.emptyMessage,
  });

  final List<PickerEntry> entries;
  final String title;
  final String confirmLabel;
  final _Memory memory;
  final String emptyMessage;

  @override
  State<_ItemMultiPickerDialog> createState() => _ItemMultiPickerDialogState();
}

class _ItemMultiPickerDialogState extends State<_ItemMultiPickerDialog> {
  late final TextEditingController _search =
      TextEditingController(text: widget.memory.query);
  final Map<int, TextEditingController> _qtyCtl = {};
  final Map<int, double> _qty = {};
  final List<int> _order = [];
  late final List<PickerEntry> _entries;
  late final List<MapEntry<String, int>> _categories;
  String? _category;
  bool _searchAll = false;

  @override
  void initState() {
    super.initState();
    _entries = [...widget.entries];
    sortByName<PickerEntry>(_entries, (e) => e.name);
    final counts = <String, int>{};
    for (final e in _entries) {
      counts.update(_categoryOf(e), (n) => n + 1, ifAbsent: () => 1);
    }
    _categories = counts.entries.toList()
      ..sort((a, b) {
        if ((a.key == _noCategory) != (b.key == _noCategory)) {
          return a.key == _noCategory ? 1 : -1;
        }
        return compareArabic(a.key, b.key);
      });
    final remembered = widget.memory.category;
    _category = remembered != null && counts.containsKey(remembered) ? remembered : null;
  }

  @override
  void dispose() {
    widget.memory
      ..category = _category
      ..query = '';
    _search.dispose();
    for (final c in _qtyCtl.values) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _hasCategories => _categories.length > 1;

  String get _query => bare(_search.text);

  bool _matches(PickerEntry e) {
    final name = bare(e.name);
    return _query.split(' ').where((w) => w.isNotEmpty).every(name.contains);
  }

  bool _inCategory(PickerEntry e) => _category == null || _categoryOf(e) == _category;

  List<PickerEntry> get _visible {
    final q = _query;
    return [
      for (final e in _entries)
        if ((q.isEmpty || _matches(e)) && (_searchAll && q.isNotEmpty || _inCategory(e))) e
    ];
  }

  int get _elsewhere {
    if (_query.isEmpty || _searchAll || _category == null) return 0;
    var n = 0;
    for (final e in _entries) {
      if (_matches(e) && !_inCategory(e)) n++;
    }
    return n;
  }

  TextEditingController _ctlFor(PickerEntry e) => _qtyCtl.putIfAbsent(
      e.key, () => TextEditingController(text: _qty[e.key] == null ? '' : _fmtQty(_qty[e.key]!)));

  void _setQty(PickerEntry e, double? v) {
    setState(() {
      if (v != null && v > 0) {
        _qty[e.key] = v;
        if (!_order.contains(e.key)) _order.add(e.key);
      } else {
        _qty.remove(e.key);
        _order.remove(e.key);
      }
    });
  }

  void _toggle(PickerEntry e) {
    if (e.disabled) return;
    final ctl = _ctlFor(e);
    if (_qty.containsKey(e.key)) {
      ctl.text = '';
      _setQty(e, null);
    } else {
      ctl.text = '1';
      _setQty(e, 1);
    }
  }

  PickerEntry? _byKey(int key) {
    for (final e in _entries) {
      if (e.key == key) return e;
    }
    return null;
  }

  String? get _problem {
    for (final k in _order) {
      final e = _byKey(k);
      final q = _qty[k] ?? 0;
      if (e?.max != null && q > e!.max! + 0.0001) {
        return 'الكمية المطلوبة من «${e.name}» أكبر من المتاح (${_fmtQty(e.max!)})';
      }
    }
    return null;
  }

  void _confirm() {
    if (_order.isEmpty || _problem != null) return;
    Navigator.pop(context, [
      for (final k in _order)
        if ((_qty[k] ?? 0) > 0) PickedQty(k, _qty[k]!)
    ]);
  }

  void _clearSelection() {
    setState(() {
      for (final k in _order) {
        _qtyCtl[k]?.text = '';
      }
      _qty.clear();
      _order.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final rows = _visible;
    final elsewhere = _elsewhere;
    final size = MediaQuery.of(context).size;
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 18),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: SizedBox(
        width: 560,
        height: size.height,
        child: Column(
          children: [
            _header(),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
              child: TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                onChanged: (_) => setState(() {
                  if (_query.isEmpty) _searchAll = false;
                }),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: _category == null || _searchAll
                      ? 'ابحث باسم الصنف...'
                      : 'ابحث في $_category...',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () => setState(() {
                            _search.clear();
                            _searchAll = false;
                          }),
                        ),
                ),
              ),
            ),
            if (_hasCategories) _categoryBar(),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 2, 16, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text('${rows.length} صنف',
                        style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
                  ),
                  Text('الكمية',
                      style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
                  const SizedBox(width: 26),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: rows.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Text(
                          _query.isNotEmpty ? 'لا يوجد صنف بهذا الاسم' : widget.emptyMessage,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.black54),
                        ),
                      ),
                    )
                  : ListView.separated(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) => _row(rows[i]),
                    ),
            ),
            if (elsewhere > 0)
              SizedBox(
                width: double.infinity,
                child: TextButton.icon(
                  icon: const Icon(Icons.travel_explore, size: 18),
                  onPressed: () => setState(() => _searchAll = true),
                  label: Text(
                    elsewhere == 1
                        ? 'توجد نتيجة واحدة في فئة أخرى — ابحث في كل الأصناف'
                        : 'توجد $elsewhere نتائج في فئات أخرى — ابحث في كل الأصناف',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            _footer(),
          ],
        ),
      ),
    );
  }

  Widget _header() => Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 6, 10),
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: Row(
          children: [
            const Icon(Icons.inventory_2_outlined, color: Colors.white),
            const SizedBox(width: 10),
            Expanded(
              child: Text(widget.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: Colors.white, fontSize: 17, fontWeight: FontWeight.w800)),
            ),
            IconButton(
              tooltip: 'إغلاق',
              icon: const Icon(Icons.close, color: Colors.white),
              onPressed: () => Navigator.pop(context),
            ),
          ],
        ),
      );

  Widget _categoryBar() {
    Widget chip(String? value, String label, int count) {
      final on = _category == value;
      return Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: ChoiceChip(
          label: Text('$label ($count)'),
          selected: on,
          showCheckmark: false,
          selectedColor: AppColors.primary,
          backgroundColor: Colors.white,
          labelStyle: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: on ? Colors.white : AppColors.primary),
          side: BorderSide(color: AppColors.primary.withValues(alpha: 0.25)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          visualDensity: VisualDensity.compact,
          onSelected: (_) => setState(() {
            _category = value;
            _searchAll = false;
          }),
        ),
      );
    }

    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        children: [
          chip(null, 'كل الفئات', _entries.length),
          for (final c in _categories) chip(c.key, c.key, c.value),
        ],
      ),
    );
  }

  Widget _row(PickerEntry e) {
    final selected = _qty.containsKey(e.key);
    final q = _qty[e.key] ?? 0;
    final over = e.max != null && q > e.max! + 0.0001;
    final sub = <String>[
      if (e.disabledReason != null) e.disabledReason! else if (e.info != null) e.info!,
      if (e.note != null) e.note!,
    ];
    return Material(
      color: selected ? AppColors.primary.withValues(alpha: 0.06) : Colors.white,
      child: InkWell(
        onTap: e.disabled ? null : () => _toggle(e),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 6, 12, 6),
          child: Row(
            children: [
              Checkbox(
                value: selected,
                onChanged: e.disabled ? null : (_) => _toggle(e),
                visualDensity: VisualDensity.compact,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(e.name,
                        style: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w700,
                            color: e.disabled ? Colors.black38 : Colors.black87)),
                    if (sub.isNotEmpty)
                      Text(sub.join(' · '),
                          style: TextStyle(
                              fontSize: 12,
                              color: e.disabled || over ? AppColors.danger : Colors.black54)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 84,
                child: TextField(
                  controller: _ctlFor(e),
                  enabled: !e.disabled,
                  textAlign: TextAlign.center,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp('[0-9٠-٩.٫,]')),
                  ],
                  onChanged: (v) => _setQty(e, _parseQty(v)),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'الكمية',
                    hintStyle: const TextStyle(fontSize: 12),
                    suffixText: e.unit,
                    suffixStyle: const TextStyle(fontSize: 10, color: Colors.black45),
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
                    enabledBorder: over
                        ? OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: AppColors.danger))
                        : null,
                    focusedBorder: over
                        ? OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide:
                                const BorderSide(color: AppColors.danger, width: 1.6))
                        : null,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _footer() {
    final problem = _problem;
    final n = _order.length;
    return Material(
      elevation: 6,
      color: Colors.white,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (problem != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(problem,
                      style: const TextStyle(
                          color: AppColors.danger,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700)),
                ),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(n == 0 ? 'لم يُحدَّد صنف' : 'المحدد: $n صنف',
                            style: const TextStyle(
                                fontWeight: FontWeight.w800, fontSize: 14)),
                        if (n > 0)
                          InkWell(
                            onTap: _clearSelection,
                            child: const Padding(
                              padding: EdgeInsets.only(top: 2),
                              child: Text('إلغاء التحديد',
                                  style: TextStyle(
                                      fontSize: 12.5,
                                      color: AppColors.danger,
                                      fontWeight: FontWeight.w600)),
                            ),
                          ),
                      ],
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: n == 0 || problem != null ? null : _confirm,
                    icon: const Icon(Icons.check),
                    label: Text(n == 0 ? widget.confirmLabel : '${widget.confirmLabel} ($n)'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
