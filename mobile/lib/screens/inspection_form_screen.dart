import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;
import 'package:uuid/uuid.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'item_picker_screen.dart';

/// The inspection entry form — the heart of the app. Saves locally (offline-first);
/// sync to the server happens later from the sync screen.
class InspectionFormScreen extends StatefulWidget {
  final String visitKind; // technician | regular
  const InspectionFormScreen({super.key, required this.visitKind});

  @override
  State<InspectionFormScreen> createState() => _InspectionFormScreenState();
}

class _InspectionFormScreenState extends State<InspectionFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _ownerName = TextEditingController();
  final _ownerPhone = TextEditingController();
  final _nationalId = TextEditingController();
  final _ownerAddress = TextEditingController();
  final _floorNumber = TextEditingController();
  final _technicianName = TextEditingController();
  final _technicianPhone = TextEditingController();
  final _purchaseShop = TextEditingController();
  final _visitDetails = TextEditingController();

  DateTime _date = DateTime.now();
  int? _selectedCustomerId; // set when the owner name is picked from an existing customer
  String? _description;
  String? _inspectionType;
  List<LookupOption> _descriptions = [];
  List<LookupOption> _types = [];
  final List<InspectionLine> _lines = [];
  bool _saving = false;

  bool get _isTechnician => widget.visitKind == 'technician';

  @override
  void initState() {
    super.initState();
    _loadLookups();
  }

  Future<void> _loadLookups() async {
    final d = await LocalDb.instance.lookups('inspection_description');
    final t = await LocalDb.instance.lookups('inspection_type');
    if (mounted) {
      setState(() {
        _descriptions = d;
        _types = t;
      });
    }
  }

  double get _totalPoints =>
      double.parse(_lines.fold<double>(0, (s, l) => s + l.total).toStringAsFixed(3));

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
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final l in _lines)
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(l.itemName),
                          subtitle: Text(
                              'الكمية: ${_fmt(l.quantity)} × ${_fmt(l.points)} نقطة'),
                          trailing: Text(_fmt(l.total),
                              style: const TextStyle(
                                  fontWeight: FontWeight.w700, fontSize: 15)),
                        ),
                    ],
                  ),
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

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    final insp = Inspection(
      clientUuid: const Uuid().v4(),
      visitKind: widget.visitKind,
      inspectionDate: intl.DateFormat('yyyy-MM-dd').format(_date),
      ownerName: _ownerName.text.trim(),
      ownerPhone: _nullable(_ownerPhone),
      nationalId: _nullable(_nationalId),
      ownerAddress: _nullable(_ownerAddress),
      floorNumber: _nullable(_floorNumber),
      description: _description,
      inspectionType: _inspectionType,
      technicianName: _nullable(_technicianName),
      technicianPhone: _nullable(_technicianPhone),
      purchaseShop: _nullable(_purchaseShop),
      visitDetails: _nullable(_visitDetails),
      customerId: _selectedCustomerId,
      lines: _lines,
    );
    await LocalDb.instance.saveInspection(insp);
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('تم حفظ المعاينة على الجهاز ✔ — هتترفع مع أول مزامنة')));
    Navigator.pop(context);
  }

  String? _nullable(TextEditingController c) =>
      c.text.trim().isEmpty ? null : c.text.trim();

  static String _fmt(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isTechnician ? 'معاينة فنيين' : 'زيارة عادية'),
        actions: [
          IconButton(
            onPressed: _showCart,
            icon: Badge(
              isLabelVisible: _lines.isNotEmpty,
              label: Text('${_lines.length}'),
              child: const Icon(Icons.shopping_cart_outlined),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _section('بيانات الزيارة', Icons.event_note, [
              InkWell(
                onTap: _pickDate,
                child: InputDecorator(
                  decoration: const InputDecoration(
                      labelText: 'التاريخ', prefixIcon: Icon(Icons.calendar_today)),
                  child: Text(intl.DateFormat('yyyy/MM/dd').format(_date)),
                ),
              ),
            ]),
            _section('بيانات المالك', Icons.person_outline, [
              // Type the name: existing customers appear as suggestions; picking one auto-fills
              // his phone/address and links the record. A brand-new name is typed freely.
              Autocomplete<CustomerRef>(
                displayStringForOption: (c) => c.name,
                optionsBuilder: (value) async {
                  final q = value.text.trim();
                  if (q.length < 2) return const Iterable<CustomerRef>.empty();
                  return LocalDb.instance.customers(query: q, limit: 8);
                },
                onSelected: (c) {
                  _ownerName.text = c.name;
                  _selectedCustomerId = c.id;
                  if ((c.phone ?? '').isNotEmpty) _ownerPhone.text = c.phone!;
                  if ((c.address ?? '').isNotEmpty) _ownerAddress.text = c.address!;
                  setState(() {});
                },
                fieldViewBuilder: (context, controller, focusNode, onSubmit) {
                  // Keep our controller in sync so save() and validation see the text.
                  controller.text = _ownerName.text;
                  controller.selection = TextSelection.collapsed(offset: controller.text.length);
                  return TextFormField(
                    controller: controller,
                    focusNode: focusNode,
                    onChanged: (v) {
                      _ownerName.text = v;
                      _selectedCustomerId = null; // typing a new/edited name unlinks
                    },
                    decoration: const InputDecoration(
                      labelText: 'اسم صاحب الشقة *',
                      prefixIcon: Icon(Icons.search),
                      helperText: 'اكتب الاسم — لو عميل موجود هيظهر لتختاره وتتملأ بياناته',
                    ),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'الاسم مطلوب' : null,
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
                              subtitle: (o.phone ?? '').isEmpty ? null : Text(o.phone!),
                              onTap: () => onSelected(o),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              TextFormField(
                controller: _ownerPhone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'تليفون المالك'),
              ),
              TextFormField(
                controller: _nationalId,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'رقم البطاقة'),
              ),
              TextFormField(
                controller: _ownerAddress,
                decoration: const InputDecoration(labelText: 'عنوان المالك'),
              ),
              TextFormField(
                controller: _floorNumber,
                decoration: const InputDecoration(labelText: 'رقم الدور'),
              ),
            ]),
            _section('تفاصيل المعاينة', Icons.checklist, [
              DropdownButtonFormField<String>(
                value: _description,
                decoration: const InputDecoration(labelText: 'توصيف المعاينة'),
                items: [
                  for (final o in _descriptions)
                    DropdownMenuItem(value: o.value, child: Text(o.label)),
                ],
                onChanged: (v) => setState(() => _description = v),
              ),
              DropdownButtonFormField<String>(
                value: _inspectionType,
                decoration: const InputDecoration(labelText: 'نوع المعاينة'),
                items: [
                  for (final o in _types)
                    DropdownMenuItem(value: o.value, child: Text(o.label)),
                ],
                onChanged: (v) => setState(() => _inspectionType = v),
              ),
            ]),
            if (_isTechnician)
              _section('بيانات الفني', Icons.engineering, [
                TextFormField(
                  controller: _technicianName,
                  decoration: const InputDecoration(labelText: 'اسم الفني'),
                ),
                TextFormField(
                  controller: _technicianPhone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'تليفون الفني'),
                ),
              ]),
            _section('معلومات إضافية', Icons.notes, [
              TextFormField(
                controller: _purchaseShop,
                decoration: const InputDecoration(labelText: 'محل الشراء'),
              ),
              TextFormField(
                controller: _visitDetails,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'تفاصيل الزيارة'),
              ),
            ]),
            _itemsSection(),
            const SizedBox(height: 90),
          ],
        ),
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
                  label: const Text('حفظ المعاينة'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

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
            if (_lines.isNotEmpty) const SizedBox(height: 8),
            for (var i = 0; i < _lines.length; i++)
              Dismissible(
                key: ValueKey('${_lines[i].itemName}-$i'),
                direction: DismissDirection.endToStart,
                background: Container(
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  color: AppColors.danger,
                  child: const Icon(Icons.delete, color: Colors.white),
                ),
                onDismissed: (_) => setState(() => _lines.removeAt(i)),
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(_lines[i].itemName),
                  subtitle:
                      Text('${_fmt(_lines[i].quantity)} × ${_fmt(_lines[i].points)} نقطة'),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_fmt(_lines[i].total),
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 15)),
                      IconButton(
                        icon: const Icon(Icons.edit_outlined, size: 20),
                        onPressed: () => _editLine(i),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _editLine(int index) async {
    final line = _lines[index];
    final qty = TextEditingController(text: _fmt(line.quantity));
    final updated = await showDialog<double>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: Text(line.itemName),
          content: TextField(
            controller: qty,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'الكمية'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () => Navigator.pop(c, double.tryParse(qty.text)),
              child: const Text('تم'),
            ),
          ],
        ),
      ),
    );
    if (updated != null && updated > 0) {
      setState(() => _lines[index].quantity = updated);
    }
  }

  Widget _section(String title, IconData icon, List<Widget> children) {
    return Card(
      margin: const EdgeInsets.only(top: 6, bottom: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(icon, color: AppColors.primary),
              const SizedBox(width: 8),
              Text(title,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 4),
            for (final c in children)
              Padding(padding: const EdgeInsets.only(top: 10), child: c),
          ],
        ),
      ),
    );
  }
}
