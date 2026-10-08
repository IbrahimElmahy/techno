import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../widgets/item_multi_picker.dart';

class AddItemFlow {
  const AddItemFlow._();

  static Future<void> show(
    BuildContext context,
    void Function(InspectionLine line) onAdd, {
    Map<String, double> alreadyAdded = const {},
  }) async {
    final items = await LocalDb.instance.itemTypes();
    if (!context.mounted) return;
    final byId = {for (final it in items) it.id: it};
    final picked = await showItemMultiPicker(
      context,
      title: 'اختيار أصناف المعاينة',
      confirmLabel: 'إضافة',
      memoryKey: 'inspection',
      emptyMessage: 'لا توجد أصناف على الجهاز — نفّذ «تحديث الأصناف والقوائم».',
      entries: [
        for (final it in items)
          PickerEntry(
            key: it.id,
            name: it.name,
            category: it.category,
            info: '${_fmt(it.points)} نقطة',
            note: (alreadyAdded[it.name] ?? 0) > 0
                ? 'في المعاينة ${_fmt(alreadyAdded[it.name]!)}'
                : null,
          ),
      ],
    );
    for (final p in picked) {
      final it = byId[p.key];
      if (it == null) continue;
      onAdd(InspectionLine(
        itemId: null,
        itemName: it.name,
        quantity: p.quantity,
        points: it.points,
      ));
    }
  }
}

String _fmt(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v.toStringAsFixed(4).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}
