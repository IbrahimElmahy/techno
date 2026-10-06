import 'package:flutter/material.dart';

import '../theme.dart';
import '../utils/format.dart';

/// متابعة المناديب — اللي بيرجع من `/supervisor/*`. مابيتخزّنش على الجهاز: المشرف
/// بيتابع أرقام بتتغيّر كل دقيقة، ورقم قديم متخزّن أوحش من «مافيش شبكة».

int _int(Object? v) => v is int ? v : int.tryParse('${v ?? ''}') ?? 0;
String? _str(Object? v) {
  final s = v?.toString().trim() ?? '';
  return s.isEmpty ? null : s;
}

/// أرقام فترة — للإجمالي فوق ولكل مندوب في كارته.
class SupStats {
  final double sales;
  final int salesCount;
  final double returns;
  final int returnsCount;
  final double collections;
  final int collectionsCount;
  final double net;
  final double customersDebt;

  const SupStats({
    this.sales = 0,
    this.salesCount = 0,
    this.returns = 0,
    this.returnsCount = 0,
    this.collections = 0,
    this.collectionsCount = 0,
    this.net = 0,
    this.customersDebt = 0,
  });

  factory SupStats.fromJson(Map<String, dynamic> j) => SupStats(
        sales: parseMoney(j['sales']) ?? 0,
        salesCount: _int(j['sales_count']),
        returns: parseMoney(j['returns']) ?? 0,
        returnsCount: _int(j['returns_count']),
        collections: parseMoney(j['collections']) ?? 0,
        collectionsCount: _int(j['collections_count']),
        net: parseMoney(j['net']) ?? 0,
        customersDebt: parseMoney(j['customers_debt']) ?? 0,
      );
}

class SupRep {
  final int id;
  final String fullName;
  final String? username;
  final SupStats stats;
  final int customersCount;
  final DateTime? lastActivityAt;

  const SupRep({
    required this.id,
    required this.fullName,
    this.username,
    this.stats = const SupStats(),
    this.customersCount = 0,
    this.lastActivityAt,
  });

  factory SupRep.fromJson(Map<String, dynamic> j) => SupRep(
        id: _int(j['id']),
        fullName: _str(j['full_name']) ?? _str(j['username']) ?? 'مندوب #${j['id']}',
        username: _str(j['username']),
        stats: SupStats.fromJson(j),
        customersCount: _int(j['customers_count']),
        lastActivityAt: parseDateTime(j['last_activity_at']),
      );

  /// أول حرف من الاسم — للدايرة اللي جنبه.
  String get initial {
    final s = fullName.trim();
    return s.isEmpty ? '؟' : s.characters.first;
  }
}

class SupOverview {
  final SupStats totals;
  final int repsCount;
  final List<SupRep> reps;

  const SupOverview({required this.totals, required this.repsCount, required this.reps});

  factory SupOverview.fromJson(Map<String, dynamic> j) {
    final t = (j['totals'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final reps = [
      for (final r in (j['reps'] as List? ?? const []))
        if (r is Map) SupRep.fromJson(r.cast<String, dynamic>())
    ];
    return SupOverview(
      totals: SupStats.fromJson(t),
      repsCount: t['reps_count'] == null ? reps.length : _int(t['reps_count']),
      reps: reps,
    );
  }
}

/// نوع الحركة — الاسم اللي السيرفر بيفهمه، والعنوان والأيقونة واللون اللي بيبانوا.
enum ActivityKind {
  all('all', 'الكل', Icons.all_inclusive, AppColors.primary),
  sales('sales', 'الفواتير', Icons.receipt_long_outlined, AppColors.primary),
  returns('returns', 'المرتجعات', Icons.assignment_return_outlined, AppColors.danger),
  collections('collections', 'التحصيلات', Icons.payments_outlined, AppColors.success),
  transfers('transfers', 'التحويلات', Icons.swap_horiz_outlined, AppColors.accent),
  coupons('coupons', 'الكوبونات', Icons.confirmation_number_outlined, Color(0xFF7B4FB8)),
  inspections('inspections', 'المعاينات', Icons.fact_check_outlined, Color(0xFF1B8A8F));

  const ActivityKind(this.api, this.label, this.icon, this.color);
  final String api;
  final String label;
  final IconData icon;
  final Color color;

  /// اسم الواحدة — «فاتورة»، «مرتجع»… للكارت ولعنوان شاشة المستند.
  String get single => switch (this) {
        ActivityKind.all => 'حركة',
        ActivityKind.sales => 'فاتورة بيع',
        ActivityKind.returns => 'مرتجع',
        ActivityKind.collections => 'تحصيل',
        ActivityKind.transfers => 'تحويل',
        ActivityKind.coupons => 'كوبونات',
        ActivityKind.inspections => 'معاينة',
      };

  /// المستندات اللي ليها سطور — بس دول بيتفتحوا.
  bool get hasDocument =>
      this == ActivityKind.sales ||
      this == ActivityKind.returns ||
      this == ActivityKind.transfers;

  static ActivityKind fromApi(String? s) =>
      ActivityKind.values.firstWhere((k) => k.api == s, orElse: () => ActivityKind.all);
}

class SupActivity {
  final ActivityKind kind;
  final int id;
  final String? documentNumber;
  final DateTime? date;
  final DateTime? createdAt;
  final String? partyName;
  final double? amount;
  final double? cash;
  final double? credit;
  final String? status;
  final String? note;
  final int? linesCount;

  const SupActivity({
    required this.kind,
    required this.id,
    this.documentNumber,
    this.date,
    this.createdAt,
    this.partyName,
    this.amount,
    this.cash,
    this.credit,
    this.status,
    this.note,
    this.linesCount,
  });

  factory SupActivity.fromJson(Map<String, dynamic> j) => SupActivity(
        kind: ActivityKind.fromApi(j['kind']?.toString()),
        id: _int(j['id']),
        documentNumber: _str(j['document_number']),
        date: parseDateTime(j['date']),
        createdAt: parseDateTime(j['created_at']),
        partyName: _str(j['party_name']),
        amount: parseMoney(j['amount']),
        cash: parseMoney(j['cash']),
        credit: parseMoney(j['credit']),
        status: _str(j['status']),
        note: _str(j['note']),
        linesCount: j['lines_count'] == null ? null : _int(j['lines_count']),
      );

  /// «2026/10/06 · 10:22 ص» — الوقت من `created_at` لو موجود.
  String get when {
    final d = date ?? createdAt;
    if (d == null) return '';
    final t = createdAt;
    return t == null ? fmtDate(d) : '${fmtDate(d)} · ${fmtTime(t)}';
  }

  String get title => documentNumber ?? '${kind.single} #$id';
}

class SupDocLine {
  final String itemName;
  final double? quantity;
  final String? unit;
  final double? unitPrice;
  final double? lineTotal;

  const SupDocLine(
      {required this.itemName, this.quantity, this.unit, this.unitPrice, this.lineTotal});

  factory SupDocLine.fromJson(Map<String, dynamic> j) => SupDocLine(
        itemName: _str(j['item_name']) ?? '—',
        quantity: parseMoney(j['quantity']),
        unit: _str(j['unit']),
        unitPrice: parseMoney(j['unit_price']),
        lineTotal: parseMoney(j['line_total']),
      );
}

class SupDocument {
  final SupActivity header;
  final List<SupDocLine> lines;

  const SupDocument({required this.header, required this.lines});

  factory SupDocument.fromJson(Map<String, dynamic> j, {ActivityKind? kind}) {
    final h = <String, dynamic>{...?(j['header'] as Map?)?.cast<String, dynamic>()};
    // النوع من الطلب نفسه لو الرأس ماقالهوش — الرابط اتفتح بيه أصلاً.
    if (h['kind'] == null && kind != null) h['kind'] = kind.api;
    return SupDocument(
      header: SupActivity.fromJson(h),
      lines: [
        for (final l in (j['lines'] as List? ?? const []))
          if (l is Map) SupDocLine.fromJson(l.cast<String, dynamic>())
      ],
    );
  }
}
