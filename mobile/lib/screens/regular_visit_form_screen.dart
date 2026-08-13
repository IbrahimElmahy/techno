import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;
import 'package:uuid/uuid.dart';

import '../widgets/attachments_field.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// «الزيارة العادية» — تسجيل زيارة، مش حدث نقاط.
///
/// Date, customer, what happened, and photographs. No items and no points: those belong to
/// «معاينة فنيين», and having them on both screens meant a rep could record the same points twice
/// under two different kinds of visit.
class RegularVisitFormScreen extends StatefulWidget {
  const RegularVisitFormScreen({super.key});

  @override
  State<RegularVisitFormScreen> createState() => _RegularVisitFormScreenState();
}

class _RegularVisitFormScreenState extends State<RegularVisitFormScreen> {
  /// رقم الزيارة اتحدد من أول ما الشاشة فتحت.
  ///
  /// The attachments are keyed by it, and they are picked BEFORE the visit is saved — so the name
  /// has to exist from the start rather than being minted at save time.
  final String _uuid = const Uuid().v4();
  final List<AttachmentRef> _attachments = [];

  final _visitDetails = TextEditingController();
  final _customerName = TextEditingController(); // free text: pick an existing one OR type a new
  DateTime _date = DateTime.now();
  int? _customerId; // set only when an existing customer is picked
  bool _saving = false;

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _date = picked);
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
      clientUuid: _uuid,
      visitKind: 'regular',
      inspectionDate: intl.DateFormat('yyyy-MM-dd').format(_date),
      ownerName: name,
      customerId: _customerId, // null for a new name typed freely
      visitDetails: _visitDetails.text.trim().isEmpty ? null : _visitDetails.text.trim(),
      // زيارة عادية مالهاش أصناف ولا نقاط — دي معاينة الفنيين.
      lines: const [],
    );
    await LocalDb.instance.saveInspection(insp);
    for (final a in _attachments) {
      await LocalDb.instance.addAttachment(
        inspectionUuid: _uuid,
        path: a.path,
        name: a.name,
        kind: a.kind,
        bytes: a.bytes,
      );
    }
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
                  const Divider(height: 26),
                  AttachmentsField(
                    items: _attachments,
                    onAdd: (a) => setState(() => _attachments.add(a)),
                    onRemove: (a) => setState(() => _attachments.remove(a)),
                  ),
                ],
              ),
            ),
          ),
          // قسم الأصناف اتشال: «زيارة عادية» تسجيل زيارة مش حدث نقاط. الأصناف والنقاط مكانها
          // «معاينة فنيين».
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


}
