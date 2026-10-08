import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/supervisor.dart';
import '../theme.dart';
import '../utils/format.dart';
import '../widgets/session_drawer.dart';
import '../widgets/supervisor_widgets.dart';
import 'rep_activity_screen.dart';

class SupervisorHomeScreen extends StatefulWidget {
  const SupervisorHomeScreen({super.key, this.isRoot = false});

  final bool isRoot;

  @override
  State<SupervisorHomeScreen> createState() => _SupervisorHomeScreenState();
}

class _SupervisorHomeScreenState extends State<SupervisorHomeScreen> {
  SupPeriod _period = SupPeriod.of(PeriodPreset.today);
  SupOverview? _data;
  Object? _error;
  bool _loading = true;
  String _name = '';
  String? _role;

  int _req = 0;

  @override
  void initState() {
    super.initState();
    _loadUser();
    _load();
    if (widget.isRoot) {
      ApiClient.instance.refreshAppCapabilities().then((_) => _loadUser()).catchError((_) {});
    }
  }

  Future<void> _loadUser() async {
    final full = await LocalDb.instance.getKv('full_name');
    final user = await LocalDb.instance.getKv('username');
    final role = await LocalDb.instance.getKv('role');
    if (!mounted) return;
    setState(() {
      _name = (full != null && full.trim().isNotEmpty) ? full.trim() : (user ?? '');
      _role = role;
    });
  }

  Future<void> _load() async {
    final my = ++_req;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j = await ApiClient.instance.supervisorOverview(_period.fromIso, _period.toIso);
      if (!mounted || my != _req) return;
      setState(() {
        _data = SupOverview.fromJson(j);
        _loading = false;
      });
    } catch (e) {
      if (!mounted || my != _req) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  void _setPeriod(SupPeriod p) {
    setState(() {
      _period = p;
      _data = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: widget.isRoot ? _buildDrawer() : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            _header(),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 14, bottom: 4),
                child: PeriodChips(period: _period, onChanged: _setPeriod),
              ),
            ),
            if (_loading && _data != null)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: LinearProgressIndicator(minHeight: 2),
                ),
              ),
            ..._body(),
          ],
        ),
      ),
    );
  }

  List<Widget> _body() {
    final d = _data;
    if (d == null) {
      if (_error != null) {
        return [
          SliverToBoxAdapter(child: OnlineErrorView(error: _error!, onRetry: _load)),
        ];
      }
      return const [
        SliverFillRemaining(
          hasScrollBody: false,
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    return [
      if (_error != null)
        SliverToBoxAdapter(child: _staleBanner()),
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
        sliver: SliverToBoxAdapter(child: _statsGrid(d)),
      ),
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 22, 18, 6),
          child: Row(
            children: [
              const Text('المناديب',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('${d.reps.length}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, color: AppColors.primary)),
              ),
            ],
          ),
        ),
      ),
      if (d.reps.isEmpty)
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              children: [
                Icon(Icons.group_off_outlined, size: 48, color: Colors.grey.shade400),
                const SizedBox(height: 10),
                Text('لا يوجد مناديب تحت إشرافك بعد',
                    style: TextStyle(fontSize: 15, color: Colors.grey.shade700)),
              ],
            ),
          ),
        )
      else
        SliverPadding(
          padding: const EdgeInsets.only(bottom: 24),
          sliver: SliverList(
            delegate: SliverChildBuilderDelegate(
              (context, i) => _RepCard(
                rep: d.reps[i],
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => RepActivityScreen(rep: d.reps[i], period: _period),
                  ),
                ),
              ),
              childCount: d.reps.length,
            ),
          ),
        ),
    ];
  }

  Widget _staleBanner() => Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFFFDECEA),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.danger.withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            const Icon(Icons.cloud_off_outlined, size: 20, color: AppColors.danger),
            const SizedBox(width: 10),
            Expanded(
              child: Text('${friendlyError(_error!)} — هذه الأرقام من آخر تحديث',
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.danger)),
            ),
            TextButton(
              onPressed: _load,
              style: TextButton.styleFrom(
                  foregroundColor: AppColors.danger, padding: EdgeInsets.zero),
              child: const Text('حاول مرة أخرى'),
            ),
          ],
        ),
      );

  Widget _statsGrid(SupOverview d) {
    final t = d.totals;
    final tiles = <Widget>[
      StatTile(
        label: 'المبيعات',
        value: fmtMoney(t.sales),
        sub: '${t.salesCount} فاتورة',
        icon: Icons.receipt_long_outlined,
        color: AppColors.primary,
      ),
      StatTile(
        label: 'التحصيل',
        value: fmtMoney(t.collections),
        sub: '${t.collectionsCount} سند قبض',
        icon: Icons.payments_outlined,
        color: AppColors.success,
      ),
      StatTile(
        label: 'المرتجعات',
        value: fmtMoney(t.returns),
        sub: '${t.returnsCount} مرتجع',
        icon: Icons.assignment_return_outlined,
        color: AppColors.danger,
      ),
      StatTile(
        label: 'الصافي',
        value: fmtMoney(t.net),
        icon: Icons.trending_up,
        color: AppColors.primaryDark,
      ),
      StatTile(
        label: 'مديونية العملاء',
        value: fmtMoney(t.customersDebt),
        icon: Icons.account_balance_wallet_outlined,
        color: const Color(0xFFB4532A),
      ),
      StatTile(
        label: 'عدد المناديب',
        value: '${d.repsCount}',
        sub: _activeToday(d),
        icon: Icons.groups_2_outlined,
        color: AppColors.accent,
      ),
    ];
    return Column(
      children: [
        for (var i = 0; i < tiles.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 10),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tiles[i]),
                const SizedBox(width: 10),
                Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
              ],
            ),
          ),
        ],
      ],
    );
  }

  String _activeToday(SupOverview d) {
    final n = DateTime.now();
    final active = d.reps.where((r) {
      final t = r.lastActivityAt;
      return t != null && t.year == n.year && t.month == n.month && t.day == n.day;
    }).length;
    return '$active نشطون اليوم';
  }

  Widget _header() {
    final label = roleLabel(_role);
    return SliverAppBar(
      expandedHeight: 190,
      pinned: true,
      actions: [
        IconButton(
          tooltip: 'تحديث',
          icon: const Icon(Icons.refresh),
          onPressed: _loading ? null : _load,
        ),
      ],
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
                  Row(
                    children: [
                      Flexible(
                        child: Text('أهلاً $_name 👋',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 15, color: Colors.white70)),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.accent,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(label,
                            style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: Colors.black87)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        title: const Text('متابعة المناديب',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ),
    );
  }

  Drawer _buildDrawer() {
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          SessionDrawerHeader(name: _name, role: _role, icon: Icons.supervisor_account),
          ListTile(
            leading: const Icon(Icons.refresh),
            title: const Text('تحديث الأرقام'),
            onTap: () {
              Navigator.pop(context);
              _load();
            },
          ),
          const AppUpdateTile(),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: AppColors.danger),
            title: const Text('تسجيل الخروج'),
            onTap: () {
              Navigator.pop(context);
              confirmLogout(context);
            },
          ),
        ],
      ),
    );
  }
}

class _RepCard extends StatelessWidget {
  const _RepCard({required this.rep, required this.onTap});

  final SupRep rep;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = rep.stats;
    final t = rep.lastActivityAt;
    final n = DateTime.now();
    final fresh = t != null && n.difference(t).inMinutes.abs() < 60;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
          child: Column(
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 23,
                    backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                    child: Text(rep.initial,
                        style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primary)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(rep.fullName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 16.5, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: fresh ? AppColors.success : Colors.grey.shade400,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                'آخر نشاط: ${fmtRelative(t)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (rep.customersCount > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text('${rep.customersCount} عميل',
                          style: TextStyle(fontSize: 12, color: Colors.grey.shade700)),
                    ),
                  const Icon(Icons.chevron_left, color: Colors.grey),
                ],
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Expanded(
                        child: MiniStat(
                            label: 'مبيعات',
                            value: fmtMoney(s.sales),
                            color: AppColors.primary)),
                    Expanded(
                        child: MiniStat(
                            label: 'تحصيل',
                            value: fmtMoney(s.collections),
                            color: AppColors.success)),
                    Expanded(child: MiniStat(label: 'الفواتير', value: '${s.salesCount}')),
                    Expanded(
                        child: MiniStat(
                            label: 'مديونية عملائه',
                            value: fmtMoney(s.customersDebt),
                            color: const Color(0xFFB4532A))),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
