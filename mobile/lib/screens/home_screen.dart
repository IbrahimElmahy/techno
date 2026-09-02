import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../services/auto_sync.dart';
import '../theme.dart';
import 'login_screen.dart';
import 'coupon_receipt_screen.dart';
import 'sale_invoice_screen.dart';
import 'collect_cash_screen.dart';
import 'customer_profile_screen.dart';
import 'debts_screen.dart';
import 'day_summary_screen.dart';
import 'my_stock_screen.dart';
import 'transfer_request_screen.dart';
import 'sales_review_screen.dart';
import 'coupon_review_screen.dart';
import 'review_screen.dart';
import 'sync_screen.dart';
import 'visits_menu_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _username = '';
  int _pending = 0;
  /// فواتير لسه على الجهاز — بتبان في نفس مكان المعاينات المستنية.
  int _pendingSales = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
    AutoSync.instance.addListener(_onSync);
    // **المزامنة بتحصل لوحدها أول ما الشاشة تفتح** — لو فيه نت وآخر واحدة بقى لها
    // شوية. المندوب ماكانش لازم يفتكر: اللي بينسى بيفتح الفاتورة ويلاقيها ناقصة.
    // مافيش `await`: الشاشة بتترسم على طول والعلامة فوق بتقول إنها شغالة.
    AutoSync.instance.maybeRun();
  }

  void _onSync() {
    if (!mounted) return;
    setState(() {});
    // خلص؟ يبقى الأرقام اللي على الشاشة (المستنّي في الطابور) اتغيّرت.
    if (AutoSync.instance.state == AutoSyncState.done) _refresh();
  }

  @override
  void dispose() {
    AutoSync.instance.removeListener(_onSync);
    super.dispose();
  }

  Future<void> _refresh() async {
    final u = await LocalDb.instance.getKv('username') ?? '';
    final p = await LocalDb.instance.pendingCount();
    final ps = await LocalDb.instance.pendingSalesCount();
    if (mounted) {
      setState(() {
        _username = u;
        _pending = p;
        _pendingSales = ps;
      });
    }
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('تسجيل الخروج'),
        content: _pending > 0
            ? Text('في $_pending معاينة لسه ما اتزامنتش — هتفضل محفوظة على الجهاز.')
            : const Text('متأكد إنك عايز تخرج؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('خروج')),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    await (await LocalDb.instance.db).delete('kv', where: 'key = ?', whereArgs: ['token']);
    if (!mounted) return;
    Navigator.of(context)
        .pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: _buildDrawer(),
      body: RefreshIndicator(
        // السحب لتحت بيزامن كمان، مش بيعيد رسم الأرقام بس — ده اللي أي حد بيتوقعه
        // من الحركة دي، وبيدّي المندوب طريقة يجبر بيها التحديث من غير ما يدخل شاشة.
        onRefresh: () async {
          await AutoSync.instance.maybeRun(force: true);
          await _refresh();
        },
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              expandedHeight: 190,
              pinned: true,
              flexibleSpace: FlexibleSpaceBar(
                background: Container(
                  decoration: const BoxDecoration(gradient: AppColors.headerGradient),
                  child: SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          // اللوجو نفسه، مش اسم مكتوب.
                          //
                          // The mark is green and orange on transparency, and its «GERMAN
                          // TECHNOLOGY» line is near-black — dropped straight onto the blue it
                          // reads as a smudge. Same white plate the splash uses, so the two
                          // screens carry the brand identically.
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.16),
                                  blurRadius: 14,
                                  offset: const Offset(0, 6),
                                ),
                              ],
                            ),
                            child: Image.asset(
                              'assets/images/technotherm_logo.png',
                              height: 46,
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) => const Text('تكنو ثيرم',
                                  style: TextStyle(
                                      fontSize: 22,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.primary)),
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text('أهلاً $_username 👋',
                              style: const TextStyle(fontSize: 15, color: Colors.white70)),
                        ],
                      ),
                    ),
                  ),
                ),
                // أبيض صريح: العنوان بياخد لون النص الافتراضي (غامق)، وهو قاعد على تدرّج
                // أزرق — فكان بيتقرا بالعافية.
                title: const Text('المعاينات',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
              ),
            ),
            // شريط المزامنة — بيلف طول ما شغّالة، وبيقول النتيجة بعدها.
            //
            // المزامنة الصامتة أوحش من مافيش مزامنة: الواحد مايعرفش لو اللي شايفه
            // جديد ولا بايت من امبارح. الشريط ده هو الفرق.
            SliverToBoxAdapter(child: _SyncBanner(onRetry: () {
              AutoSync.instance.run();
            })),
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  if (_pending > 0)
                    Card(
                      color: const Color(0xFFFFF6E5),
                      child: ListTile(
                        leading: const Icon(Icons.cloud_upload_outlined,
                            color: AppColors.accent, size: 30),
                        title: Text('$_pending معاينة مستنية المزامنة'),
                        subtitle: const Text('اضغط للمزامنة مع السيرفر'),
                        trailing: const Icon(Icons.chevron_left),
                        onTap: () async {
                          await Navigator.push(context,
                              MaterialPageRoute(builder: (_) => const SyncScreen()));
                          _refresh();
                        },
                      ),
                    ),
                  const SizedBox(height: 8),
                  // البيع فوق: ده اللي بيتعمل كل يوم، والمعاينة بتحصل لما تحصل.
                  _BigAction(
                    icon: Icons.receipt_long_outlined,
                    color: AppColors.success,
                    title: 'فاتورة بيع',
                    subtitle: 'بيع لعملائك من اللي في العربية',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const SaleInvoiceScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.receipt_outlined,
                    color: AppColors.primary,
                    title: 'فواتيري',
                    subtitle: _pendingSales > 0
                        ? '$_pendingSales فاتورة لسه ما اترفعتش'
                        : 'الفواتير المسجلة على الجهاز',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const SalesReviewScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.payments_outlined,
                    color: AppColors.accent,
                    title: 'تحصيل من عميل',
                    subtitle: 'سند قبض — بيتحفظ ويترفع زي الفاتورة',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const CollectCashScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.local_shipping_outlined,
                    color: AppColors.primary,
                    title: 'بضاعتي',
                    subtitle: 'اللي في العربية دلوقتي بكمياته',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const MyStockScreen())),
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.swap_horiz_outlined,
                    color: AppColors.accent,
                    title: 'طلب تحويل بضاعة',
                    subtitle: 'من مخزن لمخزن أو من عربيتك — بيستنى الاعتماد',
                    onTap: () async {
                      await Navigator.push(context, MaterialPageRoute(
                          builder: (_) => const TransferRequestScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  // كشف المديونيات قبل «حساب عميل»: الأول بيجاوب «أروح لمين»،
                  // والتاني بيجاوب «الراجل ده عليه إيه» — والسؤال الأول بيتسأل
                  // الصبح والتاني وهو واقف قدامه.
                  _BigAction(
                    icon: Icons.receipt_long_outlined,
                    color: AppColors.danger,
                    title: 'كشف المديونيات',
                    subtitle: 'مين عليه كام — أبيض وبولي، بيشتغل من غير نت',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const DebtsScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.account_balance_wallet_outlined,
                    color: AppColors.success,
                    title: 'حساب عميل',
                    subtitle: 'رصيده وآخر حركته — محتاج شبكة',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const CustomerProfileScreen())),
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.insights_outlined,
                    color: AppColors.accent,
                    title: 'ملخّص اليوم',
                    subtitle: 'بعت بكام وحصّلت كام',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const DaySummaryScreen())),
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.assignment_add,
                    color: AppColors.primary,
                    title: 'الزيارات',
                    subtitle: 'تسجيل معاينة فنيين أو زيارة عادية',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const VisitsMenuScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.confirmation_number_outlined,
                    color: AppColors.accent,
                    title: 'استلام كوبونات',
                    subtitle: 'استلام كوبونات العميل والتأكد من صلاحيتها',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const CouponReceiptScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.summarize_outlined,
                    color: AppColors.primary,
                    title: 'مراجعة الكوبونات',
                    subtitle: 'الإجمالي لكل عميل بالنوع — من الجهاز',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const CouponReviewScreen())),
                  ),
                  const SizedBox(height: 14),
                  _BigAction(
                    icon: Icons.fact_check_outlined,
                    color: AppColors.success,
                    title: 'مراجعة الزيارات',
                    subtitle: 'استعراض المعاينات المسجلة بالتاريخ',
                    onTap: () async {
                      await Navigator.push(
                          context, MaterialPageRoute(builder: (_) => const ReviewScreen()));
                      _refresh();
                    },
                  ),
                ]),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Drawer _buildDrawer() {
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          DrawerHeader(
            decoration: const BoxDecoration(gradient: AppColors.headerGradient),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                const Icon(Icons.plumbing, color: Colors.white, size: 40),
                const SizedBox(height: 8),
                Text(_username,
                    style: const TextStyle(color: Colors.white, fontSize: 18)),
                const Text('مندوب معاينات',
                    style: TextStyle(color: Colors.white70, fontSize: 13)),
              ],
            ),
          ),
          ListTile(
            leading: const Icon(Icons.sync),
            title: const Text('مزامنة البيانات'),
            onTap: () async {
              Navigator.pop(context);
              await Navigator.push(
                  context, MaterialPageRoute(builder: (_) => const SyncScreen()));
              _refresh();
            },
          ),
          ListTile(
            leading: const Icon(Icons.download_outlined),
            title: const Text('تحديث الأصناف والقوائم'),
            onTap: () async {
              Navigator.pop(context);
              final messenger = ScaffoldMessenger.of(context);
              try {
                await ApiClient.instance.pullReferenceData();
                // **وأصناف العربية كمان.** الزرار ده كان بيسحب الكتالوج والقوائم بس
                // ويقول «تم تحديث الأصناف ✔» — وأصناف عربية المندوب (اللي بيبيع منها)
                // مابتتحدّثش هنا خالص، هي بتنزل مع حزمة البيع. فالمندوب يضغط، يشوف
                // علامة الصح، يفتح الفاتورة ويلاقيها فاضية. الزرار بيقول «الأصناف»
                // فلازم يجيب الأصناف اللي هو قاصدها.
                var mine = 0;
                try {
                  await ApiClient.instance.pullSalesBundle();
                  mine = (await LocalDb.instance.saleItems()).length;
                } on ApiException catch (e) {
                  if (e.statusCode != 403) rethrow; // ٤٠٣ = مش مندوب، عادي
                }
                messenger.showSnackBar(SnackBar(
                    content: Text(mine > 0
                        ? 'اتحدثت القوائم و$mine صنف في عربيتك ✔'
                        : 'تم تحديث القوائم ✔ — مافيش أصناف في عربيتك')));
              } catch (e) {
                messenger.showSnackBar(SnackBar(content: Text('فشل التحديث: $e')));
              }
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: AppColors.danger),
            title: const Text('تسجيل الخروج'),
            onTap: () {
              Navigator.pop(context);
              _logout();
            },
          ),
        ],
      ),
    );
  }
}

class _BigAction extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _BigAction(
      {required this.icon,
      required this.color,
      required this.title,
      required this.subtitle,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, size: 36, color: color),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style:
                            const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(subtitle,
                        style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left, color: Colors.grey),
            ],
          ),
        ),
      ),
    );
  }
}

/// شريط حالة المزامنة اللي بتحصل لوحدها.
///
/// بيلف طول ما شغّالة، وبيقول اتحدّث إيه لما تخلص، وبيدّي «حاول تاني» لو فشلت. بيختفي
/// لوحده بعد النجاح — الرسالة اتقرت، ومافيش داعي تفضل واخدة مكان.
class _SyncBanner extends StatefulWidget {
  const _SyncBanner({required this.onRetry});
  final VoidCallback onRetry;

  @override
  State<_SyncBanner> createState() => _SyncBannerState();
}

class _SyncBannerState extends State<_SyncBanner> {
  @override
  void initState() {
    super.initState();
    AutoSync.instance.addListener(_tick);
  }

  @override
  void dispose() {
    AutoSync.instance.removeListener(_tick);
    super.dispose();
  }

  void _tick() {
    if (!mounted) return;
    setState(() {});
    if (AutoSync.instance.state == AutoSyncState.done) {
      // الرسالة الناجحة بتقعد أربع ثواني وتمشي. الفشل بيفضل — ده اللي محتاج قرار.
      Future.delayed(const Duration(seconds: 4), () {
        if (mounted && AutoSync.instance.state == AutoSyncState.done) {
          AutoSync.instance.clear();
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final sync = AutoSync.instance;
    if (sync.state == AutoSyncState.idle) return const SizedBox.shrink();

    final running = sync.state == AutoSyncState.running;
    final failed = sync.state == AutoSyncState.failed;
    final bg = running
        ? const Color(0xFFE8F1FB)
        : failed
            ? const Color(0xFFFDECEA)
            : const Color(0xFFE9F7EF);
    final fg = running
        ? AppColors.primary
        : failed
            ? AppColors.danger
            : AppColors.success;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: fg.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          if (running)
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2.2, color: fg),
            )
          else
            Icon(failed ? Icons.cloud_off_outlined : Icons.cloud_done_outlined,
                size: 20, color: fg),
          const SizedBox(width: 10),
          Expanded(
            child: Text(sync.message ?? '',
                style: TextStyle(
                    fontSize: 13.5, fontWeight: FontWeight.w600, color: fg)),
          ),
          if (failed)
            TextButton(
                onPressed: widget.onRetry,
                style: TextButton.styleFrom(
                    foregroundColor: fg, padding: EdgeInsets.zero),
                child: const Text('حاول تاني')),
        ],
      ),
    );
  }
}
