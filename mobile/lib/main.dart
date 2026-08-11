import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

import 'db/local_db.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  if (kIsWeb) {
    databaseFactory = databaseFactoryFfiWeb;
  } else {
    try {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    } catch (_) {}
  }
  runApp(const TechnoInspectionsApp());
}

class TechnoInspectionsApp extends StatelessWidget {
  const TechnoInspectionsApp({super.key, this.home});

  /// الشاشة اللي تفتح الأول — بتتبدّل في الاختبارات بس.
  ///
  /// The splash holds a two-second timer and reads the local database, so mounting the real one in
  /// a widget test leaves timers pending and the run fails before asserting anything. Letting the
  /// shell take its first screen means the direction, the locale and the delegates can be checked
  /// as they actually ship, instead of being re-declared in the test and proving nothing.
  final Widget? home;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TechnoTherm — المعاينات',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: const Locale('ar', 'EG'),
      supportedLocales: const [Locale('ar', 'EG'), Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) =>
          Directionality(textDirection: TextDirection.rtl, child: child!),
      home: home ?? const SplashScreen(),
    );
  }
}
