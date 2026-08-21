import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../theme.dart';
import 'login_screen.dart';
import 'coupon_receipt_screen.dart';
import 'sale_invoice_screen.dart';
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
        onRefresh: _refresh,
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
                                  color: Colors.black.withOpacity(0.16),
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
                messenger.showSnackBar(
                    const SnackBar(content: Text('تم تحديث الأصناف والقوائم ✔')));
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
                  color: color.withOpacity(0.1),
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
