import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/arabic_sort.dart';
import '../models/coupon_custody.dart';
import '../models/models.dart';
import '../theme.dart';

class SaleCouponRow {
  SaleCouponRow({this.kind, this.serialFrom = '', this.serialTo = ''});

  String? kind;
  String serialFrom;
  String serialTo;

  bool get isEmpty =>
      (kind == null || kind!.isEmpty) &&
      serialFrom.trim().isEmpty &&
      serialTo.trim().isEmpty;

  CouponRowInput get asInput => (kind: kind, from: serialFrom, to: serialTo);

  Map<String, Object?> toJson() => {
        'coupon_kind': (kind ?? '').isEmpty ? null : kind,
        'serial_from':
            serialFrom.trim().isEmpty ? null : asciiDigits(serialFrom.trim()),
        'serial_to': serialTo.trim().isEmpty ? null : asciiDigits(serialTo.trim()),
        'count': couponCount(serialFrom, serialTo),
      };
}

int? couponCount(String? from, String? to) {
  final f = asciiDigits((from ?? '').trim());
  final t = asciiDigits((to ?? '').trim());
  if (f.isEmpty || t.isEmpty) return null;
  final re = RegExp(r'^(.*?)(\d+)$');
  final a = re.firstMatch(f);
  final b = re.firstMatch(t);
  if (a == null || b == null) return null;
  if (a.group(1) != b.group(1)) return null;
  final an = int.tryParse(a.group(2)!);
  final bn = int.tryParse(b.group(2)!);
  if (an == null || bn == null) return null;
  if (bn < an) return null;
  return bn - an + 1;
}

class SaleCouponsSection extends StatefulWidget {
  const SaleCouponsSection(
      {super.key, required this.rows, required this.onChanged, this.custody});

  final List<SaleCouponRow> rows;
  final VoidCallback onChanged;

  final CouponCustody? custody;

  @override
  State<SaleCouponsSection> createState() => _SaleCouponsSectionState();
}

class _SaleCouponsSectionState extends State<SaleCouponsSection> {
  List<LookupOption> _kinds = [];
  bool _open = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final k = await LocalDb.instance.lookups('coupon_kind');
    if (mounted) {
      setState(() {
        _kinds = k;
        if (widget.rows.isEmpty) widget.rows.add(SaleCouponRow());
      });
    }
  }

  int get _total => widget.rows.fold(
      0, (t, r) => t + (couponCount(r.serialFrom, r.serialTo) ?? 0));

  @override
  Widget build(BuildContext context) {
    final filled = widget.rows.where((r) => !r.isEmpty).length;
    final custody = widget.custody ?? CouponCustody.none;
    final errors = custody.check([for (final r in widget.rows) r.asInput]);
    final hasError = errors.any((e) => e != null);
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.confirmation_number_outlined,
                color: AppColors.accent),
            title: const Text('كوبونات مصروفة مع الفاتورة',
                style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
                hasError
                    ? 'توجد مشكلة في سريالات الكوبونات — افتح للمراجعة'
                    : _total > 0
                        ? '$_total كوبون في $filled ${filled == 1 ? 'فئة' : 'فئات'}'
                        : 'اختياري',
                style: hasError
                    ? const TextStyle(
                        color: AppColors.danger, fontWeight: FontWeight.w700)
                    : null),
            trailing: Icon(_open ? Icons.expand_less : Icons.expand_more),
            onTap: () => setState(() => _open = !_open),
          ),
          if (_open) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Column(
                children: [
                  for (var i = 0; i < widget.rows.length; i++)
                    _row(widget.rows[i], i, errors[i],
                        custody.hintFor(widget.rows[i].kind)),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton.icon(
                      icon: const Icon(Icons.add),
                      label: const Text('فئة كوبون أخرى'),
                      onPressed: () =>
                          setState(() => widget.rows.add(SaleCouponRow())),
                    ),
                  ),
                  if (_total > 0)
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text('الإجمالي: $_total كوبون',
                          style: const TextStyle(
                              fontSize: 12.5, fontWeight: FontWeight.w700)),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _row(SaleCouponRow r, int i, String? custodyError, String? hint) {
    final n = couponCount(r.serialFrom, r.serialTo);
    final bad = r.serialFrom.trim().isNotEmpty &&
        r.serialTo.trim().isNotEmpty &&
        n == null;
    final problem = custodyError ?? (bad ? 'هذا المدى غير صالح — راجع الرقمين' : null);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                flex: 5,
                child: DropdownButtonFormField<String>(
                  initialValue: r.kind,
                  isExpanded: true,
                  decoration: const InputDecoration(
                      labelText: 'فئة الكوبون', isDense: true),
                  items: [
                    const DropdownMenuItem<String>(
                        value: null, child: Text('—')),
                    for (final k in _kinds)
                      DropdownMenuItem(value: k.value, child: Text(k.label)),
                  ],
                  onChanged: (v) => setState(() {
                    r.kind = v;
                    widget.onChanged();
                  }),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 62,
                child: InputDecorator(
                  decoration:
                      const InputDecoration(labelText: 'العدد', isDense: true),
                  child: Text(n?.toString() ?? '—',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
              if (widget.rows.length > 1)
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                  tooltip: 'احذف الصف',
                  onPressed: () => setState(() {
                    widget.rows.removeAt(i);
                    widget.onChanged();
                  }),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  initialValue: r.serialFrom,
                  decoration: const InputDecoration(
                      labelText: 'من رقم', isDense: true),
                  onChanged: (v) => setState(() {
                    r.serialFrom = v;
                    widget.onChanged();
                  }),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextFormField(
                  initialValue: r.serialTo,
                  decoration:
                      const InputDecoration(labelText: 'إلى رقم', isDense: true),
                  onChanged: (v) => setState(() {
                    r.serialTo = v;
                    widget.onChanged();
                  }),
                ),
              ),
            ],
          ),
          if (hint != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(hint,
                  style: const TextStyle(fontSize: 12, color: Colors.black54)),
            ),
          if (problem != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(problem,
                  style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.danger,
                      fontWeight: FontWeight.w700)),
            ),
        ],
      ),
    );
  }
}
