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
  String? _phone;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final lines = await LocalDb.instance.saleInvoiceLines(widget.invoice['local_id'] as int);
    final rep = await LocalDb.instance.getKv('username') ?? '';
    // تليفون العميل — الفاتورة المحفوظة شايلة اسمه ورقمه بس، والتليفون في كارته.
    // الورقة اللي بتروح واتساب من غير تليفون بتخلّي اللي بيراجع يقلّب على العميل
    // بالاسم، والأسماء بتتكرر.
    String? phone;
    final cid = widget.invoice['customer_id'] as int?;
    if (cid != null) {
      final all = await LocalDb.instance.customers(limit: 100000);
      for (final c in all) {
        if (c.id == cid) { phone = c.phone; break; }
      }
    }
    if (mounted) {
      setState(() { _lines = lines; _rep = rep; _phone = phone; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = widget.invoice;
    final synced = (inv['synced'] as int?) == 1;
    final title = synced ? (inv['document_number'] as String? ?? 'طلب بيع') : 'طلب بيع';
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
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // **الورقة مابتخرجش قبل ما الفاتورة توصل النظام.**
                    //
                    // الورقة المطبوعة من مسودّة بتدّعي فاتورة مالهاش وجود عند المكتب:
                    // العميل بيمسك ورق، والفاتورة لسه ممكن تتعدّل أو السيرفر يرفضها —
                    // والورقة اللي في إيده ساعتها بتقول حاجة تانية خالص.
                    //
                    // والزرار **بيتقفل ومعاه السبب**، مش بيختفي: اللي مش لاقي «طباعة»
                    // بيفتكر البرنامج بايظ، واللي شايفها مقفولة وجنبها السطر ده بيعرف
                    // يعمل إيه — والحل دوسة واحدة في الشاشة الرئيسية.
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
                            onPressed: !synced
                                ? null
                                : () async {
                                    // شاشة المشاركة بتاعت النظام — واتساب وغيره.
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

    // **الورقة دي بتطلع من غير شعار ولا اسم شركة — بقرار.**
    //
    // كانت بتحمل اللوجو وتكتب «تكنو ثيرم» لو الملف ضاع، عشان اللي بيمسكها يعرف بتاعت
    // مين. بس دي مش فاتورة: الفاتورة الرسمية بتطلع من المكتب بعد الترحيل. وورقة عليها
    // شعار الشركة واسمها بتقرا كفاتورة مهما كان المكتوب عليها، واللي بيستلمها مش
    // هيفرّق — فالهوية بتتشال من الأصل. اللون بيفضل، فهو بيميّز الورقة من غير ما
    // يدّعي إنها مستند رسمي.
    //
    // نفس القرار على النظام: `InvoiceDocument` بيخفي الترويسة والذيل لما النوع بيع.

    final theme = pw.ThemeData.withFont(base: arabic, bold: arabic);
    final total = (inv['total'] as num?)?.toDouble() ?? 0;
    final cash = (inv['cash_amount'] as num?)?.toDouble() ?? 0;
    final credit = (inv['credit_amount'] as num?)?.toDouble() ?? 0;
    // حساب العميل قبل الطلب ده. `null` = مستند اتكتب قبل ما العمود ده يوجد —
    // الورقة ساعتها بتقول اللي كانت بتقوله زي ما هي، مش بتخترع صفر.
    final prev = (inv['prev_balance'] as num?)?.toDouble();
    // رصيد كل خط قبل الطلب — «أبيض» و«بولى». اتخزّن مع الطلب ساعة الحفظ، فالورقة
    // اللي بتتطبع تاني بعد شهر بتقول نفس اللي قالته أول مرة.
    //
    // فاضي = عميل حسابه مش مقسوم على خطوط، والورقة بتقول «الحساب السابق» سطر واحد
    // زي ما كانت. سطرين بأصفار على عميل مالوش غير حساب واحد بيسألوا سؤال مالوش لازمة.
    final prevByFamily = _familyBalances(inv['prev_balances'] as String?);
    final family = inv['family'] as String?;
    // الكوبونات المصروفة مع الفاتورة. من غيرها الفاتورة اللي كوبونات بس بتطلع ورقة
    // فاضية بإجمالي صفر — والعميل ماخد دفتر في إيده والورقة مش قايلة حاجة عنه.
    final coupons = _coupons(inv['coupons'] as String?);
    final now = DateTime.now().toIso8601String();
    final printedAt = '${now.substring(0, 10)} ${now.substring(11, 16)}';

    // **`MultiPage` مش `Page` — الورقة بتتقسّم لما تكبر.**
    //
    // `pw.Page` صفحة واحدة مابتتقسّمش: اللي مايخشّش فيها **بيتقصّ ويروح**. فالفاتورة
    // اللي فيها عشرين صنف كانت بتطلع PDF ناقص — والمندوب والعميل الاتنين بيبصوا على
    // ورقة مقطوعة ومحدش فيهم يعرف إن فيه سطور مش موجودة، لأن مافيش حاجة بتقول.
    //
    // `MultiPage` بتكمّل على صفحة تانية، وجدول الأصناف بيتقسّم بينهم لوحده. ومن الصفحة
    // التانية بتطلع ترويسة خفيفة بالاسم والرقم عشان اللي ماسك الورقة يعرف بتاعت مين.
    doc.addPage(
      pw.MultiPage(
        pageFormat: format,
        theme: theme,
        textDirection: pw.TextDirection.rtl,
        margin: const pw.EdgeInsets.all(20),
        // **ترويسة خفيفة من الصفحة التانية وطايلع.** الورقة اللي بتتفصل عن أختها
        // بتبقى ورق سادة فيه أرقام: مين العميل وأنهي فاتورة؟ الترويسة الكاملة بلونها
        // مالهاش لزوم تتكرر — الرقم والاسم كفاية عشان الورقة تعرّف نفسها.
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
        // رقم الصفحة — من غيره اللي بياخد ورقة مالوش أي طريق يعرف إن وراها كمان.
        footer: (ctx) => pw.Container(
          alignment: pw.Alignment.center,
          margin: const pw.EdgeInsets.only(top: 6),
          child: pw.Text('صفحة ${ctx.pageNumber} من ${ctx.pagesCount}',
              style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey600)),
        ),
        build: (ctx) => [
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
                  pw.Row(children: [
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                          // **«طلب بيع» مش «فاتورة بيع».**
                          //
                          // الورقة دي بتتكتب في الشارع وبتتطبع من تليفون المندوب.
                          // كلمة «فاتورة» عليها بتخلّيها تقرا كمستند ضريبي، وهي
                          // مش كده: الفاتورة الرسمية بتطلع من المكتب بعد ما المستند
                          // يترحّل. الورقة اللي في إيد العميل بتقول اتفقنا على إيه،
                          // مش بتقوم مقام ورق قانوني.
                          //
                          // والورقة اللي مالهاش أصناف بتقول إنها كوبونات — كلمة
                          // «بيع» عليها بتخلي اللي بيمسكها يدوّر على بضاعة مافيش.
                          _lines.isEmpty && coupons.isNotEmpty
                              ? 'إذن تسليم كوبونات'
                              : 'طلب بيع',
                          // كان ١١ وهو تحت اسم الشركة؛ بقى هو الوحيد في الترويسة،
                          // فمينفعش يفضل بحجم سطر تابع.
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
                    // التليفون على الورقة: اللي بيراجع فاتورة راجعة من واتساب بيدوّر
                    // على العميل بالاسم، والأسماء بتتكرر — والرقم بيحسم.
                    _row('التليفون', (_phone ?? '').trim().isEmpty ? '—' : _phone!),
                    _row('المندوب', _rep),
                  ]),
                ),
                pw.SizedBox(width: 12),
                pw.Expanded(
                  child: pw.Column(children: [
                    _row('نوع الطلب', family ?? '—'),
                    _row('التاريخ', '${inv['invoice_date']}'),
                  ]),
                ),
              ]),
            ),
            pw.SizedBox(height: 10),
            // **الأعمدة من اليمين للشمال.** `pw.Table` مابيقلبش أعمدته مع اتجاه
            // الصفحة — بيرسمها بترتيب القايمة زي ما هي. فالورقة كانت بتطلع «#» على
            // الشمال و«الإجمالي» على اليمين: ورقة عربية بترتيب إنجليزي، والعين بتبدأ
            // من الناحية الغلط. الترتيب هنا مقلوب بإيدنا عشان يقرا صح.
            //
            // **وعمودي الخصم اتشالوا.** كانوا بيقولوا «خصم ثابت ١٠٪» و«خصم إضافي ٥٪»
            // والعميل بيحسب في دماغه ويسأل. دلوقتي «السعر بعد الخصم» هو **صافي سعر
            // الوحدة بعد الخصمين** — الرقم اللي بيتضرب في الكمية فعلاً — والنسبة
            // بتتقال تحته بخط صغير عشان اللي عايز يعرف الخصم راح فين يلاقيه.
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
                    _cell('الإجمالي', bold: true, white: true, center: true),
                    _cell('السعر بعد الخصم', bold: true, white: true, center: true),
                    _cell('الكمية', bold: true, white: true, center: true),
                    _cell('الصنف', bold: true, white: true),
                    _cell('#', bold: true, white: true, center: true),
                  ],
                ),
                for (var i = 0; i < _lines.length; i++)
                  pw.TableRow(
                    // تظليل خفيف صف ورا صف — عين بتمشي على سطر من غير ما تتوه في اللي جنبه.
                    decoration: pw.BoxDecoration(
                        color: i.isOdd ? PdfColors.grey100 : PdfColors.white),
                    children: [
                      _cell(_money(_lines[i].net), center: true, bold: true),
                      _netPriceCell(_lines[i]),
                      _cell(_trim(_lines[i].quantity), center: true),
                      _cell(_lines[i].itemName),
                      _cell('${i + 1}', center: true),
                    ],
                  ),
              ],
            ),
            // الكوبونات المسلّمة — جدول زي الأصناف، لأن دي هي البضاعة في الورقة دي.
            //
            // المدى هو المهم مش العدد: يوم ما العميل يرجّع ورقة، اللي بيستلم بيراجع
            // رقمها على المدى ده عشان يعرف إنها اتصرفت في تسليمة حصلت فعلاً.
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
                  // نفس القلب زي جدول الأصناف — الورقة واحدة والعين بتمشي بنفس الاتجاه.
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
                // **الحساب كامل، مش رقم الطلب لوحده.**
                //
                // كانت بتقول «الباقي على العميل» وتقصد آجل الطلب ده بس. والعميل
                // اللي عليه حساب من قبل بيقرا الرقم ده على إنه كل اللي عليه، فبيدفع
                // على أساسه ويتفاجئ بعدين. فالورقة بقت بتقول اللي المندوب بيقوله
                // بلسانه: كان عليك كذا، والطلب ده بكذا، ودفعت كذا، فالباقي كذا.
                //
                // و«الحساب السابق» بيتقرا من المستند نفسه (`prev_balance`) — اتخزّن
                // ساعة الحفظ. قراءته من كاش العملاء وقت الطباعة بترجّع رقم تاني بعد
                // أي مزامنة، فالورقة المتطبوعة تاني تقول غير الأولانية لنفس الطلب.
                child: pw.Column(children: [
                  // الخطوط الأول كل واحد لوحده، وتحتهم مجموعهم. المندوب بيتسأل
                  // «أنا عليا كام في الأبيض؟» مش «أنا عليا كام؟» — والرقم المجمّع
                  // لوحده مابيجاوبش، فبيرجع يفتح الشاشة قدام العميل.
                  if (prevByFamily.isNotEmpty)
                    for (final e in prevByFamily.entries)
                      _total('ح سابق ${e.key}', _money(e.value)),
                  if (prev != null)
                    _total(prevByFamily.isEmpty ? 'الحساب السابق' : 'إجمالي الحساب السابق',
                        _money(prev)),
                  _total('إجمالي الطلب', _money(total)),
                  _total('المدفوع نقداً', _money(cash)),
                  pw.Divider(height: 8, color: PdfColors.grey400),
                  _total(prev == null ? 'الباقي على العميل' : 'إجمالي المستحق',
                      _money(prev == null ? credit : prev + total - cash),
                      big: true),
                ]),
              ),
            ]),
            if ((inv['notes'] as String?)?.isNotEmpty == true) ...[
              pw.SizedBox(height: 10),
              pw.Text('ملاحظات: ${inv['notes']}', style: const pw.TextStyle(fontSize: 10)),
            ],
            // **من غير `Spacer`.** كانت بتدفع التوقيعات لآخر الصفحة الواحدة؛ وفي مستند
            // بيتقسّم مالهاش ارتفاع تنتهي عنده فبترمي استثناء. التوقيعات بتيجي بعد آخر
            // سطر — وده مكانها الصح على ورقة من صفحتين.
            pw.SizedBox(height: 14),
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

/// **صافي سعر الوحدة** — بعد الخصمين، لوحده.
///
/// الرقم ده هو اللي بيتضرب في الكمية ويطلع الإجمالي، فالعميل يراجع الورقة بضربة واحدة.
///
/// **وسطر «قبل الخصم · خصم ٪» اتشال بطلب صاحب النظام.** كان تحت السعر بخط صغير عشان
/// يقول الخصم راح فين. والورقة اللي بتتسلّم للعميل مش مكان الحساب ده — السعر اللي
/// اتفقنا عليه هو اللي عليها، وتفصيل الخصم موجود في النظام لمين يسأل.
pw.Widget _netPriceCell(SaleDraftLine l) {
  final net = l.discountPct > 0
      ? netOf(l.unitPrice, l.discountPct)
      : l.unitPrice;
  return _cell(_money(net), center: true);
}

/// بيفك عمود الكوبونات (JSON) لصفوف. الفاضي أو المكسور بيرجّع قايمة فاضية — ورقة
/// من غير جدول كوبونات أحسن من ورقة بتقول «خطأ» في وش العميل.
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

/// لون النظام نفسه (`AppColors.primary`) — الورقة والشاشة بنفس الهوية.
/// أرصدة الخطوط المتخزّنة مع الطلب. الصفر بيتشال — خط رصيده صفر مش معلومة.
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
    // الصف القديم ممكن يكون فاضي أو بشكل تاني — الورقة بتطلع بسطر واحد، مابتقعش.
    return const {};
  }
}

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
