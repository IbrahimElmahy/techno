import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'db/local_db.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const TechnoInspectionsApp());
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
