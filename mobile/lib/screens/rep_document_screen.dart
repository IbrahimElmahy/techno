import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/supervisor.dart';
import '../theme.dart';
import '../utils/format.dart';
import '../widgets/supervisor_widgets.dart';

class RepDocumentScreen extends StatefulWidget {
  const RepDocumentScreen({
    super.key,
    required this.repId,
    required this.kind,
    required this.id,
    this.preview,
  });

  final int repId;
  final ActivityKind kind;
  final int id;

  final SupActivity? preview;

  @override
  State<RepDocumentScreen> createState() => _RepDocumentScreenState();
}

class _RepDocumentScreenState extends State<RepDocumentScreen> {
  SupDocument? _doc;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j =
          await ApiClient.instance.supervisorDocument(widget.repId, widget.kind.api, widget.id);
      if (!mounted) return;
      setState(() {
        _doc = SupDocument.fromJson(j, kind: widget.kind);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final h = _doc?.header ?? widget.preview;
    return Scaffold(
      appBar: AppBar(title: Text(h?.title ?? widget.kind.single)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(top: 8, bottom: 24),
          children: [
            if (h != null) _headerCard(h),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              OnlineErrorView(error: _error!, onRetry: _load)
            else if (_doc != null) ...[
              if (_doc!.lines.isNotEmpty || _doc!.coupons.isEmpty) _linesCard(_doc!.lines),
              if (_doc!.coupons.isNotEmpty) _couponsCard(_doc!.coupons),
              _totalsCard(_doc!),
              if (_doc!.balances.isNotEmpty) _balancesCard(_doc!.balances),
            ],
          ],
        ),
      ),
    );
  }

  Widget _headerCard(SupActivity h) {
    final k = widget.kind;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: k.color.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(k.icon, color: k.color, size: 26),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(k.single,
                          style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
                      Text(h.title,
                          style: const TextStyle(
                              fontSize: 19, fontWeight: FontWeight.w800)),
                    ],
                  ),
                ),
                if (h.status != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.blueGrey.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(h.status!,
                        style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: Colors.blueGrey)),
                  ),
              ],
            ),
            const Divider(height: 24),
            if (h.partyName != null)
              _info(Icons.person_outline, k == ActivityKind.transfers ? 'الجهة' : 'العميل',
                  h.partyName!),
            if (h.when.isNotEmpty) _info(Icons.event_outlined, 'التاريخ', h.when),
            if (_doc?.family != null)
              _info(Icons.category_outlined, 'نوع الطلب', _doc!.family!),
            if (h.note != null) _info(Icons.notes_outlined, 'ملاحظات', h.note!),
            if (h.amount != null || h.cash != null || h.credit != null) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    if (h.amount != null)
                      Expanded(
                          child: MiniStat(
                              label: 'الإجمالي',
                              value: fmtMoney(h.amount),
                              color: k.color)),
                    if (h.cash != null)
                      Expanded(
                          child: MiniStat(
                              label: 'نقدي',
                              value: fmtMoney(h.cash),
                              color: AppColors.success)),
                    if (h.credit != null)
                      Expanded(
                          child: MiniStat(
                              label: 'آجل',
                              value: fmtMoney(h.credit),
                              color: AppColors.danger)),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _info(IconData icon, String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: Colors.grey.shade600),
            const SizedBox(width: 8),
            SizedBox(
              width: 70,
              child: Text(label,
                  style: TextStyle(fontSize: 13.5, color: Colors.grey.shade600)),
            ),
            Expanded(
              child: Text(value,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      );

  static const _flex = [5, 2, 2, 3, 3];

  Widget _row(List<Widget> cells, {Color? color, EdgeInsets? padding}) => Container(
        color: color,
        padding: padding ?? const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < cells.length; i++)
              Expanded(flex: _flex[i], child: cells[i]),
          ],
        ),
      );

  Widget _linesCard(List<SupDocLine> lines) {
    const head = TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Colors.white);
    const cell = TextStyle(fontSize: 13);
    Widget mid(String s, {bool bold = false}) => Text(s,
        textAlign: TextAlign.center,
        style: bold ? const TextStyle(fontSize: 13, fontWeight: FontWeight.w800) : cell);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          _row(
            const [
              Text('اسم الصنف', style: head),
              Text('الكمية', style: head, textAlign: TextAlign.center),
              Text('الوحدة', style: head, textAlign: TextAlign.center),
              Text('السعر', style: head, textAlign: TextAlign.center),
              Text('الإجمالي', style: head, textAlign: TextAlign.center),
            ],
            color: AppColors.primary,
          ),
          if (lines.isEmpty)
            Padding(
              padding: const EdgeInsets.all(20),
              child: Text('لا توجد سطور',
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade600)),
            ),
          for (var i = 0; i < lines.length; i++)
            _row(
              [
                Text(lines[i].itemName, style: cell),
                mid(fmtQty(lines[i].quantity), bold: true),
                mid(lines[i].unit ?? '—'),
                mid(lines[i].unitPrice == null ? '—' : fmtMoney(lines[i].unitPrice)),
                mid(lines[i].lineTotal == null ? '—' : fmtMoney(lines[i].lineTotal),
                    bold: true),
              ],
              color: i.isOdd ? AppColors.surface : Colors.white,
            ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Align(
          alignment: AlignmentDirectional.centerStart,
          child: Text(text,
              style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800)),
        ),
      );

  Widget _grid(List<int> flex, List<Widget> cells, {Color? color}) => Container(
        color: color,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < cells.length; i++)
              Expanded(flex: flex[i], child: cells[i]),
          ],
        ),
      );

  Widget _couponsCard(List<SupCoupon> coupons) {
    const flex = [4, 3, 3, 2];
    const head = TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Colors.white);
    const cell = TextStyle(fontSize: 13);
    Widget mid(String s, {bool bold = false}) => Text(s,
        textAlign: TextAlign.center,
        style: bold ? const TextStyle(fontSize: 13, fontWeight: FontWeight.w800) : cell);
    final total = coupons.fold<int>(0, (t, c) => t + (c.count ?? 0));
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          _sectionTitle('الكوبونات المسلّمة'),
          _grid(
            flex,
            const [
              Text('الفئة', style: head),
              Text('من رقم', style: head, textAlign: TextAlign.center),
              Text('إلى رقم', style: head, textAlign: TextAlign.center),
              Text('العدد', style: head, textAlign: TextAlign.center),
            ],
            color: AppColors.primary,
          ),
          for (var i = 0; i < coupons.length; i++)
            _grid(
              flex,
              [
                Text(coupons[i].kind ?? '—', style: cell),
                mid(coupons[i].serialFrom ?? '—'),
                mid(coupons[i].serialTo ?? '—'),
                mid(coupons[i].count == null ? '—' : '${coupons[i].count}', bold: true),
              ],
              color: i.isOdd ? AppColors.surface : Colors.white,
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Text('إجمالي الكوبونات',
                      style: TextStyle(fontSize: 14, color: Colors.grey.shade700)),
                ),
                Text('$total',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _balancesCard(List<SupFamilyBalance> balances) {
    const flex = [4, 3, 3];
    const head = TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Colors.white);
    Widget amount(double v, {bool bold = false}) => Text(fmtMoney(v),
        textAlign: TextAlign.center,
        style: TextStyle(
            fontSize: 13.5,
            fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
            color: v > 0.001 ? AppColors.danger : AppColors.primary));
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          _sectionTitle('حساب العميل'),
          _grid(
            flex,
            const [
              Text('الحساب', style: head),
              Text('قبل الفاتورة', style: head, textAlign: TextAlign.center),
              Text('بعد الفاتورة', style: head, textAlign: TextAlign.center),
            ],
            color: AppColors.primary,
          ),
          for (var i = 0; i < balances.length; i++)
            _grid(
              flex,
              [
                Text(balances[i].label,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: balances[i].own ? FontWeight.w800 : FontWeight.w500)),
                amount(balances[i].before),
                amount(balances[i].after, bold: balances[i].own),
              ],
              color: i.isOdd ? AppColors.surface : Colors.white,
            ),
        ],
      ),
    );
  }

  Widget _totalsCard(SupDocument d) {
    final priced = d.lines.where((l) => l.lineTotal != null).toList();
    final sum = priced.fold<double>(0, (a, l) => a + (l.lineTotal ?? 0));
    final amount = d.header.amount;
    final diff = amount == null || priced.isEmpty ? 0.0 : sum - amount;
    Widget line(String label, String value, {Color? color, bool big = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              Expanded(
                child: Text(label,
                    style: TextStyle(
                        fontSize: big ? 15 : 14,
                        fontWeight: big ? FontWeight.w800 : FontWeight.w500,
                        color: big ? null : Colors.grey.shade700)),
              ),
              Text(value,
                  style: TextStyle(
                      fontSize: big ? 18 : 14,
                      fontWeight: FontWeight.w800,
                      color: color)),
            ],
          ),
        );
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          children: [
            line('عدد الأصناف', '${d.lines.length}'),
            if (priced.isNotEmpty) line('مجموع السطور', fmtMoney(sum)),
            if (diff.abs() >= 0.01) line('خصم / تسوية', fmtMoney(-diff)),
            if (amount != null || priced.isNotEmpty) ...[
              const Divider(height: 16),
              line('الإجمالي', fmtMoney(amount ?? sum), color: widget.kind.color, big: true),
            ],
          ],
        ),
      ),
    );
  }
}
