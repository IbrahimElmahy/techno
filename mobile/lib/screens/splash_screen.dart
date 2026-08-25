import 'package:flutter/material.dart';

import '../theme.dart';

/// شاشة البداية — بتظهر وإحنا بنتأكد من الجلسة.
///
/// The app used to open on a bare spinner on a grey background while it read the saved token. That
/// check is fast, so what a rep actually saw was a flash of nothing before the login screen —
/// which reads as the app stuttering rather than starting.
///
/// This fills that moment instead of hiding it, and it is deliberately NOT a fixed delay: it shows
/// for as long as the check takes, with a floor of [minimumShow] so it cannot flicker. The app is
/// never held back waiting for an animation to finish.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, this.minimumShow = const Duration(milliseconds: 1400)});

  /// أقل مدة تظهر فيها — عشان ماتلمعش وتختفي.
  final Duration minimumShow;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  late final AnimationController _intro = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..forward();

  // Two curves off one controller rather than two controllers: the mark settles first and the
  // words follow it, which reads as one movement instead of two things starting at once.
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
            // دواير خفيفة في الخلفية — بتدي عمق من غير ما تسحب العين.
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
                          // The logo is green and orange on transparency: it needs white behind it
                          // or it disappears into the blue.
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

/// دايرة ضوء خفيفة في الخلفية.
class _Glow extends StatelessWidget {
  const _Glow({this.top, this.bottom, this.start, this.end, required this.size});

  final double? top;
  final double? bottom;
  final double? start;
  final double? end;
  final double size;

  @override
  Widget build(BuildContext context) {
    // Directional so the decoration mirrors with the language instead of being pinned to one edge.
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
