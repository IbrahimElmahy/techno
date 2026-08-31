import 'dart:math';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// تحصيل من عميل — سند قبض من الشارع.
///
/// البيع والتحصيل بيحصلوا في نفس الزيارة غالباً: المندوب بيسلّم بضاعة وبياخد فلوس عن
/// اللي فات. فالتحصيل بيتكتب هنا زي الفاتورة بالظبط — طابور على الجهاز، ورفع لما الشبكة
/// تيجي، ورقم جهاز بيمنع إنه يتقيّد مرتين لو الرفع اتعاد.
///
/// **والتحصيل بالخط** — «المدفوع ده أبيض ولا بولي». العميل مدين على خطين بحسابين،
/// والفلوس بتنزل في صندوق الخط: من غير السؤال ده السند بيتوزّع بالتخمين والصندوق
/// بيتاخد عشوائي. والتاريخ **ثابت على النهارده وعرض بس** — نفس قاعدة الفاتورة:
/// سند بتاريخ قديم بيتكتب من المكتب بقرار، مش من الشارع بغلطة في منتقي تاريخ.
class CollectCashScreen extends StatefulWidget {
  const CollectCashScreen({super.key});

  @override
  State<CollectCashScreen> createState() => _CollectCashScreenState();
}

class _CollectCashScreenState extends State<CollectCashScreen> {
  CustomerRef? _customer;
  /// النهارده دايماً — getter مش حقل، فمافيش طريقة أصلاً تتكتب بيها قيمة تانية.
  DateTime get _date => DateTime.now();
  /// الخط اللي الدفعة عليه — أبيض ولا بولي. إجباري قبل الحفظ.
  String? _family;
  List<RepTreasury> _treasuries = const [];
  final _amount = TextEditingController();
  final _notes = TextEditingController();
  bool _saving = false;
  List<Map<String, Object?>> _recent = [];

  @override
  void initState() {
    super.initState();
    _loadRecent();
    _loadTreasuries();
  }

  Future<void> _loadTreasuries() async {
    final rows = await LocalDb.instance.treasuries();
    if (mounted) setState(() => _treasuries = rows);
  }

  double get _typed => double.tryParse(_amount.text.trim()) ?? 0;

  /// حساب العميل السابق — الإجمالي، ورصيد كل خط لوحده.
  double get _prevBalance => _customer?.balance ?? 0;
  double _familyBalance(String f) => _customer?.familyBalances[f] ?? 0;

  /// الباقي بعد الدفعة. بيقدر يطلع سالب — العميل دفع أكتر من اللي عليه، ودي دفعة
  /// مقدّمة بتتقيّد له، مش غلطة بترفض.
  double get _afterPayment => _prevBalance - _typed;

  /// صندوق الخط المختار — نفس منطق شاشة الفاتورة بالحرف.
  RepTreasury? get _treasury {
    if (_family == null) return null;
    for (final t in _treasuries) {
      if (t.family == _family) return t;
    }
    return null;
  }

  bool get _treasuriesKnown => _treasuries.isNotEmpty;
  bool get _boxMissing => _family != null && _treasuriesKnown && _treasury == null;

  String get _treasuryLabel {
    if (_family == null) return 'بيتحدّد من نوع الدفعة';
    final t = _treasury;
    if (t != null) return t.code.isEmpty ? t.label : '${t.label} · ${t.code}';
    return _treasuriesKnown
        ? 'مافيش صندوق لخط «$_family» — كلّم المكتب'
        : 'اسحب البيانات عشان الصندوق يبان';
  }

  @override
  void dispose() {
    _amount.dispose();
    _notes.dispose();
    _recentSearch.dispose();
    super.dispose();
  }

  Future<void> _loadRecent() async {
    // كل الصفوف بتتحمّل والفلترة في الذاكرة — القايمة على الجهاز أصلاً، وقصّها
    // قبل الفلتر كان هيخلّي البحث يدوّر في آخر ٢٠ بس ويقول «مافيش» على حاجة موجودة.
    final rows = await LocalDb.instance.receipts();
    if (mounted) setState(() => _recent = rows);
  }

  /// البحث والفترة — نفس فلتر «فواتيري» بالحرف.
  final _recentSearch = TextEditingController();
  DateTime? _from;
  DateTime? _to;

  String _bare(String x) => x
      .replaceAll(RegExp('[أإآ]'), 'ا')
      .replaceAll('ة', 'ه')
      .replaceAll('ى', 'ي');

  List<Map<String, Object?>> get _visibleRecent {
    final q = _bare(_recentSearch.text.trim());
    return [
      for (final r in _recent)
        if ((q.isEmpty ||
                _bare('${r['customer_name'] ?? ''}').contains(q) ||
                '${r['document_number'] ?? ''}'.contains(q)) &&
            _inRange(r['receipt_date'] as String?))
          r
    ].take(50).toList();
  }

  bool _inRange(String? d) {
    if (d == null || d.isEmpty) return true;
    final day = DateTime.tryParse(d);
    if (day == null) return true;
    if (_from != null &&
        day.isBefore(DateTime(_from!.year, _from!.month, _from!.day))) {
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
        // «من» بعد «إلى» مالوش معنى — الحد التاني بيتظبط بدل ما النتيجة تطلع فاضية.
        if (_to != null && _to!.isBefore(d)) _to = d;
      } else {
        _to = d;
        if (_from != null && _from!.isAfter(d)) _from = d;
      }
    });
  }

  String _d(DateTime? v) => v == null ? '' : v.toIso8601String().substring(0, 10);

  Future<void> _pickCustomer() async {
    final rows = await LocalDb.instance.customers(limit: 200);
    if (!mounted) return;
    final picked = await showModalBottomSheet<CustomerRef>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _PickSheet(rows: rows),
    );
    if (picked != null) setState(() => _customer = picked);
  }

  Future<void> _save() async {
    final amount = _typed;
    if (_customer == null) return _say('اختار العميل');
    if (_family == null) return _say('المدفوع ده أبيض ولا بولي؟');
    if (amount <= 0) return _say('اكتب المبلغ');
    // مافيش حد أعلى: العميل بيدفع أكتر من اللي عليه عادي، والزيادة بتتقيّد له.
    if (_boxMissing) {
      return _say('مافيش صندوق لخط «$_family» على حسابك — كلّم المكتب.');
    }

    // آخر سؤال قبل الحفظ: الفلوس دي داخلة فين — عرض بس، زي الفاتورة بالظبط.
    if (!await _confirmTreasury(amount)) return;
    if (!mounted) return;

    setState(() => _saving = true);
    try {
      final uuid = 'rcp-${DateTime.now().microsecondsSinceEpoch}-'
          '${Random().nextInt(1 << 32).toRadixString(16)}';
      await LocalDb.instance.saveReceipt(
        clientUuid: uuid,
        customerId: _customer!.id,
        customerName: _customer!.name,
        amount: amount,
        receiptDate: _date.toIso8601String().substring(0, 10),
        family: _family,
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      );
      var pushed = false;
      try {
        pushed = (await ApiClient.instance.pushReceipts()) > 0;
      } catch (_) {/* الطابور بيحاول تاني في المزامنة */}
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(pushed ? 'التحصيل اترفع ✔' : 'التحصيل اتحفظ — هيرفع مع المزامنة'),
        backgroundColor: AppColors.success,
      ));
      setState(() {
        _amount.clear();
        _notes.clear();
        _customer = null;
        _family = null;
      });
      _loadRecent();
    } catch (e) {
      if (mounted) _say('تعذّر الحفظ: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _money(double v) => v.toStringAsFixed(2);

  Widget _balanceRow(String label, double v,
      {bool highlight = false, bool big = false}) {
    final row = Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: big ? 15 : 13,
                fontWeight: highlight ? FontWeight.w700 : FontWeight.w400,
                color: highlight ? Colors.black87 : Colors.black54)),
        Text('${_money(v)} ج.م',
            style: TextStyle(
                fontSize: big ? 18 : 14,
                fontWeight: FontWeight.w800,
                color: v > 0.001 ? AppColors.danger : AppColors.success)),
      ],
    );
    if (!highlight) return row;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(6),
      ),
      child: row,
    );
  }

  /// بوباب «الفلوس داخلة فين» — **قراءة بس**: المندوب مالوش قرار في الصندوق،
  /// نوع الدفعة حدّده. بيشوف ويأكّد.
  Future<bool> _confirmTreasury(double amount) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تأكيد التحصيل',
              style: TextStyle(fontWeight: FontWeight.w800)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('المبلغ', style: TextStyle(color: Colors.black54)),
                  Text('${_money(amount)} ج.م',
                      style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary)),
                ],
              ),
              const Divider(height: 20),
              const Text('بينزل في الخزنة',
                  style: TextStyle(color: Colors.black54)),
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.savings_outlined,
                      size: 16, color: AppColors.primary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(_treasuryLabel,
                        style: const TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 15)),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text('اتحدّد من نوع الدفعة «${_family ?? ''}»',
                  style: const TextStyle(fontSize: 11, color: Colors.black45)),
            ],
          ),
          actionsPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(c, false),
                child: const Text('رجوع')),
            FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: const Text('تأكيد وحفظ')),
          ],
        ),
      ),
    );
    return ok == true;
  }

  void _say(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تحصيل من عميل')),
      body: ListView(
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.person_outline, color: AppColors.primary),
                  title: Text(_customer?.name ?? 'اختار العميل'),
                  trailing: const Icon(Icons.chevron_left),
                  onTap: _pickCustomer,
                ),
                const Divider(height: 1),
                // التاريخ عرض بس — النهارده وخلاص، مافيش onTap أصلاً.
                ListTile(
                  leading: const Icon(Icons.event_outlined, color: AppColors.primary),
                  title: const Text('تاريخ التحصيل'),
                  subtitle: Text(_date.toIso8601String().substring(0, 10)),
                  trailing: const Text('اليوم',
                      style: TextStyle(fontSize: 12, color: Colors.black45)),
                ),
              ],
            ),
          ),
          // المدفوع ده أبيض ولا بولي — قبل المبلغ لأن الإجابة بتحدد الصندوق والمديونية.
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('الدفعة على خط',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      for (final f in const ['أبيض', 'بولي']) ...[
                        Expanded(
                          child: ChoiceChip(
                            label: Center(child: Text(f)),
                            selected: _family == f,
                            onSelected: (_) => setState(() => _family = f),
                          ),
                        ),
                        if (f != 'بولي') const SizedBox(width: 8),
                      ],
                    ],
                  ),
                  if (_family != null) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Icon(Icons.savings_outlined,
                            size: 14,
                            color: _boxMissing ? AppColors.danger : Colors.black45),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text('الفلوس بتنزل في: $_treasuryLabel',
                              maxLines: 2,
                              style: TextStyle(
                                  fontSize: 11,
                                  color: _boxMissing
                                      ? AppColors.danger
                                      : Colors.black54)),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          // حساب العميل — بالخط وبالإجمالي، وبعد الدفعة هيبقى كام.
          if (_customer != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  children: [
                    for (final f in const ['أبيض', 'بولي'])
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: _balanceRow('مديونية $f', _familyBalance(f),
                            highlight: f == _family),
                      ),
                    const Divider(height: 14),
                    _balanceRow('حساب سابق على العميل', _prevBalance),
                    if (_typed > 0) ...[
                      const SizedBox(height: 6),
                      _balanceRow('الباقي بعد الدفعة', _afterPayment, big: true),
                      if (_afterPayment < -0.001)
                        const Padding(
                          padding: EdgeInsets.only(top: 4),
                          child: Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: Text('دفع أكتر من اللي عليه — الزيادة بتتقيّد له',
                                style: TextStyle(
                                    fontSize: 11, color: Colors.black45)),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  TextField(
                    controller: _amount,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
                    textAlign: TextAlign.center,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'المبلغ المحصّل',
                      suffixText: 'ج.م',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _notes,
                    decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.payments_outlined),
              label: Text(_saving ? 'بيحفظ…' : 'حفظ التحصيل'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            ),
          ),
          if (_recent.isNotEmpty) ...[
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Align(
                alignment: AlignmentDirectional.centerStart,
                child: Text('آخر التحصيلات',
                    style: TextStyle(fontWeight: FontWeight.w700, color: Colors.black54)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 0),
              child: TextField(
                controller: _recentSearch,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'دوّر بالعميل أو رقم السند',
                  prefixIcon: const Icon(Icons.search),
                  isDense: true,
                  suffixIcon: _recentSearch.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () => setState(_recentSearch.clear),
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
            if (_visibleRecent.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: Text('مافيش تحصيلات على الفلتر ده')),
              ),
            for (final r in _visibleRecent)
              ListTile(
                leading: Icon(
                  (r['synced'] as int?) == 1 ? Icons.check_circle : Icons.schedule,
                  color: (r['synced'] as int?) == 1 ? AppColors.success : AppColors.accent,
                ),
                title: Text(r['customer_name'] as String? ?? '—'),
                subtitle: Text([
                  r['receipt_date'] as String? ?? '',
                  if ((r['synced'] as int?) == 1)
                    r['document_number'] as String? ?? ''
                  else
                    'لسه على الجهاز',
                ].where((s) => s.isNotEmpty).join(' · ')),
                trailing: Text('${(r['amount'] as num?)?.toStringAsFixed(2) ?? '0.00'} ج.م',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                onLongPress: (r['synced'] as int?) == 1
                    ? null
                    : () async {
                        await LocalDb.instance
                            .deleteUnsyncedReceipt(r['local_id'] as int);
                        _loadRecent();
                      },
              ),
          ],
        ],
      ),
    );
  }
}

class _PickSheet extends StatefulWidget {
  final List<CustomerRef> rows;
  const _PickSheet({required this.rows});

  @override
  State<_PickSheet> createState() => _PickSheetState();
}

class _PickSheetState extends State<_PickSheet> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows
        .where((c) => _q.isEmpty || c.name.contains(_q))
        .toList();
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.75,
      child: Column(
        children: [
          const SizedBox(height: 10),
          const Text('اختار العميل',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              onChanged: (v) => setState(() => _q = v.trim()),
              decoration: const InputDecoration(
                hintText: 'دوّر بالاسم',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          Expanded(
            child: ListView.separated(
              itemCount: rows.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) => ListTile(
                title: Text(rows[i].name),
                subtitle: rows[i].phone == null ? null : Text(rows[i].phone!),
                onTap: () => Navigator.pop(context, rows[i]),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
