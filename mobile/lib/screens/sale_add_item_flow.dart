import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/arabic_sort.dart';
import '../models/models.dart';
import '../widgets/item_multi_picker.dart';

class SaleAddItemFlow {
  const SaleAddItemFlow._();

  static Future<void> show(
    BuildContext context, {
    required Map<int, double> alreadyOnInvoice,
    required String? priceTier,
    required void Function(SaleItem item, double quantity) onAdd,
    bool capToAvailable = true,
    bool showAvailable = true,
    bool showPrice = true,
    bool showNetPrice = true,
    List<SaleItem>? source,
    int? exceptInvoiceLocalId,
  }) async {
    final items = source ?? await LocalDb.instance.saleItems();
    sortByName<SaleItem>(items, (i) => i.name);
    final free = await LocalDb.instance
        .availableForSaleAll(exceptInvoiceLocalId: exceptInvoiceLocalId);
    if (!context.mounted) return;

    if (items.isEmpty) {
      await showDialog<void>(
        context: context,
        builder: (dctx) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text('لم تُحمَّل الأصناف على الجهاز بعد'),
            content: Text(source == null
                ? 'نفّذ «مزامنة البيانات» من القائمة لتحميل الأصناف بأرصدة سيارتك وأسعارها.'
                    '\n\n'
                    'إذا تمت المزامنة وظلت القائمة فارغة، فليس لديك مخزن أو عهدة مسجّلة — '
                    'تواصل مع المخزن.'
                : 'لا توجد أصناف لهذا المخزن على الجهاز.'
                    '\n\n'
                    'نفّذ «مزامنة البيانات» لتحميل أصناف المخازن، وإذا ظلت القائمة فارغة '
                    'بعد المزامنة فلا يوجد رصيد في هذا المخزن.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(dctx),
                  child: const Text('حسناً')),
            ],
          ),
        ),
      );
      return;
    }

    final byId = {for (final it in items) it.itemId: it};
    final entries = <PickerEntry>[
      for (final it in items)
        _entryOf(it, free, alreadyOnInvoice, priceTier,
            capToAvailable: capToAvailable,
            showAvailable: showAvailable,
            showPrice: showPrice,
            showNetPrice: showNetPrice),
    ];
    final picked = await showItemMultiPicker(
      context,
      entries: entries,
      title: 'اختيار الأصناف',
      confirmLabel: 'إضافة',
      memoryKey: 'sale:${source == null ? 'own' : 'other'}',
      emptyMessage: 'لا توجد أصناف',
    );
    for (final p in picked) {
      final it = byId[p.key];
      if (it != null) onAdd(it, p.quantity);
    }
  }
}

PickerEntry _entryOf(
  SaleItem it,
  Map<int, double> free,
  Map<int, double> onInvoice,
  String? priceTier, {
  required bool capToAvailable,
  required bool showAvailable,
  required bool showPrice,
  required bool showNetPrice,
}) {
  final already = onInvoice[it.itemId] ?? 0;
  final avail = (free[it.itemId] ?? 0) - already;
  final out = capToAvailable && avail <= 0;
  final parts = <String>[
    if (showAvailable && avail > 0) 'المتاح ${_fmt(avail)}',
    if (showPrice)
      showNetPrice
          ? '${_money(it.netPriceFor(priceTier))}'
              '${it.defaultDiscountPct > 0 ? ' (بعد خصم ${_fmt(it.defaultDiscountPct)}%)' : ''}'
          : _money(it.priceFor(priceTier)),
  ];
  return PickerEntry(
    key: it.itemId,
    name: it.name,
    category: it.category,
    unit: it.unit,
    info: parts.isEmpty ? null : parts.join(' · '),
    note: already > 0 ? 'في المستند ${_fmt(already)}' : null,
    max: capToAvailable ? (avail > 0 ? avail : 0) : null,
    disabledReason: out ? 'نفد من السيارة' : null,
  );
}

String _fmt(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v.toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

String _money(double v) => v.toStringAsFixed(2);
