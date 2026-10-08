import 'dart:convert';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../services/auto_sync.dart';
import '../theme.dart';
import '../widgets/session_drawer.dart';
import 'coupon_custody_screen.dart';
import 'coupon_receipt_screen.dart';
import 'sale_invoice_screen.dart';
import 'bonus_invoice_screen.dart';
import 'collect_cash_screen.dart';
import 'customer_profile_screen.dart';
import 'debts_screen.dart';
import 'day_summary_screen.dart';
import 'my_stock_screen.dart';
import 'price_sheets_screen.dart';
import 'transfers_review_screen.dart';
import 'receipts_review_screen.dart';
import 'sales_review_screen.dart';
import 'coupon_review_screen.dart';
import 'review_screen.dart';
import 'supervisor_home_screen.dart';
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
  int _pendingSales = 0;
  int _pendingReceipts = 0;
  String? _role;
  Set<String>? _appCaps;

  bool _can(String cap) => _appCaps == null || _appCaps!.contains(cap);

  @override
  void initState() {
    super.initState();
    _refresh();
    AutoSync.instance.addListener(_onSync);
    _boot();
  }

  Future<void> _boot() async {
    var supervisor = await ApiClient.instance.isSupervisor();
    if (!supervisor) {
      try {
        await ApiClient.instance.refreshAppCapabilities();
        supervisor = await ApiClient.instance.isSupervisor();
      } catch (_) {}
    }
    if (!mounted) return;
    if (supervisor) {
      AutoSync.instance.clear();
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const SupervisorHomeScreen(isRoot: true)),
        (_) => false,
      );
      return;
    }
    AutoSync.instance.maybeRun();
  }

  void _onSync() {
    if (!mounted) return;
    setState(() {});
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
    final pr = await LocalDb.instance.pendingReceiptsCount();
    final role = await LocalDb.instance.getKv('role');
    final capsRaw = await LocalDb.instance.getKv('app_caps');
    Set<String>? caps;
    if (capsRaw != null && capsRaw.isNotEmpty) {
      try {
        caps = (jsonDecode(capsRaw) as List).map((e) => e.toString()).toSet();
      } catch (_) {}
    }
    if (mounted) {
      setState(() {
        _appCaps = caps;
        _role = role;
        _username = u;
        _pending = p;
        _pendingSales = ps;
        _pendingReceipts = pr;
      });
    }
  }

  Future<void> _logout() => confirmLogout(context,
      warning: _pending > 0
          ? 'في $_pending معاينة لسه ما اتزامنتش — هتفضل محفوظة على الجهاز.'
          : null);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: _buildDrawer(),
      body: RefreshIndicator(
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
                title: const Text('المعاينات',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
              ),
            ),
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
                  if (_appCaps?.contains('app.supervisor') ?? false) ...[
                    _BigAction(
                      icon: Icons.groups_2_outlined,
                      color: AppColors.primary,
                      title: 'متابعة المناديب',
                      subtitle: 'مبيعات وتحصيل كل مندوب وحركته — محتاج شبكة',
                      onTap: () => Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const SupervisorHomeScreen())),
                    ),
                    const SizedBox(height: 14),
                  ],
                  if (_can('app.sale'))
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
                  if (_can('app.bonus'))
                  _BigAction(
                    icon: Icons.card_giftcard_outlined,
                    color: AppColors.accent,
                    title: 'فاتورة بونص',
                    subtitle: 'بضاعة هدية على فاتورة بيع — خصم ١٠٠٪ ومن غير فلوس',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const BonusInvoiceScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.my_invoices'))
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
                  if (_can('app.collect'))
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
                  if (_can('app.my_collections'))
                  _BigAction(
                    icon: Icons.receipt_long_outlined,
                    color: AppColors.accent,
                    title: 'تحصيلاتي',
                    subtitle: _pendingReceipts > 0
                        ? '$_pendingReceipts سند لسه ما اترفعش'
                        : 'سندات القبض المسجلة على الجهاز',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const ReceiptsReviewScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.my_stock'))
                  _BigAction(
                    icon: Icons.local_shipping_outlined,
                    color: AppColors.primary,
                    title: 'بضاعتي',
                    subtitle: 'اللي في العربية دلوقتي بكمياته',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const MyStockScreen())),
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.price_sheet'))
                  _BigAction(
                    icon: Icons.request_quote_outlined,
                    color: AppColors.primary,
                    title: 'كشف تسعير',
                    subtitle: 'سعّر أي صنف — والشيت بيفضل محفوظ ترجعله',
                    onTap: () async {
                      await Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const PriceSheetsScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.transfers'))
                  _BigAction(
                    icon: Icons.swap_horiz_outlined,
                    color: AppColors.accent,
                    title: 'طلبات التحويل',
                    subtitle: 'اطلب بضاعة أو رجّعها — وشوف اللي طلبته وعدّله',
                    onTap: () async {
                      await Navigator.push(context, MaterialPageRoute(
                          builder: (_) => const TransfersReviewScreen()));
                      _refresh();
                    },
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.debts'))
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
                  if (_can('app.customer_account'))
                  _BigAction(
                    icon: Icons.account_balance_wallet_outlined,
                    color: AppColors.success,
                    title: 'حساب عميل',
                    subtitle: 'رصيده وآخر حركته — محتاج شبكة',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const CustomerProfileScreen())),
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.day_summary'))
                  _BigAction(
                    icon: Icons.insights_outlined,
                    color: AppColors.accent,
                    title: 'ملخّص اليوم',
                    subtitle: 'بعت بكام وحصّلت كام',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const DaySummaryScreen())),
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.visits'))
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
                  if (_can('app.coupon_receive'))
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
                  if (_can('app.coupon_review'))
                  _BigAction(
                    icon: Icons.summarize_outlined,
                    color: AppColors.primary,
                    title: 'مراجعة الكوبونات',
                    subtitle: 'الإجمالي لكل عميل بالنوع — من الجهاز',
                    onTap: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => const CouponReviewScreen())),
                  ),
                  const SizedBox(height: 14),
                  if (_can('app.visit_review'))
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
          SessionDrawerHeader(name: _username, role: _role),
          ListTile(
            leading: const Icon(Icons.sync),
            title: const Text('مزامنة الآن'),
            subtitle: _pendingSales + _pendingReceipts + _pending > 0
                ? Text('${_pendingSales + _pendingReceipts + _pending} مستند مستني الرفع')
                : null,
            onTap: () async {
              Navigator.pop(context);
              await AutoSync.instance.run();
              _refresh();
            },
          ),
          ListTile(
            leading: const Icon(Icons.download_outlined),
            title: const Text('تحديث الأصناف والقوائم'),
            onTap: () async {
              Navigator.pop(context);
              await AutoSync.instance.refreshLists();
              _refresh();
            },
          ),
          const AppUpdateTile(),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.cloud_sync_outlined),
            title: const Text('شاشة المزامنة'),
            subtitle: const Text('المستني وآخر مزامنة'),
            onTap: () async {
              Navigator.pop(context);
              await Navigator.push(
                  context, MaterialPageRoute(builder: (_) => const SyncScreen()));
              _refresh();
            },
          ),
          ListTile(
            leading: const Icon(Icons.confirmation_number_outlined),
            title: const Text('عهدة الكوبونات'),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context,
                  MaterialPageRoute(builder: (_) => const CouponCustodyScreen()));
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
    if (AutoSync.instance.state == AutoSyncState.done && !_hasWarning) {
      Future.delayed(const Duration(seconds: 4), () {
        if (mounted && AutoSync.instance.state == AutoSyncState.done) {
          AutoSync.instance.clear();
        }
      });
    }
  }

  bool get _hasWarning => AutoSync.instance.message?.contains('⚠') ?? false;

  @override
  Widget build(BuildContext context) {
    final sync = AutoSync.instance;
    if (sync.state == AutoSyncState.idle ||
        sync.state == AutoSyncState.running ||
        (sync.state == AutoSyncState.done && !_hasWarning)) {
      return const SizedBox.shrink();
    }

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
