import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../theme.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with SingleTickerProviderStateMixin {
  /// دخول الشاشة — اللوجو الأول والفورمة وراه.
  ///
  /// The screen arrived fully formed in one frame, right after the splash faded. Letting it settle
  /// in the same direction the splash was moving makes the two read as one opening rather than two
  /// separate screens.
  late final AnimationController _enter = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 750),
  )..forward();
  late final Animation<double> _fade =
      CurvedAnimation(parent: _enter, curve: const Interval(0.0, 0.7, curve: Curves.easeOut));
  late final Animation<Offset> _rise = Tween(
    begin: const Offset(0, 0.12),
    end: Offset.zero,
  ).animate(CurvedAnimation(parent: _enter, curve: Curves.easeOutCubic));

  final _username = TextEditingController();
  final _password = TextEditingController();
  final _server = TextEditingController();
  /// خانة السيرفر مقفولة افتراضياً — سؤال مالوش لازمة في الاستعمال العادي.
  /// بتتفتح لما العنوان محتاج يتغيّر، وده بيحصل: النشر بيتنقل والدومين بيموت،
  /// والخانة كانت جوّه التطبيق بعد الدخول — يعني ورا نفس الباب اللي هي بتفتحه.
  bool _showServer = false;
  bool _busy = false;
  bool _hide = true;
  String? _error;

  Future<void> _login() async {
    if (_username.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'اكتب اسم المستخدم وكلمة السر');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ApiClient.instance.login(_username.text.trim(), _password.text);
      // أول سحب بعد الدخول عشان المندوب يشتغل من غير شبكة على طول.
      //
      // **وحزمة البيع معاه.** `pullReferenceData` بتجيب الكتالوج والقوايم — مش أصناف
      // العربية. المندوب اللي بيدخل لأول مرة وبيفتح فاتورة كان بيلاقيها فاضية، لأن
      // اللي بيملا `sale_item` هو `pullSalesBundle` وهو مانداش غير من شاشة المزامنة.
      // الدخول لازم يخلّيه جاهز يبيع، مش يسيبه يدوّر على شاشة تانية.
      try {
        await ApiClient.instance.pullReferenceData();
      } catch (_) {/* offline pull can happen later from settings */}
      try {
        await ApiClient.instance.pullSalesBundle();
      } catch (_) {/* مش مندوب، أو مالوش مخزن — شاشة المزامنة بتقول السبب */}
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const HomeScreen()));
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _enter.dispose();
    _username.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: FadeTransition(
                opacity: _fade,
                child: SlideTransition(
                  position: _rise,
                  child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // اللوجو الحقيقي بدل أيقونة مواسير عامة.
                  //
                  // The logo is dark green and orange on a transparent background, so it needs to
                  // sit on white to read at all — on the blue it would disappear.
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    // ضغطة طويلة على اللوجو بتفتح خانة عنوان السيرفر — للدعم مش
                    // للمندوب. الزرار الظاهر كان بيتداس بالفضول والعنوان يتغيّر
                    // بالغلط، والتطبيق كله يقف بصمت.
                    child: GestureDetector(
                      onLongPress: () async {
                        if (!_showServer) {
                          _server.text = await ApiClient.instance.baseUrl();
                        }
                        setState(() => _showServer = !_showServer);
                      },
                      child: Image.asset(
                        'assets/images/technotherm_logo.png',
                        height: 72,
                        fit: BoxFit.contain,
                        // A missing asset otherwise throws a red box over the login screen; the
                        // old icon is a poor logo but a working screen.
                        errorBuilder: (_, __, ___) =>
                            const Icon(Icons.plumbing, size: 64, color: AppColors.primary),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text('تكنو ثيرم',
                      style: TextStyle(
                          fontSize: 30, fontWeight: FontWeight.w800, color: Colors.white)),
                  const Text('نظام المعاينات الميدانية',
                      style: TextStyle(fontSize: 15, color: Colors.white70)),
                  const SizedBox(height: 32),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        children: [
                          TextField(
                            controller: _username,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'اسم المستخدم',
                              prefixIcon: Icon(Icons.person_outline),
                            ),
                          ),
                          const SizedBox(height: 14),
                          TextField(
                            controller: _password,
                            obscureText: _hide,
                            onSubmitted: (_) => _login(),
                            decoration: InputDecoration(
                              labelText: 'كلمة السر',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                icon: Icon(_hide ? Icons.visibility : Icons.visibility_off),
                                onPressed: () => setState(() => _hide = !_hide),
                              ),
                            ),
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            Text(_error!,
                                style: const TextStyle(color: AppColors.danger),
                                textAlign: TextAlign.center),
                          ],
                          const SizedBox(height: 6),
                          if (_showServer)
                            TextField(
                              controller: _server,
                              keyboardType: TextInputType.url,
                              autocorrect: false,
                              decoration: const InputDecoration(
                                labelText: 'عنوان السيرفر',
                                helperText: 'https://local.technothermeg.com',
                                prefixIcon: Icon(Icons.link),
                              ),
                              onChanged: (v) {
                                final t = v.trim();
                                if (t.isEmpty) return;
                                LocalDb.instance.setKv('api_base',
                                    t.endsWith('/') ? t.substring(0, t.length - 1) : t);
                              },
                            ),
                          const SizedBox(height: 20),
                          FilledButton.icon(
                            style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(50)),
                            onPressed: _busy ? null : _login,
                            icon: _busy
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white))
                                : const Icon(Icons.login),
                            label: const Text('دخول'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
