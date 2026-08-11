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
  _useTheRightDatabaseForThisPlatform();
  runApp(const TechnoInspectionsApp());
}

/// أنهي محرّك قاعدة بيانات يشتغل على الجهاز ده.
///
/// **The phone must keep the sqflite PLUGIN.** `databaseFactoryFfi` is the desktop engine: it opens
/// a file by path itself instead of going through the Android plugin, and on a phone that path is
/// not somewhere the app may write. What the rep saw was the login screen refusing with
/// «unable to open database file (code 14)» — the app could not open its own storage, so it could
/// do nothing at all.
///
/// It was set for every non-web platform at once, wrapped in a `catch (_) {}` that threw the
/// evidence away, so the phone silently got the desktop engine and nothing said so until an APK was
/// on a device.
void _useTheRightDatabaseForThisPlatform() {
  if (kIsWeb) {
    databaseFactory = databaseFactoryFfiWeb;
    return;
  }
  // Desktop has no sqflite plugin, so it genuinely needs the FFI engine.
  const desktop = {TargetPlatform.windows, TargetPlatform.linux, TargetPlatform.macOS};
  if (desktop.contains(defaultTargetPlatform)) {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  }
  // Android and iOS fall through on purpose: the plugin registers its own factory, and replacing
  // it is what broke them.
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
