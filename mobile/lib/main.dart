import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:sqflite/sqflite.dart' show databaseFactory;
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

import 'db/local_db.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';
import 'services/app_updater.dart';
import 'theme.dart';
import 'widgets/task_progress_bar.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  _useTheRightDatabaseForThisPlatform();
  // فحص التحديث كل ما التطبيق يرجع من الخلفية (متقنّن جوّه `check`). أندرويد بيسيب
  // التطبيق شغّال أيام، فالفحص عند الفتح من الصفر لوحده ماكانش بيحصل تقريباً.
  AppUpdater.instance.attach();
  runApp(const TechnoInspectionsApp());
}

/// المتصفح محتاج محرّك قاعدة بيانات خاص بيه.
///
/// The browser has no sqflite plugin, so nothing sets a factory and the first database call dies
/// with «databaseFactory not initialized» — which is what the login screen showed in the browser.
/// This exists so the app can be opened and tried on a laptop.
///
/// **الموبايل مابيتلمسش هنا بقصد.** Its plugin registers its own factory. Replacing it with the
/// desktop engine — which opens the file by path instead of going through the Android plugin — is
/// what once left the app unable to open its own storage at all, «unable to open database file
/// (code 14)». So the phone falls through untouched.
void _useTheRightDatabaseForThisPlatform() {
  if (kIsWeb) databaseFactory = databaseFactoryFfiWeb;
}

class TechnoInspectionsApp extends StatelessWidget {
  const TechnoInspectionsApp({super.key, this.home});

  /// الشاشة اللي تفتح الأول — بتتبدّل في الاختبارات بس.
  ///
  /// `_Gate` reads the local database and waits out the splash, so mounting the real shell in a
  /// widget test leaves timers pending and the run fails before asserting anything. Letting the
  /// shell take its first screen means the direction, the locale and the delegates get checked as
  /// they actually ship, instead of being re-declared in the test and proving nothing.
  final Widget? home;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'تكنو ثيرم — المعاينات',
      debugShowCheckedModeBanner: false,
      // رسالة «فيه تحديث» بتطلع من خدمات مالهاش شاشة (المزامنة مثلاً) — فوق أي شاشة مفتوحة.
      navigatorKey: AppUpdater.navigatorKey,
      theme: buildTheme(),
      locale: const Locale('ar', 'EG'),
      supportedLocales: const [Locale('ar', 'EG'), Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      // الشريط اللي تحت (التحديث · المزامنة · القوائم) — فوق أي شاشة، مرة واحدة هنا.
      builder: (context, child) => Directionality(
          textDirection: TextDirection.rtl, child: TaskBarHost(child: child!)),
      home: home ?? const _Gate(),
    );
  }
}

/// Shows login when there's no saved session, otherwise straight to home (offline-friendly).
class _Gate extends StatefulWidget {
  const _Gate();

  @override
  State<_Gate> createState() => _GateState();
}

class _GateState extends State<_Gate> {
  bool? _loggedIn;

  /// أقل مدة تفضل فيها شاشة البداية ظاهرة.
  ///
  /// Reading the token is fast, so without a floor the splash would flash and vanish — which looks
  /// like the app stuttering on open. The wait runs ALONGSIDE the check, not after it: whichever
  /// finishes last decides, so the app is never held back by the animation.
  static const _minimumSplash = Duration(milliseconds: 1400);

  @override
  void initState() {
    super.initState();
    _decide();
  }

  Future<void> _decide() async {
    // Started BEFORE the wait, awaited after it — so the two overlap and the splash costs nothing
    // beyond its floor.
    final reading = LocalDb.instance.getKv('token');
    await Future<void>.delayed(_minimumSplash);
    final token = await reading;
    if (!mounted) return;
    setState(() => _loggedIn = token != null);
    // **التحديث بيتسأل عليه هنا — قبل ما نعرف داخل ولا لأ.** المندوب اللي نسخته القديمة
    // مش عارفة تدخل هو أكتر واحد محتاجه، فشاشة الدخول لازم تشوفه زي الرئيسية بالظبط.
    // العنوان معروف من هنا (المتحفوظ أو الافتراضي). مافيش `await`: الشاشة بتفتح على طول،
    // ومن غير نت السؤال بيفشل في صمت.
    WidgetsBinding.instance
        .addPostFrameCallback((_) => AppUpdater.instance.check(atStart: true));
  }

  @override
  Widget build(BuildContext context) {
    // A plain swap would cut from the splash to the next screen in one frame; the fade makes it
    // read as one screen settling into another.
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 450),
      child: _loggedIn == null
          ? const SplashScreen()
          : (_loggedIn! ? const HomeScreen() : const LoginScreen()),
    );
  }
}
