import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../theme.dart';
import 'home_screen.dart';
import 'login_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late AnimationController _animCtrl;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _animCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _fadeAnim = CurvedAnimation(parent: _animCtrl, curve: Curves.easeIn);
    _animCtrl.forward();
    _checkNextScreen();
  }

  Future<void> _checkNextScreen() async {
    await Future.delayed(const Duration(seconds: 2));
    String? token;
    try {
      token = await LocalDb.instance.getKv('token').timeout(
        const Duration(seconds: 2),
        onTimeout: () => null,
      );
    } catch (_) {}

    if (!mounted) return;
    final bool isLoggedIn = token != null && token.trim().isNotEmpty;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => isLoggedIn ? const MainNavigationContainer() : const LoginScreen()),
    );
  }

  @override
  void dispose() {
    _animCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FB),
      body: SafeArea(
        child: FadeTransition(
          opacity: _fadeAnim,
          child: Column(
            children: [
              const Spacer(),
              Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Elevated Logo Card
                    Container(
                      width: 220,
                      height: 220,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(24),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.06),
                            blurRadius: 20,
                            offset: const Offset(0, 8),
                          )
                        ],
                      ),
                      child: Image.asset(
                        'assets/images/technotherm_logo_original.png',
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) => Image.asset(
                          'assets/images/technotherm_logo.png',
                          fit: BoxFit.contain,
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),

                    // Title
                    const Text(
                      'TechnoTherm',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        fontFamily: 'serif',
                        color: AppColors.ink,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 12),

                    // German Technology Pill Badge
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEFF1F3),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'GERMAN TECHNOLOGY',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF374151),
                              letterSpacing: 1.2,
                            ),
                          ),
                          SizedBox(width: 6),
                          Icon(Icons.verified, color: AppColors.primary, size: 16),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),

              // Bottom Loader & Version
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 24),
                child: Column(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: const LinearProgressIndicator(
                        valueColor: AlwaysStoppedAnimation<Color>(AppColors.primary),
                        backgroundColor: Color(0xFFE5E7EB),
                        minHeight: 4,
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'V 2.4.1',
                      style: TextStyle(fontSize: 12, color: Color(0xFF9CA3AF), fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
