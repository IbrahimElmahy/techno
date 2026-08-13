import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:sqflite/sqflite.dart' show databaseFactory;
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

import 'db/local_db.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  _useTheRightDatabaseForThisPlatform();
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
  const TechnoInspectionsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'تكنو ثيرم — المعاينات',
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
      home: const _Gate(),
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

  @override
  void initState() {
    super.initState();
    LocalDb.instance
        .getKv('token')
        .then((t) => setState(() => _loggedIn = t != null));
  }

  @override
  Widget build(BuildContext context) {
    if (_loggedIn == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return _loggedIn! ? const HomeScreen() : const LoginScreen();
  }
}
