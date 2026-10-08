import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../db/local_db.dart';
import '../theme.dart';
import '../utils/arabic_number_words.dart';
import '../utils/pdf_share.dart';

class ReceiptPrintScreen extends StatefulWidget {
  final Map<String, Object?> receipt;

  const ReceiptPrintScreen({super.key, required this.receipt});

  @override
  State<ReceiptPrintScreen> createState() => _ReceiptPrintScreenState();
}

class _ReceiptPrintScreenState extends State<ReceiptPrintScreen> {
  String _rep = '';
  String? _phone;
  bool _loading = true;

  static const _format = PdfPageFormat.a5;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rep = await LocalDb.instance.getKv('username') ?? '';
    String? phone;
    final cid = widget.receipt['customer_id'] as int?;
    if (cid != null) {
      final all = await LocalDb.instance.customers(limit: 100000);
      for (final c in all) {
        if (c.id == cid) { phone = c.phone; break; }
      }
    }
    if (mounted) {
      setState(() {
        _rep = rep;
        _phone = phone;
        _loading = false;
      });
    }
  }

  bool get _synced => (widget.receipt['synced'] as int?) == 1;
  String get _number => '${widget.receipt['document_number'] ?? ''}'.trim();
  double get _amount => (widget.receipt['amount'] as num?)?.toDouble() ?? 0;

  @override
  Widget build(BuildContext context) {
    final r = widget.receipt;
    final title = _synced && _number.isNotEmpty ? _number : 'سند قبض';
    final customer = safeFileName('${r['customer_name'] ?? ''}');
    final fileTitle = customer.isNotEmpty ? customer : 'سند قبض';
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : PdfPreview(
              build: (format) => _buildPdf(format),
              initialPageFormat: _format,
              canChangeOrientation: false,
              canChangePageFormat: false,
              canDebug: false,
              useActions: false,
              pdfFileName: '$fileTitle.pdf',
            ),
      bottomNavigationBar: _loading
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (!_synced)
                      Container(
                        width: double.infinity,
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF4E5),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFFFD8A8)),
                        ),
                        child: const Text(
                          'لم يُرفع السند بعد — ستُطبع عليه عبارة «غير مرحّل بعد».',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 12.5, height: 1.4),
                        ),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () async {
                              await Printing.layoutPdf(
                                  format: _format,
                                  onLayout: (f) => _buildPdf(f),
                                  name: '$fileTitle.pdf');
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
                            onPressed: () => _send(fileTitle),
                            icon: const Icon(Icons.send),
                            label: const Text('إرسال'),
                            style: FilledButton.styleFrom(
                                backgroundColor: AppColors.success,
                                minimumSize: const Size.fromHeight(48)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Future<void> _send(String fileTitle) async {
    final bytes = await _buildPdf(_format);
    if (!mounted) return;
    final customer = '${widget.receipt['customer_name'] ?? ''}'.trim();
    await sendPdfToWhatsApp(
      context,
      bytes: bytes,
      fileTitle: fileTitle,
      phone: _phone,
      subdir: 'receipts',
      text: [
        _synced && _number.isNotEmpty ? 'سند قبض $_number' : 'سند قبض (غير مرحّل بعد)',
        if (customer.isNotEmpty) customer,
        _money(_amount),
      ].join(' — '),
    );
  }

  Future<Uint8List> _buildPdf(PdfPageFormat format) async {
    final r = widget.receipt;
    final synced = _synced;
    final doc = pw.Document();

    pw.Font arabic;
    try {
      arabic = pw.Font.ttf(await rootBundle.load('assets/fonts/Cairo.ttf'));
    } catch (_) {
      arabic = await PdfGoogleFonts.cairoRegular();
    }
    final theme = pw.ThemeData.withFont(base: arabic, bold: arabic);

    final amount = _amount;
    final family = (r['family'] as String?)?.trim();
    final hasFamily = family != null && family.isNotEmpty;
    final notes = '${r['notes'] ?? ''}'.trim();
    final date = '${r['receipt_date'] ?? ''}';
    final number = synced && _number.isNotEmpty ? _number : 'لم يُرفع بعد';
    final now = DateTime.now().toIso8601String();
    final printedAt = '${now.substring(0, 10)} ${now.substring(11, 16)}';

    final prev = (r['prev_balance'] as num?)?.toDouble();
    final byFamily = _familyBalances(r['prev_balances'] as String?);
    final mine = hasFamily ? byFamily[family] : null;

    final balanceRows = <pw.Widget>[];
    double? after;
    if (mine != null) {
      after = mine - amount;
      balanceRows.addAll([
        _total('حساب سابق ($family)', _money(mine)),
        _total('المدفوع', _money(amount)),
        _total('الباقي بعد الدفعة ($family)', _money(after), big: true),
        for (final e in byFamily.entries)
          if (e.key != family && e.value.abs() > 0.001)
            _total('مديونية ${e.key}', _money(e.value)),
        if (prev != null) _total('إجمالي حساب العميل بعد الدفعة', _money(prev - amount)),
      ]);
    } else if (prev != null) {
      after = prev - amount;
      balanceRows.addAll([
        _total('حساب سابق', _money(prev)),
        _total('المدفوع', _money(amount)),
        _total('الباقي بعد الدفعة', _money(after), big: true),
      ]);
    }

    doc.addPage(
      pw.Page(
        pageFormat: format,
        theme: theme,
        textDirection: pw.TextDirection.rtl,
        margin: const pw.EdgeInsets.all(14),
        build: (ctx) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: pw.BoxDecoration(
                color: _brand,
                borderRadius: pw.BorderRadius.circular(6),
              ),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text(hasFamily ? 'سند قبض — $family' : 'سند قبض',
                      style: const pw.TextStyle(
                          fontSize: 17,
                          fontWeight: pw.FontWeight.bold,
                          color: PdfColors.white)),
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      pw.Text(number,
                          style: const pw.TextStyle(
                              fontSize: 14,
                              fontWeight: pw.FontWeight.bold,
                              color: PdfColors.white)),
                      pw.Text(date,
                          style: const pw.TextStyle(
                              fontSize: 10, color: PdfColors.white)),
                    ],
                  ),
                ],
              ),
            ),
            pw.SizedBox(height: 8),
            if (!synced)
              pw.Container(
                margin: const pw.EdgeInsets.only(bottom: 8),
                padding: const pw.EdgeInsets.all(6),
                decoration: pw.BoxDecoration(
                  border: pw.Border.all(width: 0.8, color: _brand),
                  borderRadius: pw.BorderRadius.circular(4),
                ),
                child: pw.Text('غير مرحّل بعد — ما زال على جهاز المندوب، ويصدر رقمه بعد المزامنة',
                    textAlign: pw.TextAlign.center,
                    style: const pw.TextStyle(fontSize: 10)),
              ),
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: pw.BoxDecoration(
                border: pw.Border.all(width: 0.6, color: PdfColors.grey500),
                borderRadius: pw.BorderRadius.circular(4),
              ),
              child: pw.Column(children: [
                _row('العميل', '${r['customer_name'] ?? ''}'),
                pw.Row(children: [
                  pw.Expanded(child: _row('الهاتف',
                      (_phone ?? '').trim().isEmpty ? '—' : _phone!.trim())),
                  pw.Expanded(child: _row('التاريخ', date)),
                ]),
                pw.Row(children: [
                  pw.Expanded(child: _row('المندوب', _rep.isEmpty ? '—' : _rep)),
                  pw.Expanded(child: _row('الدفعة على', hasFamily ? family : 'على الإجمالي')),
                ]),
              ]),
            ),
            pw.SizedBox(height: 10),
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: pw.BoxDecoration(
                color: PdfColors.grey100,
                border: pw.Border.all(width: 0.8, color: _brand),
                borderRadius: pw.BorderRadius.circular(4),
              ),
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                children: [
                  pw.Row(
                    mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                    children: [
                      pw.Text('المبلغ المحصّل',
                          style: const pw.TextStyle(fontSize: 11)),
                      pw.Text(_money(amount),
                          style: const pw.TextStyle(
                              fontSize: 18,
                              fontWeight: pw.FontWeight.bold,
                              color: _brand)),
                    ],
                  ),
                  pw.SizedBox(height: 4),
                  pw.Text(amountToArabicWords(amount),
                      style: const pw.TextStyle(
                          fontSize: 11, fontWeight: pw.FontWeight.bold)),
                ],
              ),
            ),
            if (balanceRows.isNotEmpty) ...[
              pw.SizedBox(height: 10),
              pw.Container(
                padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: pw.BoxDecoration(
                  border: pw.Border.all(width: 0.6, color: PdfColors.grey500),
                  borderRadius: pw.BorderRadius.circular(4),
                ),
                child: pw.Column(children: balanceRows),
              ),
              if (after != null && after < -0.001)
                pw.Padding(
                  padding: const pw.EdgeInsets.only(top: 3),
                  child: pw.Text('المدفوع أكبر من المستحق — تُقيَّد الزيادة لحسابه',
                      style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
                ),
            ],
            if (notes.isNotEmpty) ...[
              pw.SizedBox(height: 10),
              pw.Text('البيان: $notes', style: const pw.TextStyle(fontSize: 10)),
            ],
            pw.SizedBox(height: 18),
            pw.Divider(color: PdfColors.grey400),
            pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Text('توقيع العميل: ____________', style: const pw.TextStyle(fontSize: 10)),
                pw.Text('توقيع المندوب (المستلم): ____________',
                    style: const pw.TextStyle(fontSize: 10)),
              ],
            ),
            pw.SizedBox(height: 4),
            pw.Text('طُبعت من تطبيق المندوب — $printedAt',
                textAlign: pw.TextAlign.center,
                style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
          ],
        ),
      ),
    );
    return doc.save();
  }
}

Map<String, double> _familyBalances(String? raw) {
  if (raw == null || raw.trim().isEmpty) return const {};
  try {
    final m = jsonDecode(raw) as Map<String, dynamic>;
    return {
      for (final e in m.entries) e.key: double.tryParse('${e.value}') ?? 0,
    };
  } catch (_) {
    return const {};
  }
}

const _brand = PdfColor.fromInt(0xFF0E4C6D);

pw.Widget _row(String label, String value) => pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
      child: pw.Row(children: [
        pw.SizedBox(
          width: 62,
          child: pw.Text('$label:',
              style: const pw.TextStyle(
                  fontSize: 10.5, fontWeight: pw.FontWeight.bold)),
        ),
        pw.Expanded(child: pw.Text(value, style: const pw.TextStyle(fontSize: 10.5))),
      ]),
    );

pw.Widget _total(String label, String value, {bool big = false}) => pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 2),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(label, style: pw.TextStyle(fontSize: big ? 11.5 : 10.5)),
          pw.Text(value,
              style: pw.TextStyle(
                  fontSize: big ? 14 : 11,
                  color: big ? _brand : PdfColors.black,
                  fontWeight: big ? pw.FontWeight.bold : pw.FontWeight.normal)),
        ],
      ),
    );

String _money(num v) => v.toStringAsFixed(2);
