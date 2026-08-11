import 'package:flutter/material.dart';

/// The official TechnoTherm brand logo mark directly rendered from the company's official identity asset.
class TechnoMark extends StatelessWidget {
  final double size;
  final Color? color;

  const TechnoMark({super.key, this.size = 54, this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(size * 0.08),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(size * 0.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.12),
            blurRadius: 8,
            offset: const Offset(0, 3),
          )
        ],
      ),
      child: Image.asset(
        'assets/images/technotherm_logo.png',
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => const Icon(Icons.plumbing, color: Color(0xFF23A128)),
      ),
    );
  }
}

/// The official full TechnoTherm brand lockup displaying the official company logo image.
class TechnoLogo extends StatelessWidget {
  final double scale;
  final bool isDarkBackground;

  const TechnoLogo({
    super.key,
    this.scale = 1.0,
    this.isDarkBackground = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 14 * scale, vertical: 10 * scale),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16 * scale),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Image.asset(
        'assets/images/technotherm_logo_original.png',
        width: 180 * scale,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => Image.asset(
          'assets/images/technotherm_logo.png',
          width: 180 * scale,
          fit: BoxFit.contain,
        ),
      ),
    );
  }
}
