import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;
import 'package:uuid/uuid.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'item_picker_screen.dart';

class InspectionFormScreen extends StatefulWidget {
  final String visitKind;
  const InspectionFormScreen(
      {super.key, required this.visitKind, this.existing, this.draft});

  final Inspection? existing;

  final Inspection? draft;

  @override
  State<InspectionFormScreen> createState() => _InspectionFormScreenState();
}

const Object _kDelete = Object();

const String kOwnerCustomerType = 'owner';

const String kMarmaDescription = 'مرمه';
const String kMarmaVisitType = 'مرمة';
const String kPreviewVisitType = 'معاينة';

String _fold(String? s) => (s ?? '')
    .replaceAll(RegExp('[أإآٱ]'), 'ا')
    .replaceAll('ة', 'ه')
    .replaceAll('ى', 'ي')
    .replaceAll(RegExp(r'\s+'), '')
    .trim();

const List<String> kTechnicianCustomerTypes = ['plumber'];
const List<String> kShopCustomerTypes = [
  'trader', 'showroom', 'company', 'establishment',
];

class _InspectionFormScreenState extends State<InspectionFormScreen>
    with WidgetsBindingObserver {
  final _formKey = GlobalKey<FormState>();
  final _ownerName = TextEditingController();
  final _ownerPhone = TextEditingController();
  final _nationalId = TextEditingController();
  final _ownerAddress = TextEditingController();
  final _floorNumber = TextEditingController();
  final _technicianName = TextEditingController();
  final _technicianPhone = TextEditingController();
  final _purchaseShop = TextEditingController();
  int? _merchantCustomerId;
  final _purchaseShopPhone = TextEditingController();
  final _visitDetails = TextEditingController();

  DateTime _date = DateTime.now();
  int? _selectedCustomerId;
  String? _description;
  String? _inspectionType;
  List<LookupOption> _descriptions = [];
  List<LookupOption> _types = [];
  String? _visitType = 'معاينة';
  List<LookupOption> _visitTypes = [];
  final List<InspectionLine> _lines = [];
  bool _saving = false;

  bool get _isTechnician => widget.visitKind == 'technician';

  bool get _isEdit => widget.existing != null;

  late final String _uuid;

  bool get _draftable => !_isEdit;

  bool _submitted = false;
  bool _ready = false;
  Timer? _draftTimer;
  ScaffoldMessengerState? _messenger;

  List<TextEditingController> get _controllers => [
        _ownerName, _ownerPhone, _nationalId, _ownerAddress, _floorNumber,
        _technicianName, _technicianPhone, _purchaseShop, _purchaseShopPhone,
        _visitDetails,
      ];

  @override
  void initState() {
    super.initState();
    _loadLookups();
    final e = widget.existing ?? widget.draft;
    _uuid = e?.clientUuid.isNotEmpty == true ? e!.clientUuid : const Uuid().v4();
    _prefill(e);
    for (final c in _controllers) {
      c.addListener(_scheduleDraft);
    }
    WidgetsBinding.instance.addObserver(this);
    _ready = true;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _messenger = ScaffoldMessenger.maybeOf(context);
  }

  @override
  void setState(VoidCallback fn) {
    super.setState(fn);
    _scheduleDraft();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.detached) {
      _flushDraft();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _draftTimer?.cancel();
    final kept = _flushDraft();
    final messenger = _messenger;
    if (kept && messenger != null) {
      Future(() => messenger.showSnackBar(const SnackBar(
          content: Text('حُفظت المعاينة مسودةً، ويمكنك استكمالها من «مسودات المعاينات».'))));
    }
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _hasContent =>
      _controllers.any((c) => c.text.trim().isNotEmpty) ||
      _lines.isNotEmpty ||
      _description != null ||
      _inspectionType != null;

  void _scheduleDraft() {
    if (!_ready || !_draftable || _submitted) return;
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 700), _flushDraft);
  }

  bool _flushDraft() {
    _draftTimer?.cancel();
    if (!_draftable || _submitted) return false;
    if (!_hasContent) {
      LocalDb.instance.deleteInspectionDraft(_uuid);
      return false;
    }
    LocalDb.instance.saveInspectionDraft(_uuid, _current().toDraft());
    return true;
  }

  Future<void> _discardDraft() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('حذف المسودة'),
          content: const Text('هل تريد حذف هذه المعاينة نهائياً دون حفظ؟'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(c, true),
              child: const Text('حذف'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    _submitted = true;
    _draftTimer?.cancel();
    await LocalDb.instance.deleteInspectionDraft(_uuid);
    if (mounted) Navigator.pop(context);
  }

  void _prefill(Inspection? e) {
    if (e == null) return;
    _date = DateTime.tryParse(e.inspectionDate) ?? _date;
    _ownerName.text = e.ownerName;
    _ownerPhone.text = e.ownerPhone ?? '';
    _nationalId.text = e.nationalId ?? '';
    _ownerAddress.text = e.ownerAddress ?? '';
    _floorNumber.text = e.floorNumber ?? '';
    _description = e.description;
    _inspectionType = e.inspectionType;
    _visitType = e.visitType ?? 'معاينة';
    _technicianName.text = e.technicianName ?? '';
    _technicianPhone.text = e.technicianPhone ?? '';
    _purchaseShop.text = e.purchaseShop ?? '';
    _merchantCustomerId = e.merchantCustomerId;
    _purchaseShopPhone.text = e.purchaseShopPhone ?? '';
    _visitDetails.text = e.visitDetails ?? '';
    _selectedCustomerId = e.customerId;
    _lines.addAll(e.lines);
  }

  Future<void> _loadLookups() async {
    final d = await LocalDb.instance.lookups('inspection_description');
    final t = await LocalDb.instance.lookups('inspection_type');
    final v = await LocalDb.instance.lookups('visit_type');
    if (mounted) {
      setState(() {
        _descriptions = d;
        _types = t;
        _visitTypes = v;
        if (_visitTypes.isNotEmpty &&
            !_visitTypes.any((o) => o.value == _visitType)) {
          _visitType = _visitTypes.first.value;
        }
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
    final already = <String, double>{};
    for (final l in _lines) {
      already.update(l.itemName, (q) => q + l.quantity, ifAbsent: () => l.quantity);
    }
    await AddItemFlow.show(context, alreadyAdded: already, (line) {
      setState(() {
        final existing = _lines.indexWhere((l) => l.itemName == line.itemName);
        if (existing >= 0) {
          _lines[existing].quantity += line.quantity;
        } else {
          _lines.add(line);
        }
      });
    });
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
                  child: Center(child: Text('لم تُضف أصناف بعد')),
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

  Inspection _current() => Inspection(
      clientUuid: _uuid,
      visitKind: widget.visitKind,
      inspectionDate: intl.DateFormat('yyyy-MM-dd').format(_date),
      ownerName: _ownerName.text.trim(),
      ownerPhone: _nullable(_ownerPhone),
      nationalId: _nullable(_nationalId),
      ownerAddress: _nullable(_ownerAddress),
      floorNumber: _nullable(_floorNumber),
      description: _description,
      inspectionType: _inspectionType,
      visitType: _visitType,
      technicianName: _nullable(_technicianName),
      technicianPhone: _nullable(_technicianPhone),
      purchaseShop: _nullable(_purchaseShop),
      merchantCustomerId: _merchantCustomerId,
      purchaseShopPhone: _nullable(_purchaseShopPhone),
      visitDetails: _nullable(_visitDetails),
      customerId: _selectedCustomerId,
      lines: _lines,
    );

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    final insp = _current();
    if (_isEdit && widget.existing!.localId != null) {
      await LocalDb.instance.deleteInspection(widget.existing!.localId!);
    }
    await LocalDb.instance.saveInspection(insp);
    _submitted = true;
    _draftTimer?.cancel();
    await LocalDb.instance.deleteInspectionDraft(_uuid);
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(_isEdit
            ? 'تم تعديل المعاينة ✔ — ستُرفع مع أول مزامنة'
            : 'تم حفظ المعاينة على الجهاز ✔ — ستُرفع مع أول مزامنة')));
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
        title: Text('${_isEdit ? 'تعديل ' : ''}${_isTechnician ? 'معاينة فنيين' : 'زيارة عادية'}'),
        actions: [
          if (_draftable && widget.draft != null)
            IconButton(
              tooltip: 'حذف المسودة',
              onPressed: _discardDraft,
              icon: const Icon(Icons.delete_outline),
            ),
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
              _nameSearch(
                label: 'اسم صاحب الشقة *',
                controller: _ownerName,
                customerTypes: const [kOwnerCustomerType],
                onPick: (c) {
                  _selectedCustomerId = c.id;
                  if ((c.phone ?? '').isNotEmpty) _ownerPhone.text = c.phone!;
                  if ((c.address ?? '').isNotEmpty) _ownerAddress.text = c.address!;
                },
                onType: () => _selectedCustomerId = null,
                validator: (v) => (v == null || v.trim().isEmpty) ? 'الاسم مطلوب' : null,
              ),
              TextFormField(
                controller: _ownerPhone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'هاتف المالك'),
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
                initialValue: _description,
                decoration: const InputDecoration(labelText: 'توصيف المعاينة'),
                items: [
                  for (final o in _descriptions)
                    DropdownMenuItem(value: o.value, child: Text(o.label)),
                ],
                onChanged: (v) => setState(() {
                  _description = v;
                  _visitType = _fold(v) == _fold(kMarmaDescription)
                      ? kMarmaVisitType
                      : kPreviewVisitType;
                }),
              ),
              DropdownButtonFormField<String>(
                initialValue: _inspectionType,
                decoration: const InputDecoration(labelText: 'نوع المعاينة'),
                items: [
                  for (final o in _types)
                    DropdownMenuItem(value: o.value, child: Text(o.label)),
                ],
                onChanged: (v) => setState(() => _inspectionType = v),
              ),
              DropdownButtonFormField<String>(
                key: ValueKey('visit-type-$_visitType'),
                initialValue: _visitType,
                decoration: const InputDecoration(labelText: 'نوع الزيارة'),
                items: [
                  for (final o in _visitTypes)
                    DropdownMenuItem(value: o.value, child: Text(o.label)),
                ],
                onChanged: (v) => setState(() => _visitType = v),
              ),
            ]),
            if (_isTechnician)
              _section('بيانات الفني', Icons.engineering, [
                _nameSearch(
                  label: 'اسم الفني',
                  controller: _technicianName,
                  leading: Icons.engineering,
                  customerTypes: kTechnicianCustomerTypes,
                  onPick: (c) {
                    if ((c.phone ?? '').isNotEmpty) _technicianPhone.text = c.phone!;
                  },
                  onType: () {},
                ),
                TextFormField(
                  controller: _technicianPhone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'هاتف الفني'),
                ),
              ]),
            _section('معلومات إضافية', Icons.notes, [
              _nameSearch(
                label: 'محل الشراء',
                controller: _purchaseShop,
                leading: Icons.store_outlined,
                customerTypes: kShopCustomerTypes,
                onPick: (c) {
                  _merchantCustomerId = c.id;
                  if ((c.phone ?? '').isNotEmpty) _purchaseShopPhone.text = c.phone!;
                },
                onType: () => _merchantCustomerId = null,
              ),
              TextFormField(
                controller: _purchaseShopPhone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'هاتف محل الشراء'),
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
            BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 8)
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
                  onTap: () => _editLine(i),
                  title: Text(_lines[i].itemName),
                  subtitle:
                      Text('${_fmt(_lines[i].quantity)} × ${_fmt(_lines[i].points)} نقطة'),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_fmt(_lines[i].total),
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 15)),
                      const SizedBox(width: 8),
                      const Icon(Icons.edit_outlined, size: 18, color: AppColors.primary),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, size: 18,
                            color: AppColors.danger),
                        padding: EdgeInsets.zero,
                        visualDensity: VisualDensity.compact,
                        constraints: const BoxConstraints.tightFor(width: 34, height: 34),
                        tooltip: 'حذف',
                        onPressed: () => _removeLine(i),
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

  void _removeLine(int index) {
    final removed = _lines[index];
    setState(() => _lines.removeAt(index));
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text('حُذف «${removed.itemName}»'),
        action: SnackBarAction(
          label: 'تراجع',
          onPressed: () => setState(() => _lines.insert(index, removed)),
        ),
      ));
  }

  Future<void> _editLine(int index) async {
    final line = _lines[index];
    final qty = TextEditingController(text: _fmt(line.quantity));
    final answer = await showDialog<Object>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (c, setInner) {
            final typed = double.tryParse(qty.text.trim()) ?? 0;
            final total = typed * line.points;
            return AlertDialog(
              titlePadding: const EdgeInsetsDirectional.fromSTEB(20, 16, 8, 0),
              title: Row(
                children: [
                  Expanded(
                    child: Text(line.itemName,
                        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  ),
                  IconButton(
                    tooltip: 'حذف الصنف',
                    icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                    onPressed: () => Navigator.pop(c, _kDelete),
                  ),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('نقاط الوحدة: ${_fmt(line.points)}',
                      style: const TextStyle(
                          color: AppColors.primary, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
                  TextField(
                    controller: qty,
                    autofocus: true,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    onChanged: (_) => setInner(() {}),
                    onSubmitted: (_) => Navigator.pop(c, double.tryParse(qty.text)),
                    decoration: const InputDecoration(labelText: 'الكمية'),
                  ),
                  const SizedBox(height: 10),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Text(
                      total > 0 ? 'الإجمالي: ${_fmt(total)} نقطة' : 'الإجمالي: —',
                      style: TextStyle(
                        color: total > 0 ? AppColors.success : Colors.blueGrey,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              actionsPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              actions: [
                TextButton(onPressed: () => Navigator.pop(c), child: const Text('إلغاء')),
                FilledButton(
                  onPressed: () => Navigator.pop(c, double.tryParse(qty.text)),
                  child: const Text('تم'),
                ),
              ],
            );
          },
        ),
      ),
    );
    if (answer == _kDelete) {
      setState(() => _lines.removeAt(index));
      return;
    }
    if (answer is double && answer > 0) {
      setState(() => _lines[index].quantity = answer);
    }
  }

  Widget _nameSearch({
    required String label,
    required TextEditingController controller,
    required void Function(CustomerRef) onPick,
    required void Function() onType,
    String? helper,
    IconData leading = Icons.person_outline,
    String? Function(String?)? validator,
    List<String>? customerTypes,
  }) {
    return Autocomplete<CustomerRef>(
      displayStringForOption: (c) => c.name,
      optionsBuilder: (value) async {
        final q = value.text.trim();
        if (q.length < 2) return const Iterable<CustomerRef>.empty();
        return LocalDb.instance.customers(query: q, limit: 8, customerTypes: customerTypes);
      },
      onSelected: (c) {
        controller.text = c.name;
        onPick(c);
        setState(() {});
      },
      fieldViewBuilder: (context, textCtrl, focusNode, onSubmit) {
        textCtrl.text = controller.text;
        textCtrl.selection = TextSelection.collapsed(offset: textCtrl.text.length);
        return TextFormField(
          controller: textCtrl,
          focusNode: focusNode,
          onChanged: (v) {
            controller.text = v;
            onType();
          },
          decoration: InputDecoration(
            labelText: label,
            prefixIcon: const Icon(Icons.search),
            helperText: helper,
          ),
          validator: validator,
        );
      },
      optionsViewBuilder: (context, onSelected, options) => Align(
        alignment: AlignmentDirectional.topStart,
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
                    leading: Icon(leading, color: AppColors.primary),
                    title: Text(o.name),
                    subtitle: (o.phone ?? '').isEmpty ? null : Text(o.phone!),
                    onTap: () => onSelected(o),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
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
