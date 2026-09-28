import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../models/coupon_custody.dart';
import '../theme.dart';

/// عهدة الكوبونات — «معايا أنهي دفاتر؟». للقراءة بس.
///
/// نفس سؤال «بضاعتي» بس على الكوبونات: المندوب قبل ما يكتب مدى في الفاتورة محتاج يعرف
/// أنهي سريالات في إيده. من غير الشاشة دي كان بيعرف لما الفاتورة ترفض.
///
/// **والأرقام هنا ناقص اللي اتكتب على فواتير لسه على الجهاز** — نفس حساب فاتورة البيع
/// بالظبط (`LocalDb.couponCustody`)، عشان الشاشتين يقولوا نفس الكلام. والعهدة نفسها
/// بتتحدّث مع «مزامنة» بس: المكتب لو سلّمه دفتر جديد مابيبانش هنا غير بعدها.
class CouponCustodyScreen extends StatefulWidget {
  const CouponCustodyScreen({super.key});

  @override
  State<CouponCustodyScreen> createState() => _CouponCustodyScreenState();
}

class _CouponCustodyScreenState extends State<CouponCustodyScreen> {
  CouponCustody _custody = CouponCustody.none;
  String? _lastPull;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final c = await LocalDb.instance.couponCustody();
    final pull = await LocalDb.instance.getKv('last_sales_pull');
    if (!mounted) return;
    setState(() {
      _custody = c;
      _lastPull = pull;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('عهدة الكوبونات')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  Card(
                    color: const Color(0xFFF3F8FB),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                          'العهدة بتتحدّث مع «مزامنة». اللي كتبته على فواتير لسه على '
                          'الجهاز متشال من المتاح.'
                          '${_lastPull == null ? '' : '\nآخر تحديث: '
                              '${_lastPull!.substring(0, 16).replaceAll('T', ' ')}'}',
                          style: const TextStyle(fontSize: 12.5, color: Colors.black87)),
                    ),
                  ),
                  if (!_custody.known)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                          'مافيش عهدة كوبونات على الجهاز.\n'
                          'لو المكتب سلّمك دفاتر، اعمل «مزامنة» عشان تنزل.',
                          textAlign: TextAlign.center),
                    )
                  else
                    for (final k in _custody.kinds) _kindCard(k),
                ],
              ),
            ),
    );
  }

  Widget _kindCard(String kind) {
    final free = _custody.availableOf(kind);
    final n = totalCount(free);
    // المحجوز جوّه العهدة بس — المتاح + المحجوز = العهدة، والرقمين يتجمعوا صح.
    final held = totalCount(intersectRanges(_custody.custodyOf(kind),
        _custody.holdsOf(kind).map((h) => h.range)));
    return Card(
      margin: const EdgeInsets.only(top: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.confirmation_number_outlined,
                    color: AppColors.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(kind,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 16)),
                ),
                Text('$n',
                    style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: n <= 0 ? AppColors.danger : AppColors.primary)),
                const SizedBox(width: 4),
                const Text('متاح',
                    style: TextStyle(fontSize: 12, color: Colors.black54)),
              ],
            ),
            const SizedBox(height: 8),
            // المدايات كلها هنا مش أول تلاتة — دي الشاشة اللي بيرجع لها عشان يعرف بالظبط.
            Text(
                free.isEmpty
                    ? 'مافيش سريالات متاحة في الفئة دي'
                    : free.map((r) => r.label).join('، '),
                style: const TextStyle(fontSize: 13.5)),
            if (held > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('محجوز لفواتير لسه على الجهاز: $held',
                    style: const TextStyle(fontSize: 12, color: Colors.black54)),
              ),
          ],
        ),
      ),
    );
  }
}
