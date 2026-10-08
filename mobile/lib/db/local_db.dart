import 'dart:convert';

import 'package:path/path.dart' as p;
import '../models/arabic_sort.dart';
import 'package:sqflite/sqflite.dart';

import '../models/coupon_custody.dart';
import '../models/models.dart';

class LocalDb {
  LocalDb._();
  static final LocalDb instance = LocalDb._();
  Database? _db;

  Future<Database> get db async {
    if (_db != null) return _db!;
    final path = p.join(await getDatabasesPath(), 'techno_inspections.db');
    _db = await openDatabase(path, version: 33, onUpgrade: (d, from, to) async {
      if (from < 33) {
        for (final col in ['prev_balance REAL', 'prev_balances TEXT']) {
          try { await d.execute('ALTER TABLE sale_receipt ADD COLUMN $col'); } catch (_) {}
        }
      }
      if (from < 32) {
        try { await d.execute('ALTER TABLE sale_item ADD COLUMN min_price REAL'); } catch (_) {}
      }
      if (from < 31) {
        for (final col in [
          'is_bonus INTEGER NOT NULL DEFAULT 0',
          'bonus_for_invoice_id INTEGER',
          'bonus_for_client_uuid TEXT',
          'bonus_for_number TEXT',
        ]) {
          try { await d.execute('ALTER TABLE sale_invoice ADD COLUMN $col'); } catch (_) {}
        }
      }
      if (from < 30) {
        try { await d.execute(_priceSheetTable); } catch (_) {}
        try { await d.execute(_priceSheetLineTable); } catch (_) {}
      }
      if (from < 29) {
        for (final col in [
          'base_price REAL',
          'default_discount_pct REAL NOT NULL DEFAULT 0',
          'tier_prices TEXT',
        ]) {
          try {
            await d.execute('ALTER TABLE branch_catalog_item ADD COLUMN $col');
          } catch (_) {}
        }
      }
      if (from < 28) {
        try {
          await d.update('kv', {'value': 'https://app.technothermeg.com'},
              where: 'key = ? AND value = ?',
              whereArgs: ['api_base', 'https://local.technothermeg.com']);
        } catch (_) {}
      }
      if (from < 27) {
        try { await d.execute(_warehouseItemTable); } catch (_) {}
        try {
          await d.execute(
              'ALTER TABLE sale_item ADD COLUMN pending_out REAL NOT NULL DEFAULT 0');
        } catch (_) {}

        try { await d.execute(_branchCatalogTable); } catch (_) {}
        try {
          await d.execute('ALTER TABLE sale_invoice ADD COLUMN prev_balances TEXT');
        } catch (_) {}
        try {
          await d.execute('ALTER TABLE stock_transfer ADD COLUMN transfer_date TEXT');
        } catch (_) {}
      }
      if (from < 23) {
        try {
          await d.execute('ALTER TABLE sale_invoice ADD COLUMN prev_balance REAL');
        } catch (_) {}
      }
      if (from < 18) {
        try { await d.execute(_treasuryTable); } catch (_) {}
      }
      if (from < 17) {
        try {
          await d.execute('ALTER TABLE sale_item ADD COLUMN category TEXT');
        } catch (_) {}
      }
      if (from < 2) {
        await d.execute('ALTER TABLE catalog_item ADD COLUMN my_stock REAL');
      }
      if (from < 3) {
        await d.execute('CREATE TABLE customer(id INTEGER PRIMARY KEY, name TEXT)');
        await d.execute('ALTER TABLE inspection ADD COLUMN customer_id INTEGER');
      }
      if (from < 5) {
        await d.execute(_couponReceiptTable);
      }
      if (from < 13) {
        try {
          await d.execute('ALTER TABLE inspection ADD COLUMN visit_type TEXT');
        } catch (_) {}
      }
      if (from < 8) {
        try { await d.execute(_attachmentTable); } catch (_) {}
      }
      if (from < 12) {
        for (final col in ['fixed_discount_pct REAL', 'variable_discount_pct REAL']) {
          try { await d.execute('ALTER TABLE sale_invoice_line ADD COLUMN $col'); } catch (_) {}
        }
      }
      if (from < 11) {
        try { await d.execute(_receiptTable); } catch (_) {}
      }
      if (from < 10) {
        for (final ddl in [_saleItemTable, _saleInvoiceTable, _saleLineTable]) {
          try { await d.execute(ddl); } catch (_) {}
        }
        try { await d.execute('ALTER TABLE customer ADD COLUMN price_tier TEXT'); } catch (_) {}
      }
      if (from < 9) {
        if (from < 16) {
          await d.execute(
              'ALTER TABLE inspection ADD COLUMN merchant_customer_id INTEGER');
        }
        try {
          await d.execute('ALTER TABLE inspection ADD COLUMN purchase_shop_phone TEXT');
        } catch (_) {}
      }
      if (from < 7) {
        for (final col in [
          'received_date TEXT',
          'coupon_kind TEXT',
          'coupon_value REAL',
          'customer_type TEXT',
        ]) {
          try { await d.execute('ALTER TABLE coupon_receipt ADD COLUMN $col'); } catch (_) {}
        }
      }
      if (from < 21) {
        try { await d.execute('ALTER TABLE sale_invoice ADD COLUMN coupons TEXT'); } catch (_) {}
      }
      if (from < 26) {
        try {
          await d.execute('ALTER TABLE stock_transfer ADD COLUMN transfer_date TEXT');
        } catch (_) {}
      }
      if (from < 20) {
        try { await d.execute('ALTER TABLE sale_receipt ADD COLUMN family TEXT'); } catch (_) {}
      }
      if (from < 19) {
        for (final col in ['family_balances TEXT', 'balance REAL']) {
          try { await d.execute('ALTER TABLE customer ADD COLUMN $col'); } catch (_) {}
        }
      }
      if (from < 15) {
        for (final col in ['customer_type TEXT', 'families TEXT']) {
          try { await d.execute('ALTER TABLE customer ADD COLUMN $col'); } catch (_) {}
        }
        try {
          await d.execute('ALTER TABLE sale_invoice ADD COLUMN family TEXT');
        } catch (_) {}
      }
      if (from < 14) {
        for (final ddl in [_warehouseTable, _transferTable, _transferLineTable]) {
          try { await d.execute(ddl); } catch (_) {}
        }
      }
      if (from < 4) {
        await d.execute('CREATE TABLE insp_item_type('
            'id INTEGER PRIMARY KEY, name TEXT, points REAL)');
        await d.execute('ALTER TABLE customer ADD COLUMN phone TEXT');
        await d.execute('ALTER TABLE customer ADD COLUMN address TEXT');
      }
    }, onCreate: (d, v) async {
      await d.execute(_attachmentTable);
      await d.execute(_couponReceiptTable);
      await d.execute('''
        CREATE TABLE inspection(
          local_id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_uuid TEXT UNIQUE NOT NULL,
          visit_kind TEXT NOT NULL,
          inspection_date TEXT NOT NULL,
          owner_name TEXT NOT NULL,
          owner_phone TEXT, national_id TEXT, owner_address TEXT, floor_number TEXT,
          description TEXT, inspection_type TEXT, visit_type TEXT,
          technician_name TEXT, technician_phone TEXT,
          purchase_shop TEXT, purchase_shop_phone TEXT,
          merchant_customer_id INTEGER, visit_details TEXT,
          customer_id INTEGER,
          total_points REAL NOT NULL DEFAULT 0,
          synced INTEGER NOT NULL DEFAULT 0,
          document_number TEXT,
          created_at TEXT NOT NULL
        )''');
      await d.execute('CREATE TABLE customer(id INTEGER PRIMARY KEY, name TEXT, phone TEXT, '
          'address TEXT, price_tier TEXT, customer_type TEXT, families TEXT, '
        'family_balances TEXT, balance REAL)');
      await d.execute(
          'CREATE TABLE insp_item_type(id INTEGER PRIMARY KEY, name TEXT, points REAL)');
      await d.execute('''
        CREATE TABLE inspection_line(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          inspection_local_id INTEGER NOT NULL,
          item_id INTEGER, item_name TEXT NOT NULL,
          quantity REAL NOT NULL, points REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0
        )''');
      await d.execute(
          'CREATE TABLE catalog_item(id INTEGER PRIMARY KEY, name TEXT, category TEXT, '
          'points REAL, my_stock REAL)');
      await d.execute(
          'CREATE TABLE lookup(category TEXT, value TEXT, label TEXT, sort INTEGER, '
          'PRIMARY KEY(category, value))');
      await d.execute('CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT)');
      await d.execute(_warehouseTable);
      await d.execute(_warehouseItemTable);
      await d.execute(_treasuryTable);
      await d.execute(_transferTable);
      await d.execute(_transferLineTable);
      await d.execute(_saleItemTable);
      await d.execute(_branchCatalogTable);
      await d.execute(_saleInvoiceTable);
      await d.execute(_saleLineTable);
      await d.execute(_receiptTable);
      await d.execute(_priceSheetTable);
      await d.execute(_priceSheetLineTable);
    });
    return _db!;
  }

  Future<String?> getKv(String key) async {
    final rows = await (await db).query('kv', where: 'key = ?', whereArgs: [key]);
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  Future<void> setKv(String key, String value) async {
    await (await db).insert('kv', {'key': key, 'value': value},
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> replaceCatalog(List<CatalogItem> items) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('catalog_item');
      final batch = tx.batch();
      for (final it in items) {
        batch.insert('catalog_item', it.toRow());
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<CatalogItem>> catalog({String query = ''}) async {
    final d = await db;
    final rows = query.isEmpty
        ? await d.query('catalog_item', orderBy: 'name')
        : await d.query('catalog_item',
            where: 'name LIKE ?', whereArgs: ['%$query%'], orderBy: 'name');
    return rows.map(CatalogItem.fromRow).toList();
  }

  Future<void> replaceLookups(String category, List<LookupOption> options) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('lookup', where: 'category = ?', whereArgs: [category]);
      for (final o in options) {
        await tx.insert('lookup',
            {'category': o.category, 'value': o.value, 'label': o.label, 'sort': o.sort});
      }
    });
  }

  Future<List<LookupOption>> lookups(String category) async {
    final rows = await (await db)
        .query('lookup', where: 'category = ?', whereArgs: [category], orderBy: 'sort, value');
    return rows.map(LookupOption.fromRow).toList();
  }

  Future<void> replaceCustomers(List<CustomerRef> customers) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('customer');
      final batch = tx.batch();
      for (final c in customers) {
        batch.insert('customer', {
          'id': c.id, 'name': c.name, 'phone': c.phone, 'address': c.address,
          'price_tier': c.priceTier,
          'customer_type': c.customerType,
          'families': c.families.join(','),
          'family_balances':
              c.familyBalances.entries.map((e) => '${e.key}=${e.value}').join('|'),
          'balance': c.balance,
        });
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<CustomerRef>> customers({
    String query = '',
    int limit = 40,
    List<String>? customerTypes,
  }) async {
    final d = await db;
    final where = <String>[];
    final args = <Object?>[];
    final types = (customerTypes ?? const <String>[])
        .where((t) => t.trim().isNotEmpty)
        .toList();
    if (types.isNotEmpty) {
      where.add('customer_type IN (${List.filled(types.length, '?').join(',')})');
      args.addAll(types);
    }
    final rows = await d.query('customer',
        where: where.isEmpty ? null : where.join(' AND '),
        whereArgs: where.isEmpty ? null : args,
        orderBy: 'name', limit: query.isEmpty ? limit : null);
    var out = rows.map(_customerFromRow).toList();
    if (query.isNotEmpty) {
      final n = bare(query);
      out = out.where((c) => bare(c.name).contains(n)).toList();
    }
    if (query.isNotEmpty) {
      final n = bare(query);
      int rank(CustomerRef c) {
        final t = bare(c.name);
        if (t.startsWith(n)) return 0;
        if (t.contains(' $n')) return 1;
        return 2;
      }
      out.sort((a, b) {
        final r = rank(a).compareTo(rank(b));
        return r != 0 ? r : compareArabic(a.name, b.name);
      });
    } else {
      out.sort((a, b) => compareArabic(a.name, b.name));
    }
    return out.length > limit ? out.sublist(0, limit) : out;
  }

  CustomerRef _customerFromRow(Map<String, Object?> r) => CustomerRef(
        id: r['id'] as int,
        name: r['name'] as String,
        phone: r['phone'] as String?,
        address: r['address'] as String?,
        priceTier: r['price_tier'] as String?,
        customerType: r['customer_type'] as String?,
        families: ((r['families'] as String?) ?? '')
            .split(',')
            .where((x) => x.trim().isNotEmpty)
            .toList(),
        familyBalances: {
          for (final part in ((r['family_balances'] as String?) ?? '').split('|'))
            if (part.contains('='))
              part.split('=').first: double.tryParse(part.split('=').last) ?? 0,
        },
        balance: (r['balance'] as num?)?.toDouble() ?? 0,
      );

  Future<void> replaceItemTypes(List<CatalogItem> types) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('insp_item_type');
      final batch = tx.batch();
      for (final t in types) {
        batch.insert('insp_item_type', {'id': t.id, 'name': t.name, 'points': t.points});
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<CatalogItem>> itemTypes({String query = ''}) async {
    final d = await db;
    final rows = query.isEmpty
        ? await d.query('insp_item_type', orderBy: 'id')
        : await d.query('insp_item_type',
            where: 'name LIKE ?', whereArgs: ['%$query%'], orderBy: 'id');
    return rows
        .map((r) => CatalogItem(
            id: r['id'] as int,
            name: r['name'] as String,
            points: (r['points'] as num?)?.toDouble() ?? 0))
        .toList();
  }

  Future<int> saveInspection(Inspection insp) async {
    final d = await db;
    return d.transaction((tx) async {
      final id = await tx.insert('inspection', {
        'client_uuid': insp.clientUuid,
        'visit_kind': insp.visitKind,
        'inspection_date': insp.inspectionDate,
        'owner_name': insp.ownerName,
        'owner_phone': insp.ownerPhone,
        'national_id': insp.nationalId,
        'owner_address': insp.ownerAddress,
        'floor_number': insp.floorNumber,
        'description': insp.description,
        'inspection_type': insp.inspectionType,
        'visit_type': insp.visitType,
        'technician_name': insp.technicianName,
        'technician_phone': insp.technicianPhone,
        'purchase_shop': insp.purchaseShop,
        'merchant_customer_id': insp.merchantCustomerId,
        'purchase_shop_phone': insp.purchaseShopPhone,
        'visit_details': insp.visitDetails,
        'customer_id': insp.customerId,
        'total_points': insp.totalPoints,
        'synced': 0,
        'created_at': DateTime.now().toIso8601String(),
      });
      for (final l in insp.lines) {
        await tx.insert('inspection_line', {
          'inspection_local_id': id,
          'item_id': l.itemId,
          'item_name': l.itemName,
          'quantity': l.quantity,
          'points': l.points,
          'total': l.total,
        });
      }
      return id;
    });
  }

  Future<List<Inspection>> listInspections(
      {String? date, String? from, String? to, String? visitKind, bool? synced}) async {
    final d = await db;
    final where = <String>[];
    final args = <Object?>[];
    if (date != null) {
      where.add('inspection_date = ?');
      args.add(date);
    }
    if (from != null) {
      where.add('inspection_date >= ?');
      args.add(from);
    }
    if (to != null) {
      where.add('inspection_date <= ?');
      args.add(to);
    }
    if (visitKind != null) {
      where.add('visit_kind = ?');
      args.add(visitKind);
    }
    if (synced != null) {
      where.add('synced = ?');
      args.add(synced ? 1 : 0);
    }
    final rows = await d.query('inspection',
        where: where.isEmpty ? null : where.join(' AND '),
        whereArgs: args,
        orderBy: 'local_id DESC');
    final result = <Inspection>[];
    for (final r in rows) {
      result.add(await _hydrate(d, r));
    }
    return result;
  }

  Future<Inspection> _hydrate(Database d, Map<String, Object?> r) async {
    final lineRows = await d.query('inspection_line',
        where: 'inspection_local_id = ?', whereArgs: [r['local_id']]);
    return Inspection(
      localId: r['local_id'] as int,
      clientUuid: r['client_uuid'] as String,
      visitKind: r['visit_kind'] as String,
      inspectionDate: r['inspection_date'] as String,
      ownerName: r['owner_name'] as String,
      ownerPhone: r['owner_phone'] as String?,
      nationalId: r['national_id'] as String?,
      ownerAddress: r['owner_address'] as String?,
      floorNumber: r['floor_number'] as String?,
      description: r['description'] as String?,
      inspectionType: r['inspection_type'] as String?,
      visitType: r['visit_type'] as String?,
      technicianName: r['technician_name'] as String?,
      technicianPhone: r['technician_phone'] as String?,
      purchaseShop: r['purchase_shop'] as String?,
      merchantCustomerId: r['merchant_customer_id'] as int?,
      purchaseShopPhone: r['purchase_shop_phone'] as String?,
      visitDetails: r['visit_details'] as String?,
      customerId: r['customer_id'] as int?,
      lines: [
        for (final l in lineRows)
          InspectionLine(
            itemId: l['item_id'] as int?,
            itemName: l['item_name'] as String,
            quantity: (l['quantity'] as num).toDouble(),
            points: (l['points'] as num).toDouble(),
          )
      ],
      synced: (r['synced'] as int) == 1,
      documentNumber: r['document_number'] as String?,
      createdAt: r['created_at'] as String?,
    );
  }

  Future<List<Inspection>> pendingSync() => listInspections(synced: false);

  Future<void> markSynced(String clientUuid, String documentNumber) async {
    await (await db).update(
        'inspection', {'synced': 1, 'document_number': documentNumber},
        where: 'client_uuid = ?', whereArgs: [clientUuid]);
  }

  Future<int> pendingCount() async {
    final rows = await (await db)
        .rawQuery('SELECT COUNT(*) AS c FROM inspection WHERE synced = 0');
    return rows.first['c'] as int;
  }

  Future<void> deleteInspection(int localId) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('inspection_line',
          where: 'inspection_local_id = ?', whereArgs: [localId]);
      await tx.delete('inspection', where: 'local_id = ?', whereArgs: [localId]);
    });
  }

  Future<int> addAttachment({
    required String inspectionUuid,
    required String path,
    String? name,
    String? kind,
    int? bytes,
  }) async {
    return (await db).insert('attachment', {
      'inspection_uuid': inspectionUuid,
      'path': path,
      'name': name,
      'kind': kind,
      'bytes': bytes,
      'synced': 0,
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, Object?>>> attachments(String inspectionUuid) async {
    return (await db).query('attachment',
        where: 'inspection_uuid = ?', whereArgs: [inspectionUuid], orderBy: 'local_id');
  }

  Future<void> markAttachmentSynced(int localId) async {
    await (await db).update('attachment', {'synced': 1},
        where: 'local_id = ?', whereArgs: [localId]);
  }

  Future<void> deleteAttachment(int localId) async {
    await (await db).delete('attachment', where: 'local_id = ?', whereArgs: [localId]);
  }

  Future<int> saveCouponReceipt({
    required String clientUuid,
    required List<String> serials,
    int? customerId,
    String? customerName,
    String? customerType,
    String? receivedDate,
    String? couponKind,
    double? couponValue,
    String? notes,
  }) async {
    return (await db).insert('coupon_receipt', {
      'client_uuid': clientUuid,
      'customer_id': customerId,
      'customer_name': customerName,
      'customer_type': customerType,
      'received_date': receivedDate,
      'coupon_kind': couponKind,
      'coupon_value': couponValue,
      'serials': serials.join(','),
      'coupon_count': serials.length,
      'notes': notes,
      'synced': 0,
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, Object?>>> couponReceipts({bool? synced}) async {
    return (await db).query('coupon_receipt',
        where: synced == null ? null : 'synced = ?',
        whereArgs: synced == null ? null : [synced ? 1 : 0],
        orderBy: 'local_id DESC');
  }

  Future<void> markCouponReceiptSynced(String clientUuid, String documentNumber) async {
    await (await db).update(
        'coupon_receipt', {'synced': 1, 'document_number': documentNumber},
        where: 'client_uuid = ?', whereArgs: [clientUuid]);
  }

  Future<int> pendingCouponReceiptCount() async {
    final rows = await (await db)
        .rawQuery('SELECT COUNT(*) AS c FROM coupon_receipt WHERE synced = 0');
    return rows.first['c'] as int;
  }

  Future<void> deleteCouponReceipt(int localId) async {
    await (await db).delete('coupon_receipt', where: 'local_id = ?', whereArgs: [localId]);
  }

  Future<void> replaceSaleItems(List<SaleItem> items) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('sale_item');
      final batch = tx.batch();
      for (final it in items) {
        batch.insert('sale_item', it.toRow());
      }
      await batch.commit(noResult: true);
    });
  }

  Future<Map<String, int>> pendingByKind() async {
    final d = await db;
    const tables = {
      'inspection': 'معاينة',
      'sale_invoice': 'فاتورة',
      'sale_receipt': 'تحصيل',
      'coupon_receipt': 'استلام كوبونات',
      'stock_transfer': 'طلب تحويل',
    };
    final out = <String, int>{};
    for (final e in tables.entries) {
      final n = Sqflite.firstIntValue(await d.rawQuery(
              'SELECT COUNT(*) FROM ${e.key} WHERE synced = 0')) ??
          0;
      if (n > 0) out[e.value] = n;
    }
    return out;
  }

  static const _userTables = [
    'inspection_line', 'inspection', 'attachment',
    'sale_invoice_line', 'sale_invoice', 'sale_receipt',
    'coupon_receipt', 'stock_transfer_line', 'stock_transfer',
    'price_sheet_line', 'price_sheet',
    'sale_item', 'customer', 'rep_treasury',
  ];

  Future<Map<String, int>> userDataCounts() async {
    final d = await db;
    final out = <String, int>{};
    for (final t in _userTables) {
      try {
        final n = Sqflite.firstIntValue(
                await d.rawQuery('SELECT COUNT(*) FROM $t')) ??
            0;
        if (n > 0) out[t] = n;
      } catch (_) {}
    }
    return out;
  }

  Future<bool> hasUserData() async => (await userDataCounts()).isNotEmpty;

  Future<void> wipeUserData() async {
    final d = await db;
    for (final t in _userTables) {
      try {
        await d.delete(t);
      } catch (_) {}
    }
    for (final k in ['store_id', 'store_kind', 'last_sync', 'last_pull']) {
      try {
        await d.delete('kv', where: 'key = ?', whereArgs: [k]);
      } catch (_) {}
    }
  }

  Future<void> replaceCatalogItems(List<SaleItem> items) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('branch_catalog_item');
      final batch = tx.batch();
      for (final it in items) {
        batch.insert('branch_catalog_item', {
          'item_id': it.itemId,
          'name': it.name,
          'unit': it.unit,
          'category': it.category,
          'base_price': it.basePrice,
          'default_discount_pct': it.defaultDiscountPct,
          'tier_prices':
              it.tierPrices.entries.map((e) => '${e.key}=${e.value}').join(','),
        });
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<SaleItem>> catalogItems() async {
    final d = await db;
    final rows = await d.query('branch_catalog_item', orderBy: 'name');
    if (rows.isEmpty) return saleItems();
    return [for (final r in rows) SaleItem.fromRow(r)];
  }

  Future<Set<String>> priceSheetHiddenCategories() async {
    final raw = await getKv('price_sheet_hidden_categories');
    if (raw == null || raw.isEmpty) return const {};
    try {
      return {for (final c in (jsonDecode(raw) as List)) '$c'};
    } catch (_) {
      return const {};
    }
  }

  Future<List<SaleItem>> saleItems({String query = ''}) async {
    final d = await db;
    final rows = await d.query('sale_item',
        where: query.trim().isEmpty ? null : 'name LIKE ?',
        whereArgs: query.trim().isEmpty ? null : ['%${query.trim()}%'],
        orderBy: 'name');
    return [for (final r in rows) SaleItem.fromRow(r)];
  }

  Future<double> availableForSale(int itemId, {int? exceptInvoiceLocalId}) async {
    final d = await db;
    final cached = await d.query('sale_item',
        columns: ['on_hand', 'pending_out'],
        where: 'item_id = ?', whereArgs: [itemId]);
    final onHand = cached.isEmpty
        ? 0.0
        : (cached.first['on_hand'] as num).toDouble() -
            ((cached.first['pending_out'] as num?)?.toDouble() ?? 0);
    final sold = await d.rawQuery(
        'SELECT COALESCE(SUM(l.quantity), 0) AS q FROM sale_invoice_line l '
        'JOIN sale_invoice i ON i.local_id = l.invoice_local_id '
        'WHERE l.item_id = ? AND i.synced = 0'
        '${exceptInvoiceLocalId == null ? '' : ' AND i.local_id <> ?'}',
        [itemId, if (exceptInvoiceLocalId != null) exceptInvoiceLocalId]);
    return onHand - ((sold.first['q'] as num?)?.toDouble() ?? 0);
  }

  Future<Map<int, double>> availableForSaleAll({int? exceptInvoiceLocalId}) async {
    final d = await db;
    final onHand =
        await d.query('sale_item', columns: ['item_id', 'on_hand', 'pending_out']);
    final sold = await d.rawQuery(
        'SELECT l.item_id AS item_id, COALESCE(SUM(l.quantity), 0) AS q '
        'FROM sale_invoice_line l '
        'JOIN sale_invoice i ON i.local_id = l.invoice_local_id '
        'WHERE i.synced = 0'
        '${exceptInvoiceLocalId == null ? '' : ' AND i.local_id <> ?'}'
        ' GROUP BY l.item_id',
        [if (exceptInvoiceLocalId != null) exceptInvoiceLocalId]);
    final pending = {
      for (final r in sold) r['item_id'] as int: (r['q'] as num?)?.toDouble() ?? 0
    };
    return {
      for (final r in onHand)
        r['item_id'] as int: ((r['on_hand'] as num?)?.toDouble() ?? 0)
            - ((r['pending_out'] as num?)?.toDouble() ?? 0)
            - (pending[r['item_id'] as int] ?? 0)
    };
  }

  Future<Map<int, List<PendingHold>>> pendingHolds(
      {int? exceptInvoiceLocalId}) async {
    final d = await db;
    final rows = await d.rawQuery(
        'SELECT l.item_id AS item_id, i.local_id AS local_id, i.customer_name AS customer,'
        ' i.is_bonus AS is_bonus, SUM(l.quantity) AS q '
        'FROM sale_invoice_line l '
        'JOIN sale_invoice i ON i.local_id = l.invoice_local_id '
        'WHERE i.synced = 0'
        '${exceptInvoiceLocalId == null ? '' : ' AND i.local_id <> ?'}'
        ' GROUP BY l.item_id, i.local_id ORDER BY i.local_id',
        [if (exceptInvoiceLocalId != null) exceptInvoiceLocalId]);
    final out = <int, List<PendingHold>>{};
    for (final r in rows) {
      out.putIfAbsent(r['item_id'] as int, () => []).add(PendingHold(
            localId: r['local_id'] as int,
            customerName: (r['customer'] as String?) ?? '',
            isBonus: (r['is_bonus'] as int? ?? 0) == 1,
            quantity: (r['q'] as num?)?.toDouble() ?? 0,
          ));
    }
    return out;
  }

  Future<void> replaceCouponCustody(Object? custody, Object? kinds) async {
    final d = await db;
    if (custody == null && kinds == null) {
      await d.delete('kv', where: 'key = ?', whereArgs: ['coupon_custody']);
      return;
    }
    await setKv('coupon_custody',
        jsonEncode({'custody': custody ?? const [], 'kinds': kinds ?? const []}));
  }

  Future<CouponCustody> couponCustody({int? exceptInvoiceLocalId}) async {
    final raw = await getKv('coupon_custody');
    if (raw == null || raw.isEmpty) return CouponCustody.none;
    final queued = await (await db).rawQuery(
        'SELECT local_id, customer_name, coupons FROM sale_invoice '
        'WHERE synced = 0 AND coupons IS NOT NULL'
        '${exceptInvoiceLocalId == null ? '' : ' AND local_id <> ?'}'
        ' ORDER BY local_id',
        [if (exceptInvoiceLocalId != null) exceptInvoiceLocalId]);
    return CouponCustody.build(raw, queued);
  }

  Future<int> saveSaleInvoice({
    required String clientUuid,
    required int customerId,
    required String customerName,
    required String invoiceDate,
    required double cashAmount,
    required double creditAmount,
    required double total,
    String? notes,
    String? family,
    String? couponsJson,
    double? prevBalance,
    String? prevBalancesJson,
    bool isBonus = false,
    int? bonusForInvoiceId,
    String? bonusForClientUuid,
    String? bonusForNumber,
    required List<SaleDraftLine> lines,
  }) async {
    final d = await db;
    return d.transaction<int>((tx) async {
      final id = await tx.insert('sale_invoice', {
        'client_uuid': clientUuid,
        'customer_id': customerId,
        'customer_name': customerName,
        'invoice_date': invoiceDate,
        'cash_amount': cashAmount,
        'credit_amount': creditAmount,
        'total': total,
        'notes': notes,
        'family': family,
        'coupons': couponsJson,
        'prev_balance': prevBalance,
        'prev_balances': prevBalancesJson,
        'is_bonus': isBonus ? 1 : 0,
        'bonus_for_invoice_id': isBonus ? bonusForInvoiceId : null,
        'bonus_for_client_uuid': isBonus ? bonusForClientUuid : null,
        'bonus_for_number': isBonus ? bonusForNumber : null,
        'synced': 0,
        'created_at': DateTime.now().toIso8601String(),
      });
      final batch = tx.batch();
      for (final l in lines) {
        batch.insert('sale_invoice_line', l.toRow(id));
      }
      await batch.commit(noResult: true);
      return id;
    });
  }

  Future<bool> updateQueuedSaleInvoice({
    required int localId,
    required int customerId,
    required String customerName,
    required String invoiceDate,
    required double cashAmount,
    required double creditAmount,
    required double total,
    String? notes,
    String? family,
    String? couponsJson,
    double? prevBalance,
    String? prevBalancesJson,
    bool isBonus = false,
    int? bonusForInvoiceId,
    String? bonusForClientUuid,
    String? bonusForNumber,
    required List<SaleDraftLine> lines,
  }) async {
    final d = await db;
    return d.transaction<bool>((tx) async {
      final n = await tx.update(
        'sale_invoice',
        {
          'customer_id': customerId,
          'customer_name': customerName,
          'invoice_date': invoiceDate,
          'cash_amount': cashAmount,
          'credit_amount': creditAmount,
          'total': total,
          'notes': notes,
          'family': family,
          'coupons': couponsJson,
          'prev_balance': prevBalance,
          'prev_balances': prevBalancesJson,
          'is_bonus': isBonus ? 1 : 0,
          'bonus_for_invoice_id': isBonus ? bonusForInvoiceId : null,
          'bonus_for_client_uuid': isBonus ? bonusForClientUuid : null,
          'bonus_for_number': isBonus ? bonusForNumber : null,
        },
        where: 'local_id = ? AND synced = 0',
        whereArgs: [localId],
      );
      if (n == 0) return false;
      await tx.delete('sale_invoice_line',
          where: 'invoice_local_id = ?', whereArgs: [localId]);
      final batch = tx.batch();
      for (final l in lines) {
        batch.insert('sale_invoice_line', l.toRow(localId));
      }
      await batch.commit(noResult: true);
      return true;
    });
  }

  Future<List<Map<String, Object?>>> saleInvoices({bool? synced}) async {
    final d = await db;
    return d.query('sale_invoice',
        where: synced == null ? null : 'synced = ?',
        whereArgs: synced == null ? null : [synced ? 1 : 0],
        orderBy: 'local_id DESC');
  }

  Future<List<Map<String, Object?>>> saleInvoicesForBonus(int customerId,
      {int? exceptLocalId}) async {
    final d = await db;
    return d.query('sale_invoice',
        where: 'customer_id = ? AND COALESCE(is_bonus, 0) = 0'
            '${exceptLocalId == null ? '' : ' AND local_id <> ?'}',
        whereArgs: [customerId, if (exceptLocalId != null) exceptLocalId],
        orderBy: 'local_id DESC',
        limit: 100);
  }

  Future<Map<String, Object?>?> saleInvoiceByUuid(String clientUuid) async {
    final d = await db;
    final rows = await d.query('sale_invoice',
        where: 'client_uuid = ?', whereArgs: [clientUuid], limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<int> queuedBonusesOn(String clientUuid) async {
    final d = await db;
    final r = await d.rawQuery(
        'SELECT COUNT(*) AS c FROM sale_invoice '
        'WHERE synced = 0 AND is_bonus = 1 AND bonus_for_client_uuid = ?',
        [clientUuid]);
    return (r.first['c'] as int?) ?? 0;
  }

  Future<List<SaleDraftLine>> saleInvoiceLines(int invoiceLocalId) async {
    final d = await db;
    final rows = await d.query('sale_invoice_line',
        where: 'invoice_local_id = ?', whereArgs: [invoiceLocalId], orderBy: 'id');
    return [for (final r in rows) SaleDraftLine.fromRow(r)];
  }

  Future<int> savePriceSheet({
    required String title,
    required String sheetDate,
    required double total,
    String? notes,
    required List<SaleDraftLine> lines,
  }) async {
    final d = await db;
    final now = DateTime.now().toIso8601String();
    return d.transaction<int>((tx) async {
      final id = await tx.insert('price_sheet', {
        'title': title,
        'sheet_date': sheetDate,
        'total': total,
        'line_count': lines.length,
        'notes': notes,
        'created_at': now,
        'updated_at': now,
      });
      final batch = tx.batch();
      for (final l in lines) {
        batch.insert('price_sheet_line', _priceSheetLineRow(id, l));
      }
      await batch.commit(noResult: true);
      return id;
    });
  }

  Future<void> updatePriceSheet({
    required int localId,
    required String title,
    required String sheetDate,
    required double total,
    String? notes,
    required List<SaleDraftLine> lines,
  }) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.update(
        'price_sheet',
        {
          'title': title,
          'sheet_date': sheetDate,
          'total': total,
          'line_count': lines.length,
          'notes': notes,
          'updated_at': DateTime.now().toIso8601String(),
        },
        where: 'local_id = ?',
        whereArgs: [localId],
      );
      await tx.delete('price_sheet_line',
          where: 'sheet_local_id = ?', whereArgs: [localId]);
      final batch = tx.batch();
      for (final l in lines) {
        batch.insert('price_sheet_line', _priceSheetLineRow(localId, l));
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<Map<String, Object?>>> priceSheets() async {
    final d = await db;
    return d.query('price_sheet', orderBy: 'updated_at DESC, local_id DESC');
  }

  Future<Map<String, Object?>?> priceSheet(int localId) async {
    final d = await db;
    final rows = await d.query('price_sheet',
        where: 'local_id = ?', whereArgs: [localId], limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<List<SaleDraftLine>> priceSheetLines(int localId) async {
    final d = await db;
    final rows = await d.query('price_sheet_line',
        where: 'sheet_local_id = ?', whereArgs: [localId], orderBy: 'id');
    return [for (final r in rows) SaleDraftLine.fromRow(r)];
  }

  Future<void> deletePriceSheet(int localId) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('price_sheet_line',
          where: 'sheet_local_id = ?', whereArgs: [localId]);
      await tx.delete('price_sheet', where: 'local_id = ?', whereArgs: [localId]);
    });
  }

  Map<String, Object?> _priceSheetLineRow(int sheetId, SaleDraftLine l) {
    final row = Map<String, Object?>.from(l.toRow(sheetId));
    row.remove('invoice_local_id');
    row['sheet_local_id'] = sheetId;
    return row;
  }

  Future<int> pendingSalesCount() async {
    final d = await db;
    final r = await d.rawQuery('SELECT COUNT(*) AS c FROM sale_invoice WHERE synced = 0');
    return (r.first['c'] as int?) ?? 0;
  }

  Future<void> replaceWarehouses(List<Map<String, Object?>> rows) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('warehouse');
      final batch = tx.batch();
      for (final w in rows) {
        batch.insert('warehouse', w);
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<Map<String, Object?>>> warehouses() async {
    final d = await db;
    return d.query('warehouse', orderBy: 'name');
  }

  Future<void> replaceWarehouseItems(List<Map<String, Object?>> rows) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('warehouse_item');
      final batch = tx.batch();
      for (final r in rows) {
        batch.insert('warehouse_item', r,
            conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<SaleItem>> warehouseItems(int warehouseId) async {
    final d = await db;
    final rows = await d.query('warehouse_item',
        where: 'warehouse_id = ?', whereArgs: [warehouseId], orderBy: 'name');
    return [
      for (final r in rows)
        SaleItem(
          itemId: r['item_id'] as int,
          name: '${r['name']}',
          unit: r['unit'] as String?,
          category: r['category'] as String?,
          onHand: 0,
        )
    ];
  }

  Future<void> replaceTreasuries(List<RepTreasury> rows) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('rep_treasury');
      final batch = tx.batch();
      for (final t in rows) {
        batch.insert('rep_treasury', t.toRow());
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<RepTreasury>> treasuries() async {
    final d = await db;
    final rows =
        await d.query('rep_treasury', orderBy: 'family IS NULL, family, custody_id');
    return [for (final r in rows) RepTreasury.fromRow(r)];
  }

  Future<int> saveTransfer({
    required String clientUuid,
    required String sourceKind,
    required int sourceId,
    required String destKind,
    required int destId,
    String? notes,
    String? transferDate,
    required List<Map<String, Object?>> lines,
  }) async {
    final d = await db;
    return d.transaction<int>((tx) async {
      final id = await tx.insert('stock_transfer', {
        'client_uuid': clientUuid,
        'source_kind': sourceKind,
        'source_id': sourceId,
        'dest_kind': destKind,
        'dest_id': destId,
        'notes': notes,
        'transfer_date': transferDate,
        'synced': 0,
        'created_at': DateTime.now().toIso8601String(),
      });
      final batch = tx.batch();
      for (final l in lines) {
        batch.insert('stock_transfer_line', {...l, 'transfer_local_id': id});
      }
      await batch.commit(noResult: true);
      return id;
    });
  }

  Future<bool> updateQueuedTransfer({
    required int localId,
    required String sourceKind,
    required int sourceId,
    required String destKind,
    required int destId,
    String? notes,
    String? transferDate,
    required List<Map<String, Object?>> lines,
  }) async {
    final d = await db;
    return d.transaction<bool>((tx) async {
      final n = await tx.update(
        'stock_transfer',
        {
          'source_kind': sourceKind,
          'source_id': sourceId,
          'dest_kind': destKind,
          'dest_id': destId,
          'notes': notes,
          'transfer_date': transferDate,
        },
        where: 'local_id = ? AND synced = 0',
        whereArgs: [localId],
      );
      if (n == 0) return false;
      await tx.delete('stock_transfer_line',
          where: 'transfer_local_id = ?', whereArgs: [localId]);
      final batch = tx.batch();
      for (final l in lines) {
        batch.insert('stock_transfer_line', {...l, 'transfer_local_id': localId});
      }
      await batch.commit(noResult: true);
      return true;
    });
  }

  Future<bool> deleteQueuedTransfer(int localId) async {
    final d = await db;
    return d.transaction<bool>((tx) async {
      final n = await tx.delete('stock_transfer',
          where: 'local_id = ? AND synced = 0', whereArgs: [localId]);
      if (n == 0) return false;
      await tx.delete('stock_transfer_line',
          where: 'transfer_local_id = ?', whereArgs: [localId]);
      return true;
    });
  }

  Future<List<Map<String, Object?>>> transfers({bool? synced}) async {
    final d = await db;
    return d.query('stock_transfer',
        where: synced == null ? null : 'synced = ?',
        whereArgs: synced == null ? null : [synced ? 1 : 0],
        orderBy: 'local_id DESC');
  }

  Future<List<Map<String, Object?>>> transferLines(int transferLocalId) async {
    final d = await db;
    return d.query('stock_transfer_line',
        where: 'transfer_local_id = ?', whereArgs: [transferLocalId],
        orderBy: 'local_id');
  }

  Future<void> markTransferSynced(int localId, int serverId, String? doc) async {
    final d = await db;
    await d.update('stock_transfer',
        {'synced': 1, 'server_id': serverId, 'document_number': doc},
        where: 'local_id = ?', whereArgs: [localId]);
  }

  Future<int> pendingTransfersCount() async {
    final d = await db;
    final r = await d.rawQuery('SELECT COUNT(*) AS c FROM stock_transfer WHERE synced = 0');
    return (r.first['c'] as int?) ?? 0;
  }

  Future<int> applyServerInvoices(List<dynamic> invoices) async {
    if (invoices.isEmpty) return 0;
    final d = await db;
    num? n(Object? v) => v == null ? null : num.tryParse('$v');
    var changed = 0;
    await d.transaction((tx) async {
      for (final raw in invoices) {
        final inv = raw as Map;
        final uuid = inv['client_uuid'] as String?;
        if (uuid == null) continue;
        final local = await tx.query('sale_invoice',
            columns: ['local_id'],
            where: 'client_uuid = ? AND synced = 1',
            whereArgs: [uuid],
            limit: 1);
        if (local.isEmpty) continue;
        final localId = local.first['local_id'] as int;
        await tx.update(
            'sale_invoice',
            {
              'cash_amount': n(inv['cash_amount']) ?? 0,
              'credit_amount': n(inv['credit_amount']) ?? 0,
              'total': n(inv['total']) ?? 0,
              if (inv['document_number'] != null) 'document_number': inv['document_number'],
              if (inv['prior_balance'] != null) 'prev_balance': n(inv['prior_balance']),
            },
            where: 'local_id = ?',
            whereArgs: [localId]);
        final lines = inv['lines'] as List?;
        if (lines != null) {
          final old = await tx.query('sale_invoice_line',
              columns: ['item_id', 'item_name'],
              where: 'invoice_local_id = ?',
              whereArgs: [localId]);
          final names = {for (final r in old) r['item_id'] as int: r['item_name'] as String};
          await tx.delete('sale_invoice_line',
              where: 'invoice_local_id = ?', whereArgs: [localId]);
          for (final raw in lines) {
            final l = raw as Map;
            final itemId = l['item_id'] as int;
            var name = names[itemId];
            if (name == null) {
              final it = await tx.query('sale_item',
                  columns: ['name'], where: 'item_id = ?', whereArgs: [itemId], limit: 1);
              name = it.isEmpty ? 'صنف #$itemId' : it.first['name'] as String;
            }
            await tx.insert('sale_invoice_line', {
              'invoice_local_id': localId,
              'item_id': itemId,
              'item_name': name,
              'quantity': n(l['quantity']) ?? 0,
              'unit_price': n(l['unit_price']) ?? 0,
              'discount_pct': n(l['discount_pct']) ?? 0,
              'fixed_discount_pct': n(l['fixed_discount_pct']) ?? 0,
              'variable_discount_pct': n(l['variable_discount_pct']) ?? 0,
              'line_total': n(l['line_total']) ?? 0,
            });
          }
        }
        changed++;
      }
    });
    return changed;
  }

  Future<void> markSaleSynced(String clientUuid, String documentNumber,
      {String? bonusForNumber}) async {
    final d = await db;
    await d.update(
        'sale_invoice',
        {
          'synced': 1,
          'document_number': documentNumber,
          if (bonusForNumber != null) 'bonus_for_number': bonusForNumber,
        },
        where: 'client_uuid = ?',
        whereArgs: [clientUuid]);
  }

  Future<int> saveReceipt({
    required String clientUuid,
    required int customerId,
    required String customerName,
    required double amount,
    required String receiptDate,
    String? family,
    String? notes,
    double? prevBalance,
    String? prevBalancesJson,
  }) async {
    final d = await db;
    return d.insert('sale_receipt', {
      'client_uuid': clientUuid,
      'customer_id': customerId,
      'customer_name': customerName,
      'amount': amount,
      'receipt_date': receiptDate,
      'family': family,
      'notes': notes,
      'prev_balance': prevBalance,
      'prev_balances': prevBalancesJson,
      'synced': 0,
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, Object?>>> receipts({bool? synced}) async {
    final d = await db;
    return d.query('sale_receipt',
        where: synced == null ? null : 'synced = ?',
        whereArgs: synced == null ? null : [synced ? 1 : 0],
        orderBy: 'local_id DESC');
  }

  Future<Map<String, Object?>?> receiptByLocalId(int localId) async {
    final d = await db;
    final rows = await d.query('sale_receipt',
        where: 'local_id = ?', whereArgs: [localId], limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<int> pendingReceiptsCount() async {
    final d = await db;
    final r = await d.rawQuery('SELECT COUNT(*) AS c FROM sale_receipt WHERE synced = 0');
    return (r.first['c'] as int?) ?? 0;
  }

  Future<void> markReceiptSynced(String clientUuid, String documentNumber) async {
    final d = await db;
    await d.update('sale_receipt', {'synced': 1, 'document_number': documentNumber},
        where: 'client_uuid = ?', whereArgs: [clientUuid]);
  }

  Future<void> deleteUnsyncedReceipt(int localId) async {
    final d = await db;
    await d.delete('sale_receipt', where: 'local_id = ? AND synced = 0', whereArgs: [localId]);
  }

  Future<Map<String, double>> dayTotals(String isoDate) async {
    final d = await db;
    final sold = await d.rawQuery(
        'SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS c FROM sale_invoice '
        'WHERE invoice_date = ?', [isoDate]);
    final cash = await d.rawQuery(
        'SELECT COALESCE(SUM(cash_amount),0) AS t FROM sale_invoice WHERE invoice_date = ?',
        [isoDate]);
    final got = await d.rawQuery(
        'SELECT COALESCE(SUM(amount),0) AS t FROM sale_receipt WHERE receipt_date = ?',
        [isoDate]);
    final onInvoices = (cash.first['t'] as num?)?.toDouble() ?? 0;
    final receipts = (got.first['t'] as num?)?.toDouble() ?? 0;
    return {
      'sales': (sold.first['t'] as num?)?.toDouble() ?? 0,
      'invoices': ((sold.first['c'] as int?) ?? 0).toDouble(),
      'cash_on_invoices': onInvoices,
      'receipts': receipts,
      'collected': onInvoices + receipts,
    };
  }

  Future<void> deleteUnsyncedSale(int localId) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('sale_invoice_line', where: 'invoice_local_id = ?', whereArgs: [localId]);
      await tx.delete('sale_invoice', where: 'local_id = ? AND synced = 0', whereArgs: [localId]);
    });
  }
}

const _attachmentTable = '''
  CREATE TABLE attachment(
    local_id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_uuid TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT,
    kind TEXT,
    bytes INTEGER,
    synced INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )''';

const _couponReceiptTable = '''
  CREATE TABLE coupon_receipt(
    local_id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_uuid TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    customer_name TEXT,
    serials TEXT NOT NULL,
    coupon_count INTEGER NOT NULL DEFAULT 0,
    -- تاريخ الاستلام اللي المندوب اختاره. مش وقت الكتابة: ممكن يسجّل النهاردة استلام
    -- حصل امبارح، والتقارير بتتجمّع بالتاريخ ده.
    received_date TEXT,
    -- نوع الكوبون وقيمته زي ما المندوب قالهم.
    --
    -- The server derives the true kind from the serial's issued range, but only when the phone
    -- reaches it. A rep with no signal still has to see «ثلاثة ذهبي وواحد فضي» before he hands the
    -- customer a receipt, so what he declared is kept here and travels with the sync.
    coupon_kind TEXT,
    coupon_value REAL,
    customer_type TEXT,
    notes TEXT,
    synced INTEGER NOT NULL DEFAULT 0,
    document_number TEXT,
    created_at TEXT NOT NULL
  )''';

const _saleItemTable = '''
CREATE TABLE sale_item(
  item_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  category TEXT,
  on_hand REAL NOT NULL DEFAULT 0,
  pending_out REAL NOT NULL DEFAULT 0,
  base_price REAL,
  default_discount_pct REAL NOT NULL DEFAULT 0,
  tier_prices TEXT,
  min_price REAL
)''';

const _branchCatalogTable = '''
CREATE TABLE branch_catalog_item(
  item_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  category TEXT,
  base_price REAL,
  default_discount_pct REAL NOT NULL DEFAULT 0,
  tier_prices TEXT
)''';

const _saleInvoiceTable = '''
CREATE TABLE sale_invoice(
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uuid TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  cash_amount REAL NOT NULL DEFAULT 0,
  credit_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  family TEXT,
  coupons TEXT,
  -- حساب العميل قبل الفاتورة دي، زي ما كان ساعة الحفظ.
  prev_balance REAL,
  -- رصيد كل خط قبل الطلب، JSON. شوف `prevBalancesJson`.
  prev_balances TEXT,
  -- فاتورة بونص (هدية بقيمة صفر) والفاتورة اللي هي عليها — بالرقم أو بـclient_uuid.
  is_bonus INTEGER NOT NULL DEFAULT 0,
  bonus_for_invoice_id INTEGER,
  bonus_for_client_uuid TEXT,
  bonus_for_number TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  document_number TEXT,
  created_at TEXT NOT NULL
)''';

const _saleLineTable = '''
CREATE TABLE sale_invoice_line(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_local_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  fixed_discount_pct REAL NOT NULL DEFAULT 0,
  variable_discount_pct REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
)''';

const _receiptTable = '''
CREATE TABLE sale_receipt(
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uuid TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  amount REAL NOT NULL,
  receipt_date TEXT NOT NULL,
  family TEXT,
  notes TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  document_number TEXT,
  created_at TEXT NOT NULL,
  prev_balance REAL,
  prev_balances TEXT
)''';

const _warehouseTable = '''
CREATE TABLE warehouse(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT
)''';

const _warehouseItemTable = '''
CREATE TABLE warehouse_item(
  warehouse_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  unit TEXT,
  category TEXT,
  PRIMARY KEY(warehouse_id, item_id)
)''';

const _treasuryTable = '''
CREATE TABLE rep_treasury(
  custody_id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  family TEXT,
  name TEXT,
  code TEXT
)''';

const _transferTable = '''
CREATE TABLE stock_transfer(
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uuid TEXT UNIQUE NOT NULL,
  source_kind TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  dest_kind TEXT NOT NULL,
  dest_id INTEGER NOT NULL,
  notes TEXT,
  transfer_date TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id INTEGER,
  document_number TEXT,
  created_at TEXT NOT NULL
)''';

const _transferLineTable = '''
CREATE TABLE stock_transfer_line(
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_local_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL NOT NULL
)''';

const _priceSheetTable = '''
CREATE TABLE price_sheet(
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  sheet_date TEXT NOT NULL,
  -- صافي العرض ساعة الحفظ. متخزّن عشان القايمة ماتحتاجش تقرا السطور كلها.
  total REAL NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)''';

const _priceSheetLineTable = '''
CREATE TABLE price_sheet_line(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_local_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  fixed_discount_pct REAL NOT NULL DEFAULT 0,
  variable_discount_pct REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
)''';

class PendingHold {
  const PendingHold({
    required this.localId,
    required this.customerName,
    required this.isBonus,
    required this.quantity,
  });
  final int localId;
  final String customerName;
  final bool isBonus;
  final double quantity;
}
