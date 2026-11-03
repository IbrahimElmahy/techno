import 'package:flutter/material.dart';

import 'receipts_review_screen.dart';
import 'sales_review_screen.dart';

class InvoicesAndCollectionsScreen extends StatelessWidget {
  const InvoicesAndCollectionsScreen({
    super.key,
    this.showInvoices = true,
    this.showCollections = true,
  });

  final bool showInvoices;
  final bool showCollections;

  @override
  Widget build(BuildContext context) {
    if (showInvoices && showCollections) {
      return Scaffold(
        appBar: AppBar(title: const Text('فواتير وتحصيل')),
        body: const SalesReviewScreen(embedded: true, withReceipts: true),
      );
    }
    final tabs = <Tab>[
      if (showInvoices) const Tab(text: 'الفواتير'),
      if (showCollections) const Tab(text: 'التحصيل'),
    ];
    final views = <Widget>[
      if (showInvoices) const SalesReviewScreen(embedded: true),
      if (showCollections) const ReceiptsReviewScreen(embedded: true),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('فواتير وتحصيل'),
          bottom: tabs.length > 1
              ? TabBar(
                  tabs: tabs,
                  labelColor: Colors.white,
                  unselectedLabelColor: Colors.white70,
                  indicatorColor: Colors.white,
                )
              : null,
        ),
        body: tabs.length > 1 ? TabBarView(children: views) : views.first,
      ),
    );
  }
}
