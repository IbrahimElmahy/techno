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
              // أيقونات الشريط الافتراضية اتشالت — الطباعة والإرسال بقوا زرارين
              // بأسمائهم تحت. أيقونة من غير اسم بتتلمس بالتجربة، وده مش وقتها:
              // المندوب واقف والعميل مستني الورقة.
              useActions: false,
              pdfFileName: '${synced ? inv['document_number'] : 'invoice'}.pdf',
            ),
      bottomNavigationBar: _loading
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () async {
                          await Printing.layoutPdf(
                              onLayout: (f) => _buildPdf(f),
                              name: '$title.pdf');
                        },
                        icon: const Icon(Icons.print_outlined),
                        label: const Text('طباعة'),
                        style: FilledButton.styleFrom(
                            minimumSize: const Size.fromHeight(48)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () async {
                          // بتفتح شاشة المشاركة بتاعت النظام — واتساب وغيره.
                          await Printing.sharePdf(
                              bytes: await _buildPdf(PdfPageFormat.a4),
                              filename: '$title.pdf');
                        },
                        icon: const Icon(Icons.share_outlined),
                        label: const Text('إرسال'),
                        style: FilledButton.styleFrom(
                            backgroundColor: AppColors.success,
                            minimumSize: const Size.fromHeight(48)),
                      ),
                    ),
                  ],
                ),
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
    final family = inv['family'] as String?;
    final now = DateTime.now().toIso8601String();
    final printedAt = '${now.substring(0, 10)} ${now.substring(11, 16)}';

    doc.addPage(
      pw.Page(
        pageFormat: format,
        theme: theme,
        textDirection: pw.TextDirection.rtl,
        build: (ctx) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            // ترويسة بلون النظام — الورقة اللي بتوصل واتساب لازم تتعرف من أول نظرة
            // إنها بتاعت مين، مش سطر أسود على أبيض زي أي إيصال.
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: pw.BoxDecoration(
                color: _brand,
                borderRadius: pw.BorderRadius.circular(6),
              ),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                crossAxisAlignment: pw.CrossAxisAlignment.center,
                children: [
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text('تكنو ثيرم',
                          style: const pw.TextStyle(
                              fontSize: 20,
                              fontWeight: pw.FontWeight.bold,
                              color: PdfColors.white)),
                      pw.Text('فاتورة بيع',
                          style: const pw.TextStyle(
                              fontSize: 11, color: PdfColors.white)),
                    ],
                  ),
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      pw.Text(synced ? '${inv['document_number']}' : 'مسودّة',
                          style: const pw.TextStyle(
                              fontSize: 15,
                              fontWeight: pw.FontWeight.bold,
                              color: PdfColors.white)),
                      pw.Text('${inv['invoice_date']}',
                          style: const pw.TextStyle(
                              fontSize: 10, color: PdfColors.white)),
                    ],
                  ),
                ],
              ),
            ),
            pw.SizedBox(height: 8),
            // المسودّة بتقول عن نفسها إنها مسودّة. الورقة اللي بتدّعي رقم مستند مالوش وجود
            // بتبقى مشكلة يوم ما حد يدوّر عليه.
            if (!synced)
              pw.Container(
                margin: const pw.EdgeInsets.only(bottom: 8),
                padding: const pw.EdgeInsets.all(6),
                decoration: pw.BoxDecoration(
                  border: pw.Border.all(width: 0.8, color: _brand),
                  borderRadius: pw.BorderRadius.circular(4),
                ),
                child: pw.Text('مسودّة — لسه ما اترفعتش على النظام',
                    textAlign: pw.TextAlign.center,
                    style: const pw.TextStyle(fontSize: 11)),
              ),
            // بيانات الفاتورة في صندوق واحد — عمودين، زي ترويسة الفاتورة على النظام.
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: pw.BoxDecoration(
                border: pw.Border.all(width: 0.6, color: PdfColors.grey500),
                borderRadius: pw.BorderRadius.circular(4),
              ),
              child: pw.Row(children: [
                pw.Expanded(
                  child: pw.Column(children: [
                    _row('العميل', '${inv['customer_name']}'),
                    _row('المندوب', _rep),
                  ]),
                ),
                pw.SizedBox(width: 12),
                pw.Expanded(
                  child: pw.Column(children: [
                    _row('نوع الفاتورة', family ?? '—'),
                    _row('التاريخ', '${inv['invoice_date']}'),
                  ]),
                ),
              ]),
            ),
            pw.SizedBox(height: 10),
            pw.Table(
              border: const pw.TableBorder(
                horizontalInside: pw.BorderSide(width: 0.4, color: PdfColors.grey400),
                bottom: pw.BorderSide(width: 0.6, color: PdfColors.grey500),
              ),
              columnWidths: {
                0: const pw.FlexColumnWidth(0.6),
                1: const pw.FlexColumnWidth(3.4),
                2: const pw.FlexColumnWidth(1.1),
                3: const pw.FlexColumnWidth(1.5),
                4: const pw.FlexColumnWidth(1.1),
                5: const pw.FlexColumnWidth(1.1),
                6: const pw.FlexColumnWidth(1.7),
              },
              children: [
                pw.TableRow(
                  decoration: const pw.BoxDecoration(color: _brand),
                  children: [
                    _cell('#', bold: true, white: true, center: true),
                    _cell('الصنف', bold: true, white: true),
                    _cell('الكمية', bold: true, white: true, center: true),
                    _cell('السعر', bold: true, white: true, center: true),
                    // الخصمين منفصلين على الورقة كمان: العميل بيشوف خصم الشركة وخصم
                    // المندوب، والمراجعة بتعرف مين خصم كام.
                    _cell('خصم ثابت', bold: true, white: true, center: true),
                    _cell('خصم إضافي', bold: true, white: true, center: true),
                    _cell('الإجمالي', bold: true, white: true, center: true),
                  ],
                ),
                for (var i = 0; i < _lines.length; i++)
                  pw.TableRow(
                    // تظليل خفيف صف ورا صف — عين بتمشي على سطر من غير ما تتوه في اللي جنبه.
                    decoration: pw.BoxDecoration(
                        color: i.isOdd ? PdfColors.grey100 : PdfColors.white),
                    children: [
                      _cell('${i + 1}', center: true),
                      _cell(_lines[i].itemName),
                      _cell(_trim(_lines[i].quantity), center: true),
                      _cell(_money(_lines[i].unitPrice), center: true),
                      _cell(
                          _lines[i].fixedDiscountPct > 0
                              ? '${_trim(_lines[i].fixedDiscountPct)}%'
                              : '—',
                          center: true),
                      _cell(
                          _lines[i].variableDiscountPct > 0
                              ? '${_trim(_lines[i].variableDiscountPct)}%'
                              : '—',
                          center: true),
                      _cell(_money(_lines[i].net), center: true, bold: true),
                    ],
                  ),
              ],
            ),
            pw.SizedBox(height: 12),
            // الإجماليات في صندوق على الشمال — نفس سلم النظام، والباقي هو الرقم الكبير.
            pw.Row(children: [
              pw.Expanded(child: pw.SizedBox()),
              pw.Container(
                width: 230,
                padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: pw.BoxDecoration(
                  border: pw.Border.all(width: 0.6, color: PdfColors.grey500),
                  borderRadius: pw.BorderRadius.circular(4),
                ),
                child: pw.Column(children: [
                  _total('إجمالي الفاتورة', _money(total)),
                  _total('المدفوع نقداً', _money(cash)),
                  pw.Divider(height: 8, color: PdfColors.grey400),
                  _total('الباقي على العميل', _money(credit), big: true),
                ]),
              ),
            ]),
            if ((inv['notes'] as String?)?.isNotEmpty == true) ...[
              pw.SizedBox(height: 10),
              pw.Text('ملاحظات: ${inv['notes']}', style: const pw.TextStyle(fontSize: 10)),
            ],
            pw.Spacer(),
            pw.Divider(color: PdfColors.grey400),
            pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Text('توقيع المستلم: ____________', style: const pw.TextStyle(fontSize: 10)),
                pw.Text('توقيع المندوب: ____________', style: const pw.TextStyle(fontSize: 10)),
              ],
            ),
            pw.SizedBox(height: 4),
            pw.Text('اتطبعت من تطبيق المندوب — $printedAt',
                textAlign: pw.TextAlign.center,
                style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
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

/// لون النظام نفسه (`AppColors.primary`) — الورقة والشاشة بنفس الهوية.
const _brand = PdfColor.fromInt(0xFF0E4C6D);

pw.Widget _cell(String text, {bool bold = false, bool white = false, bool center = false}) =>
    pw.Padding(
      padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 5),
      child: pw.Text(text,
          textAlign: center ? pw.TextAlign.center : pw.TextAlign.right,
          style: pw.TextStyle(
              fontSize: 10,
              color: white ? PdfColors.white : PdfColors.black,
              fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
    );

pw.Widget _total(String label, String value, {bool big = false}) => pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 2),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(label, style: pw.TextStyle(fontSize: big ? 12 : 11)),
          pw.Text('$value ج.م',
              style: pw.TextStyle(
                  fontSize: big ? 15 : 12,
                  color: big ? _brand : PdfColors.black,
                  fontWeight: big ? pw.FontWeight.bold : pw.FontWeight.normal)),
        ],
      ),
    );

String _trim(double v) {
  final s = v.toStringAsFixed(3);
  return s.replaceFirst(RegExp(r'\.?0+$'), '');
}

String _money(num v) => v.toStringAsFixed(2);
