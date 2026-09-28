import 'package:flutter/material.dart';

import 'sale_invoice_screen.dart';

/// صفحة فاتورة البونص — المدخل بتاعها من الرئيسية جنب «فاتورة بيع».
///
/// العميل طلبها «صفحة منفصلة، نسخة طبق الأصل من فاتورة البيع، عليها خصم على إجمالي
/// الفاتورة ١٠٠٪، وسعر البضاعة ممنوع». فهي **نفس** شاشة البيع بالعَلَم `bonusMode`:
/// نفس العميل ونفس إضافة الأصناف ونفس فحص العربية والطباعة — والفرق إن الخصم ١٠٠٪
/// ومقفول، والسعر من الشريحة ومقفول، ومافيش دفع ولا كوبونات، و«على فاتورة بيع» إجباري.
///
/// ملف لوحده عشان الرئيسية و«فواتيري» يقولوا «بونص» باسمه، مش بعَلَم جوّه نداء بيع.
class BonusInvoiceScreen extends StatelessWidget {
  const BonusInvoiceScreen({super.key, this.existing});

  /// بونص **لسه في الطابور** بيتعدّل، أو `null` لبونص جديد.
  final Map<String, Object?>? existing;

  @override
  Widget build(BuildContext context) =>
      SaleInvoiceScreen(existing: existing, bonusMode: true);
}
