import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;
import 'package:uuid/uuid.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'item_picker_screen.dart';

/// «الزيارة العادية» — أبسط من معاينة الفنيين: مرتبطة بعميل مختار من النظام، وبتسجل
/// تفاصيل الزيارة وأصناف. الكود تلقائي، والحفظ محلي (أوفلاين) زي المعاينات.
class RegularVisitFormScreen extends StatefulWidget {
  const RegularVisitFormScreen({super.key});

  @override
  State<RegularVisitFormScreen> createState() => _RegularVisitFormScreenState();
}

class _RegularVisitFormScreenState extends State<RegularVisitFormScreen> {
  final _visitDetails = TextEditingController();
  final _customerName = TextEditingController(); // free text: pick an existing one OR type a new
  DateTime _date = DateTime.now();
  int? _customerId; // set only when an existing customer is picked
  final List<InspectionLine> _lines = [];
  bool _saving = false;

  double get _totalPoints =>
      double.parse(_lines.fold<double>(0, (s, l) => s + l.total).toStringAsFixed(3));

  static String _fmt(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _addItem() async {
    final line = await Navigator.push<InspectionLine>(
        context, MaterialPageRoute(builder: (_) => const ItemPickerScreen()));
    if (line != null) {
      setState(() {
        final existing = _lines.indexWhere(
            (l) => l.itemId == line.itemId && l.itemName == line.itemName);
        if (existing >= 0) {
          _lines[existing].quantity += line.quantity;
        } else {
          _lines.add(line);
        }
      });
    }
  }

  Future<void> _save() async {
    final name = _customerName.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('اكتب اسم العميل الأول')));
      return;
    }
    setState(() => _saving = true);
    final insp = Inspection(
      clientUuid: const Uuid().v4(),
      visitKind: 'regular',
      inspectionDate: intl.DateFormat('yyyy-MM-dd').format(_date),
      ownerName: name,
      customerId: _customerId, // null for a new name typed freely
      visitDetails: _visitDetails.text.trim().isEmpty ? null : _visitDetails.text.trim(),
      lines: _lines,
    );
    await LocalDb.instance.saveInspection(insp);
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('تم حفظ الزيارة على الجهاز ✔ — هتترفع مع أول مزامنة')));
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('زيارة عادية'),
        actions: [
          IconButton(
            onPressed: () => _showCart(),
            icon: Badge(
              isLabelVisible: _lines.isNotEmpty,
              label: Text('${_lines.length}'),
              child: const Icon(Icons.shopping_cart_outlined),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  _row('الكود', const Text('تلقائي', style: TextStyle(color: Colors.grey))),
                  const Divider(),
                  InkWell(
                    onTap: _pickDate,
                    child: _row(
                      'التاريخ',
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        Text(intl.DateFormat('yyyy/MM/dd').format(_date),
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        const SizedBox(width: 6),
                        const Icon(Icons.calendar_today, size: 18, color: AppColors.primary),
                      ]),
                    ),
                  ),
                  const Divider(),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        Expanded(
                          // Type the customer: existing ones appear as suggestions; a new name
                          // is typed freely and just saved on the visit (no system record).
                          child: Autocomplete<CustomerRef>(
                            displayStringForOption: (c) => c.name,
                            optionsBuilder: (value) async {
                              final q = value.text.trim();
                              if (q.length < 2) {
                                return const Iterable<CustomerRef>.empty();
                              }
                              return LocalDb.instance.customers(query: q, limit: 8);
                            },
                            onSelected: (c) {
                              _customerName.text = c.name;
                              _customerId = c.id;
                              setState(() {});
                            },
                            fieldViewBuilder: (context, controller, focusNode, onSubmit) {
                              controller.text = _customerName.text;
                              controller.selection = TextSelection.collapsed(
                                  offset: controller.text.length);
                              return TextField(
                                controller: controller,
                                focusNode: focusNode,
                                textAlign: TextAlign.right,
                                onChanged: (v) {
                                  _customerName.text = v;
                                  _customerId = null; // typing a new/edited name unlinks
                                },
                                decoration: const InputDecoration(
                                  isDense: true,
                                  border: InputBorder.none,
                                  hintText: 'اكتب اسم العميل',
                                  suffixIcon:
                                      Icon(Icons.search, size: 18, color: AppColors.accent),
                                ),
                              );
                            },
                            optionsViewBuilder: (context, onSelected, options) => Align(
                              alignment: Alignment.topRight,
                              child: Material(
                                elevation: 4,
                                child: SizedBox(
                                  width: MediaQuery.of(context).size.width - 60,
                                  child: ListView(
                                    padding: EdgeInsets.zero,
                                    shrinkWrap: true,
                                    children: [
                                      for (final o in options)
                                        ListTile(
                                          dense: true,
                                          leading: const Icon(Icons.person_outline,
                                              color: AppColors.primary),
                                          title: Text(o.name),
                                          subtitle: (o.phone ?? '').isEmpty
                                              ? null
                                              : Text(o.phone!),
                                          onTap: () => onSelected(o),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Text('العميل',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 6),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('تفاصيل الزيارة',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _visitDetails,
                    maxLines: 5,
                    decoration: const InputDecoration(hintText: 'اكتب تفاصيل الزيارة…'),
                  ),
                ],
              ),
            ),
          ),
          _itemsSection(),
          const SizedBox(height: 90),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          decoration: BoxDecoration(color: Colors.white, boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 8)
          ]),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('إجمالي النقاط',
                        style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                    Text(_fmt(_totalPoints),
                        style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primary)),
                  ],
                ),
              ),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: const Icon(Icons.save_outlined),
                  label: const Text('حفظ الزيارة'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(String label, Widget value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            value,
            Text(label,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );

  Widget _itemsSection() {
    return Card(
      margin: const EdgeInsets.only(top: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.widgets_outlined, color: AppColors.primary),
                const SizedBox(width: 8),
                const Expanded(
                    child: Text('الأصناف',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
                FilledButton.tonalIcon(
                  onPressed: _addItem,
                  icon: const Icon(Icons.add),
                  label: const Text('إضافة صنف'),
                ),
              ],
            ),
            for (var i = 0; i < _lines.length; i++)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(_lines[i].itemName),
                subtitle:
                    Text('${_fmt(_lines[i].quantity)} × ${_fmt(_lines[i].points)} نقطة'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_fmt(_lines[i].total),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    IconButton(
                      icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.danger),
                      onPressed: () => setState(() => _lines.removeAt(i)),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _showCart() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('ملخص الأصناف',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              if (_lines.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: Text('لسه ما اتضافش أصناف')),
                )
              else
                for (final l in _lines)
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(l.itemName),
                    subtitle: Text('الكمية: ${_fmt(l.quantity)} × ${_fmt(l.points)} نقطة'),
                    trailing: Text(_fmt(l.total),
                        style:
                            const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  ),
              const Divider(),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('إجمالي النقاط',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  Text(_fmt(_totalPoints),
                      style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
