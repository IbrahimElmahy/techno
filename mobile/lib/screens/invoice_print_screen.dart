import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

/// طباعة الفاتورة من الموبايل — ورقة للعميل، أو PDF يتبعت واتساب.
///
/// المندوب بيسيب ورقة عند العميل. من غير الشاشة دي كان بيكتبها بإيده، أو العميل بيستنى
/// لحد ما المكتب يطبعها ويبعتها — والفاتورة اللي بتوصل بعد أسبوع مش إيصال، دي تذكير.
///
/// **الورقة بتتبني من اللي على الجهاز، مش من السيرفر.** يعني بتشتغل والفاتورة لسه في
/// الطابور. ولو اترفعت، رقم المستند الحقيقي بيتكتب عليها؛ ولو لسه، بتقول «مسودّة — لسه
/// ما اترفعتش» بدل ما تدّعي رقم مالوش وجود.
///
/// والخط: `printing` بيرسم PDF بخطوطه هو، واللي فيها مافيهاش عربي — فالحروف بتطلع مربعات.
/// عشان كده الخط بيتحمّل من ملفات التطبيق نفسه (نفس Cairo اللي الشاشة بتستعمله).
class InvoicePrintScreen extends StatefulWidget {
  final Map<String, Object?> invoice;

  const InvoicePrintScreen({super.key, required this.invoice});

  @override
  State<InvoicePrintScreen> createState() => _InvoicePrintScreenState();
}

class _InvoicePrintScreenState extends State<InvoicePrintScreen> {
  List<SaleDraftLine> _lines = [];
  String _rep = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final lines = await LocalDb.instance.saleInvoiceLines(widget.invoice['local_id'] as int);
    final rep = await LocalDb.instance.getKv('username') ?? '';
    if (mounted) setState(() { _lines = lines; _rep = rep; _loading = false; });
  }

  @override
  Widget build(BuildContext context) {
    final inv = widget.invoice;
    final synced = (inv['synced'] as int?) == 1;
    final title = synced ? (inv['document_number'] as String? ?? 'فاتورة') : 'مسودّة فاتورة';
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : PdfPreview(
              build: (format) => _buildPdf(format),
              canChangeOrientation: false,
              canChangePageFormat: false,
              canDebug: false,
              pdfFileName: '${synced ? inv['document_number'] : 'invoice'}.pdf',
              actionBarTheme: const PdfActionBarTheme(
                backgroundColor: AppColors.primary,
                textStyle: TextStyle(color: Colors.white),
              ),
            ),
    );
  }

  Future<Uint8List> _buildPdf(PdfPageFormat format) async {
    final inv = widget.invoice;
    final synced = (inv['synced'] as int?) == 1;
    final doc = pw.Document();

    // الخط العربي من ملفات التطبيق. لو مش موجود لأي سبب، بنكمّل بخط `printing` الافتراضي
    // بدل ما الطباعة تقع — ورقة بحروف وحشة أحسن من مفيش ورقة خالص.
    // ملف واحد (`Cairo.ttf`) هو اللي في التطبيق، فهو الأساسي والتقيل مع بعض: التقيل
    // بيتعمل بالسُمك اللي في نفس الملف. والاحتياطي بيحمّل من الشبكة لو الملف ضاع لأي سبب.
    pw.Font arabic;
    try {
      arabic = pw.Font.ttf(await rootBundle.load('assets/fonts/Cairo.ttf'));
    } catch (_) {
      arabic = await PdfGoogleFonts.cairoRegular();
    }

    final theme = pw.ThemeData.withFont(base: arabic, bold: arabic);
    final total = (inv['total'] as num?)?.toDouble() ?? 0;
    final cash = (inv['cash_amount'] as num?)?.toDouble() ?? 0;
    final credit = (inv['credit_amount'] as num?)?.toDouble() ?? 0;

    doc.addPage(
      pw.Page(
        pageFormat: format,
        theme: theme,
        textDirection: pw.TextDirection.rtl,
        build: (ctx) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            pw.Center(
              child: pw.Column(children: [
                pw.Text('تكنو ثيرم',
                    style: const pw.TextStyle(
                        fontSize: 22, fontWeight: pw.FontWeight.bold)),
                pw.Text('فاتورة بيع', style: const pw.TextStyle(fontSize: 13)),
              ]),
            ),
            pw.SizedBox(height: 10),
            // المسودّة بتقول عن نفسها إنها مسودّة. الورقة اللي بتدّعي رقم مستند مالوش وجود
            // بتبقى مشكلة يوم ما حد يدوّر عليه.
            if (!synced)
              pw.Container(
                padding: const pw.EdgeInsets.all(6),
                decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.8)),
                child: pw.Text('مسودّة — لسه ما اترفعتش على النظام',
                    textAlign: pw.TextAlign.center,
                    style: const pw.TextStyle(fontSize: 11)),
              ),
            pw.SizedBox(height: 8),
            _row('رقم المستند', synced ? '${inv['document_number']}' : '—'),
            _row('التاريخ', '${inv['invoice_date']}'),
            _row('العميل', '${inv['customer_name']}'),
            _row('المندوب', _rep),
            pw.SizedBox(height: 10),
            pw.Table(
              border: pw.TableBorder.all(width: 0.5),
              columnWidths: {
                0: const pw.FlexColumnWidth(3.6),
                1: const pw.FlexColumnWidth(1.2),
                2: const pw.FlexColumnWidth(1.6),
                3: const pw.FlexColumnWidth(1.2),
                4: const pw.FlexColumnWidth(1.2),
                5: const pw.FlexColumnWidth(1.8),
              },
              children: [
                pw.TableRow(
                  decoration: const pw.BoxDecoration(color: PdfColors.grey300),
                  children: [
                    _cell('الصنف', bold: true),
                    _cell('الكمية', bold: true),
                    _cell('السعر', bold: true),
                    // الخصمين منفصلين على الورقة كمان: العميل بيشوف خصم الشركة وخصم
                    // المندوب، والمراجعة بتعرف مين خصم كام.
                    _cell('خصم ثابت', bold: true),
                    _cell('خصم إضافي', bold: true),
                    _cell('الإجمالي', bold: true),
                  ],
                ),
                for (final l in _lines)
                  pw.TableRow(children: [
                    _cell(l.itemName),
                    _cell(_trim(l.quantity)),
                    _cell(_money(l.unitPrice)),
                    _cell(l.fixedDiscountPct > 0 ? '${_trim(l.fixedDiscountPct)}%' : '—'),
                    _cell(l.variableDiscountPct > 0
                        ? '${_trim(l.variableDiscountPct)}%'
                        : '—'),
                    _cell(_money(l.net)),
                  ]),
              ],
            ),
            pw.SizedBox(height: 12),
            _total('إجمالي الفاتورة', _money(total), big: true),
            _total('المدفوع نقداً', _money(cash)),
            _total('الباقي على العميل', _money(credit)),
            if ((inv['notes'] as String?)?.isNotEmpty == true) ...[
              pw.SizedBox(height: 10),
              pw.Text('ملاحظات: ${inv['notes']}', style: const pw.TextStyle(fontSize: 10)),
            ],
            pw.Spacer(),
            pw.Divider(),
            pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Text('توقيع المستلم: ____________', style: const pw.TextStyle(fontSize: 10)),
                pw.Text('توقيع المندوب: ____________', style: const pw.TextStyle(fontSize: 10)),
              ],
            ),
          ],
        ),
      ),
    );
    return doc.save();
  }
}

pw.Widget _row(String label, String value) => pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
      child: pw.Row(children: [
        pw.SizedBox(
          width: 80,
          child: pw.Text('$label:',
              style: const pw.TextStyle(
                  fontSize: 11, fontWeight: pw.FontWeight.bold)),
        ),
        pw.Expanded(child: pw.Text(value, style: const pw.TextStyle(fontSize: 11))),
      ]),
    );

pw.Widget _cell(String text, {bool bold = false}) => pw.Padding(
      padding: const pw.EdgeInsets.all(4),
      child: pw.Text(text,
          style: pw.TextStyle(
              fontSize: 10, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
    );

pw.Widget _total(String label, String value, {bool big = false}) => pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 2),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(label, style: pw.TextStyle(fontSize: big ? 13 : 11)),
          pw.Text('$value ج.م',
              style: pw.TextStyle(
                  fontSize: big ? 16 : 12,
                  fontWeight: big ? pw.FontWeight.bold : pw.FontWeight.normal)),
        ],
      ),
    );

String _trim(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}

String _money(num v) => v.toStringAsFixed(2);
