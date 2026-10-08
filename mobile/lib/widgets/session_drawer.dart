import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';
import '../screens/supervisor_home_screen.dart';
import '../services/app_updater.dart';
import '../theme.dart';

String roleLabel(String? role) => switch (role) {
      ApiClient.supervisorRole => 'مشرف مناديب',
      'sales_rep' => 'مندوب',
      'owner' => 'المالك',
      'system_admin' => 'مدير النظام',
      'branch_manager' => 'مدير فرع',
      'sales_manager' => 'مدير مبيعات',
      'purchasing_manager' => 'مدير مشتريات',
      'after_sales_staff' => 'ما بعد البيع',
      'accountant' => 'محاسب',
      'viewer' => 'متابع',
      _ => 'مندوب',
    };

Future<Widget> postLoginHome() async => await ApiClient.instance.isSupervisor()
    ? const SupervisorHomeScreen(isRoot: true)
    : const HomeScreen();

Future<void> confirmLogout(BuildContext context, {String? warning}) async {
  final confirm = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text('تسجيل الخروج'),
      content: Text(warning ?? 'متأكد إنك عايز تخرج؟'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('خروج')),
      ],
    ),
  );
  if (confirm != true || !context.mounted) return;
  await forgetSession(context);
}

Future<void> forgetSession(BuildContext context) async {
  await (await LocalDb.instance.db).delete('kv', where: 'key = ?', whereArgs: ['token']);
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
}

class AppUpdateTile extends StatefulWidget {
  const AppUpdateTile({super.key});

  @override
  State<AppUpdateTile> createState() => _AppUpdateTileState();
}

class _AppUpdateTileState extends State<AppUpdateTile> {
  String? _version;

  @override
  void initState() {
    super.initState();
    AppUpdater.instance.installed().then((v) {
      if (mounted) setState(() => _version = v.label);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AppRelease?>(
      valueListenable: AppUpdater.instance.available,
      builder: (context, next, _) => ListTile(
        leading: Icon(Icons.system_update, color: next == null ? null : AppColors.accent),
        title: const Text('تحديث التطبيق'),
        subtitle: _version == null ? null : Text('الإصدار $_version'),
        trailing: next == null
            ? null
            : Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.accent,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('متاح ${next.name}',
                    style: const TextStyle(
                        color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
              ),
        onTap: () {
          Navigator.pop(context);
          AppUpdater.instance.check(manual: true);
        },
      ),
    );
  }
}

class SessionDrawerHeader extends StatelessWidget {
  const SessionDrawerHeader({super.key, required this.name, required this.role, this.icon});

  final String name;
  final String? role;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return DrawerHeader(
      decoration: const BoxDecoration(gradient: AppColors.headerGradient),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Icon(icon ?? Icons.plumbing, color: Colors.white, size: 40),
          const SizedBox(height: 8),
          Text(name, style: const TextStyle(color: Colors.white, fontSize: 18)),
          Text(roleLabel(role),
              style: const TextStyle(color: Colors.white70, fontSize: 13)),
        ],
      ),
    );
  }
}
