import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:sqflite/sqflite.dart' show databaseFactory;
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

import 'db/local_db.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';
import 'services/app_updater.dart';
import 'theme.dart';
import 'widgets/session_drawer.dart';
import 'widgets/task_progress_bar.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  _useTheRightDatabaseForThisPlatform();
  AppUpdater.instance.attach();
  runApp(const TechnoInspectionsApp());
}

void _useTheRightDatabaseForThisPlatform() {
  if (kIsWeb) databaseFactory = databaseFactoryFfiWeb;
}

class TechnoInspectionsApp extends StatelessWidget {
  const TechnoInspectionsApp({super.key, this.home});

  final Widget? home;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'تكنو ثيرم — المعاينات',
      debugShowCheckedModeBanner: false,
      navigatorKey: AppUpdater.navigatorKey,
      theme: buildTheme(),
      locale: const Locale('ar', 'EG'),
      supportedLocales: const [Locale('ar', 'EG'), Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => Directionality(
          textDirection: TextDirection.rtl, child: TaskBarHost(child: child!)),
      home: home ?? const _Gate(),
    );
  }
}

class _Gate extends StatefulWidget {
  const _Gate();

  @override
  State<_Gate> createState() => _GateState();
}

class _GateState extends State<_Gate> {
  bool? _loggedIn;
  Widget? _home;

  static const _minimumSplash = Duration(milliseconds: 1400);

  @override
  void initState() {
    super.initState();
    _decide();
  }

  Future<void> _decide() async {
    final reading = LocalDb.instance.getKv('token');
    await Future<void>.delayed(_minimumSplash);
    final token = await reading;
    final home = token == null ? null : await postLoginHome();
    if (!mounted) return;
    setState(() {
      _loggedIn = token != null;
      _home = home;
    });
    WidgetsBinding.instance
        .addPostFrameCallback((_) => AppUpdater.instance.check(atStart: true));
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 450),
      child: _loggedIn == null
          ? const SplashScreen()
          : (_loggedIn! ? _home! : const LoginScreen()),
    );
  }
}
