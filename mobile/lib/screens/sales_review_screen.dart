import 'dart:convert';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';
import 'invoice_print_screen.dart';
import 'sale_coupons_section.dart';
import 'sale_invoice_screen.dart';

/// فواتير الجهاز — اللي راحت واللي لسه.
///
/// المندوب لازم يشوف بعينه إن اللي كتبه وصل. الطابور اللي محدش بيبص عليه هو اللي بيخلّي
/// فاتورة تفضل يومين على الجهاز ومحدش واخد باله — فالسطر بيقول حالته صريح، والمرفوعة
/// بترقمها اللي في الدفاتر.
class SalesReviewScreen extends StatefulWidget {
  const SalesReviewScreen({super.key});

  @override
  State<SalesReviewScreen> createState() => _SalesReviewScreenState();
}

class _SalesReviewScreenState extends State<SalesReviewScreen> {
  List<Map<String, Object?>> _rows = [];
  bool _loading = true;
  bool _pushing = false;

  /// البحث والفلترة — في الذاكرة: القايمة كلها على الجهاز أصلاً، مافيش داعي لسيرفر.
  final _search = TextEditingController();
  DateTime? _from;
  DateTime? _to;

  /// همزة وألف وياء بيتوحّدوا — «أحمد» و«احمد» نفس الاسم، والمندوب مش فاكر
  /// الكارت اتكتب بأنهي واحدة فيهم.
  String _bare(String x) => x
      .replaceAll(RegExp('[أإآ]'), 'ا')
      .replaceAll('ة', 'ه')
      .replaceAll('ى', 'ي');

  List<Map<String, Object?>> get _visible {
    final q = _bare(_search.text.trim());
    return [
      for (final r in _rows)
        if ((q.isEmpty ||
                _bare('${r['customer_name'] ?? ''}').contains(q) ||
                '${r['document_number'] ?? ''}'.contains(q)) &&
            _inRange(r['invoice_date'] as String?))
          r
    ];
  }

  bool _inRange(String? d) {
    if (d == null || d.isEmpty) return true;
    final day = DateTime.tryParse(d);
    if (day == null) return true;
    if (_from != null && day.isBefore(DateTime(_from!.year, _from!.month, _from!.day))) {
      return false;
    }
    if (_to != null && day.isAfter(DateTime(_to!.year, _to!.month, _to!.day))) {
      return false;
    }
    return true;
  }

  Future<void> _pickDate({required bool from}) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: (from ? _from : _to) ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
        // «من» بعد «إلى» مالوش معنى — الحد التاني بيتظبط بدل ما النتيجة تطلع فاضية
        // ومحدش فاهم ليه.
        if (_to != null && _to!.isBefore(d)) _to = d;
      } else {
        _to = d;
        if (_from != null && _from!.isAfter(d)) _from = d;
      }
    });
  }

  String _d(DateTime? v) => v == null ? '' : v.toIso8601String().substring(0, 10);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final rows = await LocalDb.instance.saleInvoices();
    if (mounted) setState(() { _rows = rows; _loading = false; });
  }

  Future<void> _push() async {
    setState(() => _pushing = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final n = await ApiClient.instance.pushSaleInvoices();
      messenger.showSnackBar(SnackBar(
        content: Text(n == 0 ? 'مافيش فواتير مستنية' : 'اترفعت $n فاتورة ✔'),
        backgroundColor: n == 0 ? null : AppColors.success,
      ));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e'), backgroundColor: AppColors.danger));
    } finally {
      if (mounted) setState(() => _pushing = false);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = _rows.where((r) => (r['synced'] as int?) != 1).length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('فواتيري'),
        actions: [
          IconButton(
            onPressed: _pushing ? null : _push,
            icon: _pushing
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.cloud_upload_outlined),
            tooltip: 'رفع المستني',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // البحث والفترة — فوق القايمة، مش جوّه منيو مستخبية.
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: 'دوّر بالعميل أو رقم المستند',
                      prefixIcon: const Icon(Icons.search),
                      isDense: true,
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () => setState(_search.clear),
                            ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _pickDate(from: true),
                          icon: const Icon(Icons.event_outlined, size: 16),
                          label: Text(_from == null ? 'من' : 'من ${_d(_from)}',
                              style: const TextStyle(fontSize: 12)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _pickDate(from: false),
                          icon: const Icon(Icons.event, size: 16),
                          label: Text(_to == null ? 'إلى' : 'إلى ${_d(_to)}',
                              style: const TextStyle(fontSize: 12)),
                        ),
                      ),
                      if (_from != null || _to != null)
                        IconButton(
                          tooltip: 'شيل الفترة',
                          icon: const Icon(Icons.filter_alt_off_outlined, size: 20),
                          onPressed: () => setState(() {
                            _from = null;
                            _to = null;
                          }),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: _visible.isEmpty
                        ? ListView(children: [
                            Padding(
                              padding: const EdgeInsets.all(40),
                              child: Text(
                                  _rows.isEmpty
                                      ? 'مافيش فواتير على الجهاز.'
                                      : 'مافيش فواتير على الفلتر ده.',
                                  textAlign: TextAlign.center),
                            )
                          ])
                        : ListView(
                            children: [
                              if (pending > 0)
                                Card(
                                  color: const Color(0xFFFFF6E5),
                                  child: ListTile(
                                    leading: const Icon(Icons.schedule,
                                        color: AppColors.accent),
                                    title: Text('$pending فاتورة مستنية الرفع'),
                                    subtitle:
                                        const Text('اضغط السحابة فوق عشان ترفعهم'),
                                  ),
                                ),
                              for (final r in _visible) _invoiceCard(r),
                            ],
                          ),
                  ),
                ),
              ],
            ),
    );
  }

  /// صفوف الكوبونات المخزّنة على الفاتورة (JSON). الفاضي أو المكسور بيرجّع قايمة فاضية —
  /// كارت من غير كوبونات أحسن من كارت بيقول «خطأ».
  List<Map<String, Object?>> _couponRows(Map<String, Object?> r) {
    final raw = r['coupons'] as String?;
    if (raw == null || raw.trim().isEmpty) return const [];
    try {
      final v = jsonDecode(raw);
      if (v is! List) return const [];
      return [for (final e in v) if (e is Map) Map<String, Object?>.from(e)];
    } catch (_) {
      return const [];
    }
  }

  /// عدد الصف — المكتوب، وإلا محسوب من المدى. `couponCount` هي نفسها اللي الشاشة
  /// بتكتب بيها، فالرقم هنا مابيخالفش اللي اتحفظ.
  int _countOf(Map<String, Object?> c) =>
      (c['count'] as int?) ??
      couponCount(c['serial_from'] as String?, c['serial_to'] as String?) ??
      0;

  int _couponTotal(Map<String, Object?> r) =>
      _couponRows(r).fold(0, (t, c) => t + _countOf(c));

  Widget _invoiceCard(Map<String, Object?> r) {
    final synced = (r['synced'] as int?) == 1;
    return Card(
      child: ExpansionTile(
        leading: Icon(
          synced ? Icons.check_circle : Icons.schedule,
          color: synced ? AppColors.success : AppColors.accent,
        ),
        title: Text(r['customer_name'] as String? ?? '—',
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text([
          r['invoice_date'] as String? ?? '',
          '${(r['total'] as num?)?.toStringAsFixed(2) ?? '0.00'} ج.م',
          // العدد على السطر المقفول كمان — فاتورة كوبونات بس إجماليها صفر، وكانت
          // بتبان في القايمة كأنها ورقة فاضية ماحصلش فيها حاجة.
          if (_couponTotal(r) > 0) '${_couponTotal(r)} كوبون',
          if (synced) r['document_number'] as String? ?? '' else 'لسه على الجهاز',
        ].where((s) => s.isNotEmpty).join(' · ')),
        children: [
          FutureBuilder<List<SaleDraftLine>>(
            future: LocalDb.instance.saleInvoiceLines(r['local_id'] as int),
            builder: (_, snap) {
              final lines = snap.data ?? const <SaleDraftLine>[];
              return Column(
                children: [
                  for (final l in lines)
                    ListTile(
                      dense: true,
                      title: Text(l.itemName),
                      subtitle: Text([
                        '${_trim(l.quantity)} × ${l.unitPrice.toStringAsFixed(2)}',
                        if (l.fixedDiscountPct > 0) 'ثابت ${_trim(l.fixedDiscountPct)}%',
                        if (l.variableDiscountPct > 0)
                          'إضافي ${_trim(l.variableDiscountPct)}%',
                      ].join(' — ')),
                      trailing: Text('${l.net.toStringAsFixed(2)} ج.م',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  // الكوبونات المسلّمة — زي ما هي على الورقة المطبوعة بالظبط.
                  //
                  // كانت الشاشة بتعرض سطور الأصناف وبس، فالدفاتر اللي اتسلّمت للعميل
                  // مابتبانش في أي مكان في التطبيق بعد الحفظ: المندوب اللي عايز يراجع
                  // سلّم أنهي أرقام لازم يفتح الورقة. وفاتورة كوبونات بس (من غير أصناف)
                  // كانت بتتفتح على كارت فاضي خالص.
                  //
                  // **والمدى هو المهم مش العدد**: يوم ما العميل يرجّع ورقة، اللي بيستلم
                  // بيراجع رقمها على المدى ده عشان يعرف إنها اتصرفت في تسليمة حصلت فعلاً.
                  for (final c in _couponRows(r))
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.confirmation_number_outlined,
                          size: 20, color: AppColors.accent),
                      title: Text('${c['coupon_kind'] ?? 'كوبونات'}'),
                      subtitle: Text(
                          'من ${c['serial_from'] ?? '—'} إلى ${c['serial_to'] ?? '—'}'),
                      trailing: Text('${_countOf(c)} كوبون',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // **اللي في الطابور بيتعدّل ومابيتطبعش. واللي وصل بيتطبع
                        // ومابيتعدّلش.**
                        //
                        // الورقة اللي بتتطبع من مسودّة بتدّعي فاتورة مالهاش وجود عند
                        // المكتب: الفاتورة ممكن تترفض عند الرفع (رصيد مايكفيش مثلاً)
                        // أو تتعدّل قبل ما ترفع، والورقة اللي في إيد العميل ساعتها
                        // بتقول حاجة تانية خالص.
                        //
                        // وأول ما توصل السيرفر بقت مستند بقيد ومخزون اتحرّك — تعديلها
                        // على الجهاز بعد كده بيخلّي الورقة والدفتر يقولوا رقمين. التصحيح
                        // ساعتها بمرتجع من المكتب، والاتنين بيبانوا.
                        if (synced)
                          TextButton.icon(
                            onPressed: () => Navigator.push(
                              context,
                              MaterialPageRoute(
                                  builder: (_) => InvoicePrintScreen(invoice: r)),
                            ),
                            icon: const Icon(Icons.print_outlined),
                            label: const Text('طباعة / PDF'),
                          )
                        else
                          TextButton.icon(
                            onPressed: () async {
                              final changed = await Navigator.push<bool>(
                                context,
                                MaterialPageRoute(
                                    builder: (_) =>
                                        SaleInvoiceScreen(existing: r)),
                              );
                              if (changed == true) _load();
                            },
                            icon: const Icon(Icons.edit_outlined),
                            label: const Text('تعديل'),
                          ),
                        if (!synced)
                          const Padding(
                            padding: EdgeInsets.only(right: 8),
                            child: Text('اعمل «مزامنة الآن» عشان تطبع',
                                style: TextStyle(
                                    fontSize: 11, color: Colors.black45)),
                          ),
                        // **مافيش «امسح».** الفاتورة اللي لسه على الجهاز مستند اتكتب
                        // فعلاً: العميل استلم بضاعة وورقة، والرصيد اتحسب عليها في
                        // التطبيق. مسحها بتشيل الأثر الوحيد اللي بيقول إنها حصلت —
                        // ومحدش في المكتب هيعرف إنها كانت موجودة أصلاً.
                        //
                        // والغلط بيتصلّح بمستند مش بمسح: ترفع وتتعمل مرتجع، والاتنين
                        // بيبانوا. اللي عايز يلغي فاتورة قبل ما ترفع بيكلّم المكتب.
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

String _trim(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}
