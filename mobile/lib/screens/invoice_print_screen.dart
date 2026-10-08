import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../db/local_db.dart';
import '../models/discount.dart';
import '../models/models.dart';
import '../theme.dart';
import '../utils/pdf_share.dart';

class InvoicePrintScreen extends StatefulWidget {
  final Map<String, Object?> invoice;

  const InvoicePrintScreen({super.key, required this.invoice});

  @override
  State<InvoicePrintScreen> createState() => _InvoicePrintScreenState();
}

class _InvoicePrintScreenState extends State<InvoicePrintScreen> {
  List<SaleDraftLine> _lines = [];
  String _rep = '';
  String? _phone;
  bool _loading = true;

  String? _bonusFor;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final lines = await LocalDb.instance.saleInvoiceLines(widget.invoice['local_id'] as int);
    final rep = await LocalDb.instance.getKv('username') ?? '';
    String? phone;
    final cid = widget.invoice['customer_id'] as int?;
    if (cid != null) {
      final all = await LocalDb.instance.customers(limit: 100000);
      for (final c in all) {
        if (c.id == cid) { phone = c.phone; break; }
      }
    }
    String? bonusFor;
    if ((widget.invoice['is_bonus'] as int? ?? 0) == 1) {
      final uuid = widget.invoice['bonus_for_client_uuid'] as String?;
      if (uuid != null) {
        final target = await LocalDb.instance.saleInvoiceByUuid(uuid);
        bonusFor = target?['document_number'] as String?;
      }
      bonusFor ??= widget.invoice['bonus_for_number'] as String?;
    }
    if (mounted) {
      setState(() {
        _lines = lines;
        _rep = rep;
        _phone = phone;
        _bonusFor = bonusFor;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = widget.invoice;
    final synced = (inv['synced'] as int?) == 1;
    final title = synced ? (inv['document_number'] as String? ?? 'طلب بيع') : 'طلب بيع';
    final customer = safeFileName('${inv['customer_name'] ?? ''}');
    final family = safeFileName('${inv['family'] ?? ''}');
    final date = safeFileName('${inv['invoice_date'] ?? ''}'.split('T').first);
    final fileTitle = [
      customer.isNotEmpty ? customer : title,
      if (family.isNotEmpty) family,
      if (date.isNotEmpty) date,
    ].join(' - ');
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : PdfPreview(
              build: (format) => _buildPdf(format),
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
                    if (!synced)
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
                          'مسودّة — اعمل «مزامنة الآن» من الرئيسية عشان ترفعها، '
                          'وبعدها تقدر تطبع وتبعت. لسه تقدر تعدّلها.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 12.5, height: 1.4),
                        ),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: !synced
                                ? null
                                : () async {
                                    await Printing.layoutPdf(
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
                            onPressed: !synced
                                ? null
                                : () => _send(fileTitle),
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
    final inv = widget.invoice;
    final bytes = await _buildPdf(PdfPageFormat.a4);
    if (!mounted) return;
    final number = '${inv['document_number'] ?? ''}'.trim();
    final customer = '${inv['customer_name'] ?? ''}'.trim();
    await sendPdfToWhatsApp(
      context,
      bytes: bytes,
      fileTitle: fileTitle,
      phone: _phone,
      text: [
        number.isEmpty ? 'فاتورة' : 'فاتورة $number',
        if (customer.isNotEmpty) customer,
      ].join(' — '),
    );
  }

  Future<Uint8List> _buildPdf(PdfPageFormat format) async {
    final inv = widget.invoice;
    final synced = (inv['synced'] as int?) == 1;
    final doc = pw.Document();

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
    final prev = (inv['prev_balance'] as num?)?.toDouble();
    final prevByFamily = _familyBalances(inv['prev_balances'] as String?);
    final family = inv['family'] as String?;
    final isBonus = (inv['is_bonus'] as int? ?? 0) == 1;
    final bonusValue = _lines.fold<double>(0, (t, l) => t + l.gross);
    final coupons = _coupons(inv['coupons'] as String?);
    final now = DateTime.now().toIso8601String();
    final printedAt = '${now.substring(0, 10)} ${now.substring(11, 16)}';

    doc.addPage(
      pw.MultiPage(
        pageFormat: format,
        theme: theme,
        textDirection: pw.TextDirection.rtl,
        margin: const pw.EdgeInsets.all(14),
        header: (ctx) => ctx.pageNumber == 1
            ? pw.SizedBox()
            : pw.Container(
                margin: const pw.EdgeInsets.only(bottom: 8),
                padding: const pw.EdgeInsets.only(bottom: 4),
                decoration: const pw.BoxDecoration(
                  border: pw.Border(
                      bottom: pw.BorderSide(width: 0.6, color: PdfColors.grey400)),
                ),
                child: pw.Row(
                  mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                  children: [
                    pw.Text('${inv['customer_name'] ?? ''}',
                        style: const pw.TextStyle(
                            fontSize: 10, fontWeight: pw.FontWeight.bold)),
                    pw.Text(synced ? '${inv['document_number']}' : 'مسودّة',
                        style: const pw.TextStyle(
                            fontSize: 10, fontWeight: pw.FontWeight.bold)),
                  ],
                ),
              ),
        footer: (ctx) => pw.Container(
          alignment: pw.Alignment.center,
          margin: const pw.EdgeInsets.only(top: 6),
          child: pw.Text('صفحة ${ctx.pageNumber} من ${ctx.pagesCount}',
              style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey600)),
        ),
        build: (ctx) => [
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: pw.BoxDecoration(
                color: _brand,
                borderRadius: pw.BorderRadius.circular(6),
              ),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                crossAxisAlignment: pw.CrossAxisAlignment.center,
                children: [
                  pw.Row(children: [
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                          isBonus
                              ? (family == null ? 'فاتورة بونص' : 'فاتورة بونص — $family')
                              : _lines.isEmpty && coupons.isNotEmpty
                                  ? 'إذن تسليم كوبونات'
                                  : (family == null ? 'طلب بيع' : 'طلب بيع — $family'),
                          style: const pw.TextStyle(
                              fontSize: 17,
                              fontWeight: pw.FontWeight.bold,
                              color: PdfColors.white)),
                    ],
                  ),
                  ]),
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
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: pw.BoxDecoration(
                border: pw.Border.all(width: 0.6, color: PdfColors.grey500),
                borderRadius: pw.BorderRadius.circular(4),
              ),
              child: pw.Column(children: [
                pw.Row(children: [
                  pw.Expanded(flex: 3, child: _row('العميل', '${inv['customer_name']}')),
                  pw.Expanded(flex: 2, child: _row('التليفون',
                      (_phone ?? '').trim().isEmpty ? '—' : _phone!)),
                  pw.Expanded(flex: 2, child: _row('التاريخ', '${inv['invoice_date']}')),
                ]),
                pw.Row(children: [
                  pw.Expanded(flex: 3, child: _row('المندوب', _rep)),
                  pw.Expanded(flex: 2, child: _row('نوع الطلب', family ?? '—')),
                  pw.Expanded(flex: 2, child: pw.SizedBox()),
                ]),
                if (isBonus)
                  pw.Padding(
                    padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
                    child: pw.Text(
                        'على طلب بيع رقم ${_bonusFor ?? '— (لسه بيترفع)'}',
                        style: const pw.TextStyle(
                            fontSize: 11, fontWeight: pw.FontWeight.bold)),
                  ),
              ]),
            ),
            pw.SizedBox(height: 10),
            if (_lines.isNotEmpty) pw.Table(
              border: const pw.TableBorder(
                horizontalInside: pw.BorderSide(width: 0.4, color: PdfColors.grey400),
                bottom: pw.BorderSide(width: 0.6, color: PdfColors.grey500),
              ),
              columnWidths: {
                0: const pw.FlexColumnWidth(1.7),
                1: const pw.FlexColumnWidth(2.0),
                2: const pw.FlexColumnWidth(1.1),
                3: const pw.FlexColumnWidth(3.4),
                4: const pw.FlexColumnWidth(0.6),
              },
              children: [
                pw.TableRow(
                  decoration: const pw.BoxDecoration(color: _brand),
                  children: [
                    _cell(isBonus ? 'القيمة بسعر البيع' : 'الإجمالي',
                        bold: true, white: true, center: true),
                    _cell(isBonus ? 'سعر البيع' : 'السعر بعد الخصم',
                        bold: true, white: true, center: true),
                    _cell('الكمية', bold: true, white: true, center: true),
                    _cell('الصنف', bold: true, white: true),
                    _cell('#', bold: true, white: true, center: true),
                  ],
                ),
                for (var i = 0; i < _lines.length; i++)
                  pw.TableRow(
                    decoration: pw.BoxDecoration(
                        color: i.isOdd ? PdfColors.grey100 : PdfColors.white),
                    children: [
                      _cell(_money(isBonus ? _lines[i].gross : _lines[i].net),
                          center: true, bold: true),
                      isBonus
                          ? _cell(_money(_lines[i].unitPrice), center: true)
                          : _netPriceCell(_lines[i]),
                      _cell(_trim(_lines[i].quantity), center: true),
                      _cell(_lines[i].itemName),
                      _cell('${i + 1}', center: true),
                    ],
                  ),
              ],
            ),
            if (coupons.isNotEmpty) ...[
              if (_lines.isNotEmpty) pw.SizedBox(height: 12),
              pw.Text('الكوبونات المسلّمة',
                  style: const pw.TextStyle(
                      fontSize: 12, fontWeight: pw.FontWeight.bold)),
              pw.SizedBox(height: 4),
              pw.Table(
                border: const pw.TableBorder(
                  horizontalInside:
                      pw.BorderSide(width: 0.4, color: PdfColors.grey400),
                  bottom: pw.BorderSide(width: 0.6, color: PdfColors.grey500),
                ),
                columnWidths: {
                  0: const pw.FlexColumnWidth(1.2),
                  1: const pw.FlexColumnWidth(2),
                  2: const pw.FlexColumnWidth(2),
                  3: const pw.FlexColumnWidth(2.5),
                  4: const pw.FlexColumnWidth(0.6),
                },
                children: [
                  pw.TableRow(
                    decoration: const pw.BoxDecoration(color: _brand),
                    children: [
                      _cell('العدد', bold: true, white: true, center: true),
                      _cell('إلى رقم', bold: true, white: true, center: true),
                      _cell('من رقم', bold: true, white: true, center: true),
                      _cell('الفئة', bold: true, white: true),
                      _cell('#', bold: true, white: true, center: true),
                    ],
                  ),
                  for (var i = 0; i < coupons.length; i++)
                    pw.TableRow(
                      decoration: pw.BoxDecoration(
                          color: i.isOdd ? PdfColors.grey100 : PdfColors.white),
                      children: [
                        _cell('${coupons[i]['count'] ?? '—'}',
                            center: true, bold: true),
                        _cell('${coupons[i]['serial_to'] ?? '—'}', center: true),
                        _cell('${coupons[i]['serial_from'] ?? '—'}', center: true),
                        _cell('${coupons[i]['coupon_kind'] ?? '—'}'),
                        _cell('${i + 1}', center: true),
                      ],
                    ),
                ],
              ),
              pw.SizedBox(height: 4),
              pw.Text(
                  'إجمالي الكوبونات: '
                  '${coupons.fold<int>(0, (t, c) => t + ((c['count'] as int?) ?? 0))}',
                  style: const pw.TextStyle(
                      fontSize: 11, fontWeight: pw.FontWeight.bold)),
            ],
            pw.SizedBox(height: 12),
            ...(() {
              final mine = (family != null && prevByFamily.containsKey(family))
                  ? prevByFamily[family]
                  : (prevByFamily.isEmpty ? prev : null);
              final others = prevByFamily.entries
                  .where((e) => e.key != family)
                  .toList();
              final left = mine == null ? credit : mine + total - cash;
              final famTag = (family != null && prevByFamily.isNotEmpty) ? ' ($family)' : '';
              pw.Widget box(List<pw.Widget> rows) => pw.Expanded(
                    child: pw.Container(
                      padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: pw.BoxDecoration(
                        border: pw.Border.all(width: 0.6, color: PdfColors.grey500),
                        borderRadius: pw.BorderRadius.circular(4),
                      ),
                      child: pw.Column(children: rows),
                    ),
                  );
              if (isBonus) {
                return [
                  pw.SizedBox(height: 8),
                  pw.Row(children: [
                    box([
                      _total('قيمة البونص بسعر البيع', _money(bonusValue)),
                      _total('المطلوب من العميل', _money(0), big: true),
                    ]),
                  ]),
                ];
              }
              return [
                pw.SizedBox(height: 8),
                pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                  box([
                    _total('إجمالي الطلب', _money(total)),
                    if (mine != null) ...[
                      _total('يضاف إليه الحساب السابق$famTag', _money(mine)),
                      _total('الإجمالي', _money(mine + total), big: true),
                    ],
                  ]),
                  pw.SizedBox(width: 8),
                  box([
                    _total('المدفوع نقداً', _money(cash)),
                    _total('الباقي', _money(left), big: true),
                    for (final e in others)
                      _total('مديونية ${e.key}', _money(e.value)),
                  ]),
                ]),
              ];
            })(),
            if ((inv['notes'] as String?)?.isNotEmpty == true) ...[
              pw.SizedBox(height: 10),
              pw.Text('ملاحظات: ${inv['notes']}', style: const pw.TextStyle(fontSize: 10)),
            ],
            pw.SizedBox(height: 10),
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
    );
    return doc.save();
  }
}

pw.Widget _netPriceCell(SaleDraftLine l) {
  final net = l.discountPct > 0
      ? netOf(l.unitPrice, l.discountPct)
      : l.unitPrice;
  return _cell(_money(net), center: true);
}

List<Map<String, Object?>> _coupons(String? raw) {
  if (raw == null || raw.trim().isEmpty) return const [];
  try {
    final v = jsonDecode(raw);
    if (v is! List) return const [];
    return [for (final e in v) if (e is Map) Map<String, Object?>.from(e)];
  } catch (_) {
    return const [];
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

Map<String, double> _familyBalances(String? raw) {
  if (raw == null || raw.trim().isEmpty) return const {};
  try {
    final m = jsonDecode(raw) as Map<String, dynamic>;
    final out = <String, double>{};
    for (final e in m.entries) {
      final v = double.tryParse('${e.value}') ?? 0;
      if (v.abs() > 0.001) out[e.key] = v;
    }
    return out;
  } catch (_) {
    return const {};
  }
}

const _brand = PdfColor.fromInt(0xFF0E4C6D);

pw.Widget _cell(String text, {bool bold = false, bool white = false, bool center = false}) =>
    pw.Padding(
      padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3),
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
          pw.Text('$value',
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
