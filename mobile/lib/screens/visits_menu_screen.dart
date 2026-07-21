import 'package:flutter/material.dart';

import '../theme.dart';
import 'inspection_form_screen.dart';
import 'regular_visit_form_screen.dart';

class VisitsMenuScreen extends StatelessWidget {
  const VisitsMenuScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('الزيارات')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _VisitCard(
            icon: Icons.engineering,
            color: AppColors.primary,
            title: 'زيارات الفنيين (معاينات)',
            subtitle: 'معاينة موقع مع فني وتسجيل الأصناف والنقاط',
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const InspectionFormScreen(visitKind: 'technician'))),
          ),
          const SizedBox(height: 14),
          _VisitCard(
            icon: Icons.home_work_outlined,
            color: AppColors.success,
            title: 'الزيارات العادية',
            subtitle: 'زيارة متابعة أو زيارة عميل بدون فني',
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const RegularVisitFormScreen())),
          ),
        ],
      ),
    );
  }
}

class _VisitCard extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _VisitCard(
      {required this.icon,
      required this.color,
      required this.title,
      required this.subtitle,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 38, color: color),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style:
                            const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(subtitle,
                        style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left, color: Colors.grey),
            ],
          ),
        ),
      ),
    );
  }
}
