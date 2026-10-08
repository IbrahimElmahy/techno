import 'package:flutter/material.dart';

import '../db/local_db.dart';
import '../theme.dart';
import 'inspection_drafts_screen.dart';
import 'inspection_form_screen.dart';
import 'regular_visit_form_screen.dart';

class VisitsMenuScreen extends StatefulWidget {
  const VisitsMenuScreen({super.key});

  @override
  State<VisitsMenuScreen> createState() => _VisitsMenuScreenState();
}

class _VisitsMenuScreenState extends State<VisitsMenuScreen> {
  int _drafts = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final n = await LocalDb.instance.inspectionDraftsCount();
    if (mounted) setState(() => _drafts = n);
  }

  Future<void> _go(Widget screen) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
    await Future<void>.delayed(const Duration(milliseconds: 150));
    _refresh();
  }

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
            onTap: () => _go(const InspectionFormScreen(visitKind: 'technician')),
          ),
          if (_drafts > 0) ...[
            const SizedBox(height: 14),
            _VisitCard(
              icon: Icons.edit_note,
              color: AppColors.accent,
              title: 'مسودات المعاينات',
              subtitle: '$_drafts معاينة لم تُحفظ بعد',
              onTap: () => _go(const InspectionDraftsScreen()),
            ),
          ],
          const SizedBox(height: 14),
          _VisitCard(
            icon: Icons.home_work_outlined,
            color: AppColors.success,
            title: 'الزيارات العادية',
            onTap: () => _go(const RegularVisitFormScreen()),
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
  final String? subtitle;
  final VoidCallback onTap;

  const _VisitCard(
      {required this.icon,
      required this.color,
      required this.title,
      this.subtitle,
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
                  color: color.withValues(alpha: 0.1),
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
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(subtitle!,
                          style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                    ],
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
