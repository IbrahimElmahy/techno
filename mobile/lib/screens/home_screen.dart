import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../theme.dart';
import 'login_screen.dart';
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

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final u = await LocalDb.instance.getKv('username') ?? '';
    final p = await LocalDb.instance.pendingCount();
    if (mounted) {
      setState(() {
        _username = u;
        _pending = p;
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
              expandedHeight: 170,
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
                          const Text('تكنو ثيرم',
                              style: TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.w800,
                                  color: Colors.white)),
                          const SizedBox(height: 4),
                          Text('أهلاً $_username 👋',
                              style: const TextStyle(fontSize: 15, color: Colors.white70)),
                        ],
                      ),
                    ),
                  ),
                ),
                title: const Text('المعاينات'),
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
