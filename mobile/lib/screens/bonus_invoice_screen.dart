import 'package:flutter/material.dart';

import 'sale_invoice_screen.dart';

class BonusInvoiceScreen extends StatelessWidget {
  const BonusInvoiceScreen({super.key, this.existing});

  final Map<String, Object?>? existing;

  @override
  Widget build(BuildContext context) =>
      SaleInvoiceScreen(existing: existing, bonusMode: true);
}
