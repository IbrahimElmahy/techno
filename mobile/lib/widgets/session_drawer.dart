import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';
import '../screens/supervisor_home_screen.dart';
import '../services/app_updater.dart';
import '../theme.dart';

/// اللي مشترك بين قايمة المندوب وقايمة المشرف: اسم الدور، تحديث التطبيق، الخروج،
/// والشاشة اللي بتفتح بعد الدخول.

/// اسم الدور زي ما بيتقال — تحت الاسم في القايمة.
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

/// **الشاشة الرئيسية حسب الدور.** المشرف بيفتح على متابعة المناديب — شاشة المندوب
/// بتزامن وتسحب حزمة البيع، وده كله بيرجع ٤٠٣ لحد مالوش عربية ولا مخزن.
Future<Widget> postLoginHome() async => await ApiClient.instance.isSupervisor()
    ? const SupervisorHomeScreen(isRoot: true)
    : const HomeScreen();

/// تسجيل الخروج بعد التأكيد. [warning] بيتقال بدل «متأكد؟» لو فيه شغل مستني.
///
/// بيمسح التوكن بس — الداتا بتفضل لحد ما حد تاني يدخل (`ApiClient.login` بيحكم ده).
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

/// بيمسح التوكن ويرجع لشاشة الدخول من غير سؤال — للجلسة اللي خلصت (٤٠١).
Future<void> forgetSession(BuildContext context) async {
  await (await LocalDb.instance.db).delete('kv', where: 'key = ?', whereArgs: ['token']);
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
}

/// «تحديث التطبيق» — بيسأل السيرفر **دايماً** (مافيش تقنين ولا تأجيل) وبيقول النتيجة
/// تحت. التحديث بيتسأل عليه لوحده كمان: عند الفتح، والرجوع من الخلفية، وبعد المزامنة.
class AppUpdateTile extends StatefulWidget {
  const AppUpdateTile({super.key});

  @override
  State<AppUpdateTile> createState() => _AppUpdateTileState();
}

class _AppUpdateTileState extends State<AppUpdateTile> {
  /// «0.3.3 (6)» — أول سؤال الدعم بيسأله في التليفون.
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

/// رأس القايمة — الاسم والدور على التدرّج.
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
