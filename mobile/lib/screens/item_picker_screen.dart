import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

class AddItemFlow {
  static Future<void> show(
    BuildContext context,
    void Function(CatalogItem item, double quantity) onAdd,
  ) async {
    final items = await LocalDb.instance.itemTypes();
    if (!context.mounted) return;

    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('مفيش أصناف محمّلة — اعمل "مزامنة البيانات" الأول')),
      );
      return;
    }

    _showDialogLoop(context, items, onAdd);
  }

  static void _showDialogLoop(
    BuildContext context,
    List<CatalogItem> items,
    void Function(CatalogItem item, double quantity) onAdd,
  ) {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => _AddItemModalDialog(
        items: items,
        onNext: (item, qty) {
          onAdd(item, qty);
          Navigator.of(ctx).pop();
          // Loop to open next item popup automatically
          _showDialogLoop(context, items, onAdd);
        },
        onDone: (item, qty) {
          onAdd(item, qty);
          Navigator.of(ctx).pop();
        },
      ),
    );
  }
}

class _AddItemModalDialog extends StatefulWidget {
  final List<CatalogItem> items;
  final Function(CatalogItem item, double qty) onNext;
  final Function(CatalogItem item, double qty) onDone;

  const _AddItemModalDialog({
    required this.items,
    required this.onNext,
    required this.onDone,
  });

  @override
  State<_AddItemModalDialog> createState() => _AddItemModalDialogState();
}

class _AddItemModalDialogState extends State<_AddItemModalDialog> {
  late CatalogItem _selectedItem;
  final _qtyCtrl = TextEditingController(text: '');
  final _searchCtrl = TextEditingController();
  List<CatalogItem> _filteredItems = [];

  @override
  void initState() {
    super.initState();
    _filteredItems = widget.items;
    _selectedItem = widget.items.first;
  }

  void _filter(String query) {
    setState(() {
      if (query.trim().isEmpty) {
        _filteredItems = widget.items;
      } else {
        _filteredItems = widget.items
            .where((i) => i.name.toLowerCase().contains(query.toLowerCase()))
            .toList();
      }
      if (_filteredItems.isNotEmpty && !_filteredItems.contains(_selectedItem)) {
        _selectedItem = _filteredItems.first;
      }
    });
  }

  double get _qty => double.tryParse(_qtyCtrl.text.trim()) ?? 0;

  @override
  Widget build(BuildContext context) {
    final double calculatedPoints = _selectedItem.points * _qty;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 440),
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Modal Header with X Close Icon
              Row(
                children: [
                  const Text(
                    'إضافة مادة جديدة',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.ink),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close, color: Color(0xFF6B7280)),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Search Box
              TextField(
                controller: _searchCtrl,
                onChanged: _filter,
                decoration: const InputDecoration(
                  hintText: 'اكتب اسم أو كود المنتج...',
                  prefixIcon: Icon(Icons.search, color: Color(0xFF9CA3AF)),
                ),
              ),
              const SizedBox(height: 10),

              // Quick Filter Chips (Matching Image 5 mockup)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final item in widget.items.take(4))
                      Padding(
                        padding: const EdgeInsetsDirectional.only(start: 6),
                        child: ActionChip(
                          label: Text(item.name),
                          backgroundColor: _selectedItem.id == item.id
                              ? AppColors.primary.withOpacity(0.15)
                              : const Color(0xFFF3F4F6),
                          labelStyle: TextStyle(
                            color: _selectedItem.id == item.id ? AppColors.primary : const Color(0xFF374151),
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                          onPressed: () => setState(() => _selectedItem = item),
                        ),
                      ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Product Dropdown Selection
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAFAFA),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE5E7EB)),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<CatalogItem>(
                    value: _filteredItems.contains(_selectedItem) ? _selectedItem : null,
                    isExpanded: true,
                    items: [
                      for (final item in _filteredItems)
                        DropdownMenuItem(
                          value: item,
                          child: Text(
                            '${item.name} (${item.points.toInt()} نقطة)',
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                          ),
                        ),
                    ],
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedItem = val);
                    },
                  ),
                ),
              ),

              const SizedBox(height: 16),

              // Quantity Counter (- / input / +)
              const Text(
                'الكمية',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF6B7280)),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  InkWell(
                    onTap: () {
                      final q = (_qty - 1).clamp(0, 9999).toInt();
                      _qtyCtrl.text = q > 0 ? q.toString() : '';
                      setState(() {});
                    },
                    child: Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.remove, color: Color(0xFF374151)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _qtyCtrl,
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        hintText: '0',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  InkWell(
                    onTap: () {
                      final q = (_qty + 1).toInt();
                      _qtyCtrl.text = q.toString();
                      setState(() {});
                    },
                    child: Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.add, color: Color(0xFF374151)),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 14),

              // Calculated Points Box
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAFAFA),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFE5E7EB)),
                ),
                child: Row(
                  children: [
                    const Text(
                      'النقاط المحتسبة:',
                      style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
                    ),
                    const Spacer(),
                    Text(
                      calculatedPoints > 0 ? '${calculatedPoints.toInt()} نقطة' : '--',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppColors.primary),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Action Buttons: Next (Green Primary) & Done (Outlined)
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        minimumSize: const Size.fromHeight(48),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () {
                        if (_qty <= 0) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('يرجى كتابة كمية أكبر من صفر')),
                          );
                          return;
                        }
                        widget.onNext(_selectedItem, _qty);
                      },
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.arrow_forward, size: 18),
                          SizedBox(width: 6),
                          Text('التالي', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        side: const BorderSide(color: Color(0xFF9CA3AF)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () {
                        if (_qty <= 0) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('يرجى كتابة كمية أكبر من صفر')),
                          );
                          return;
                        }
                        widget.onDone(_selectedItem, _qty);
                      },
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.check, size: 18, color: Color(0xFF374151)),
                          SizedBox(width: 6),
                          Text('تم', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Color(0xFF374151))),
                        ],
                      ),
                    ),
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
