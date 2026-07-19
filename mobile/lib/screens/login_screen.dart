import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../theme.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
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
      // First pull of catalog + lookups so the rep can work offline right away.
      try {
        await ApiClient.instance.pullReferenceData();
      } catch (_) {/* offline pull can happen later from settings */}
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
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.plumbing, size: 64, color: Colors.white),
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
                          const SizedBox(height: 20),
                          FilledButton.icon(
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
    );
  }
}
