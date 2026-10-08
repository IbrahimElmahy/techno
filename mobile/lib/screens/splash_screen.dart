import 'package:flutter/material.dart';

import '../theme.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, this.minimumShow = const Duration(milliseconds: 1400)});

  final Duration minimumShow;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  late final AnimationController _intro = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..forward();

  late final Animation<double> _markFade = CurvedAnimation(
    parent: _intro,
    curve: const Interval(0.0, 0.55, curve: Curves.easeOut),
  );
  late final Animation<double> _markScale = Tween(begin: 0.86, end: 1.0).animate(
    CurvedAnimation(parent: _intro, curve: const Interval(0.0, 0.65, curve: Curves.easeOutBack)),
  );
  late final Animation<double> _wordsFade = CurvedAnimation(
    parent: _intro,
    curve: const Interval(0.35, 1.0, curve: Curves.easeOut),
  );
  late final Animation<Offset> _wordsRise = Tween(
    begin: const Offset(0, 0.35),
    end: Offset.zero,
  ).animate(CurvedAnimation(
    parent: _intro,
    curve: const Interval(0.35, 1.0, curve: Curves.easeOutCubic),
  ));

  @override
  void dispose() {
    _intro.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: Stack(
          children: [
            const _Glow(top: -90, start: -70, size: 260),
            const _Glow(bottom: -120, end: -80, size: 320),
            SafeArea(
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Spacer(flex: 2),
                    FadeTransition(
                      opacity: _markFade,
                      child: ScaleTransition(
                        scale: _markScale,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 20),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(28),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.18),
                                blurRadius: 28,
                                offset: const Offset(0, 12),
                              ),
                            ],
                          ),
                          child: Image.asset(
                            'assets/images/technotherm_logo.png',
                            height: 92,
                            fit: BoxFit.contain,
                            errorBuilder: (_, __, ___) => const Icon(
                              Icons.plumbing,
                              size: 72,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 26),
                    FadeTransition(
                      opacity: _wordsFade,
                      child: SlideTransition(
                        position: _wordsRise,
                        child: const Column(
                          children: [
                            Text(
                              'تكنو ثيرم',
                              style: TextStyle(
                                fontSize: 30,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                                letterSpacing: 0.5,
                              ),
                            ),
                            SizedBox(height: 6),
                            Text(
                              'نظام المعاينات الميدانية',
                              style: TextStyle(fontSize: 15, color: Colors.white70),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Spacer(flex: 2),
                    FadeTransition(
                      opacity: _wordsFade,
                      child: const SizedBox(
                        width: 130,
                        child: LinearProgressIndicator(
                          minHeight: 3,
                          backgroundColor: Colors.white24,
                          valueColor: AlwaysStoppedAnimation(AppColors.accent),
                        ),
                      ),
                    ),
                    const SizedBox(height: 34),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({this.top, this.bottom, this.start, this.end, required this.size});

  final double? top;
  final double? bottom;
  final double? start;
  final double? end;
  final double size;

  @override
  Widget build(BuildContext context) {
    return PositionedDirectional(
      top: top,
      bottom: bottom,
      start: start,
      end: end,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Colors.white.withValues(alpha: 0.06),
        ),
      ),
    );
  }
}
