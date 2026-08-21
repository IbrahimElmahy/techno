import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/models.dart';

/// Offline store: inspections recorded in the field live here first (synced=0),
/// then get flushed to the server in batches. Catalog + lookups are cached for offline entry.
class LocalDb {
  LocalDb._();
  static final LocalDb instance = LocalDb._();
  Database? _db;

  Future<Database> get db async {
    if (_db != null) return _db!;
    final path = p.join(await getDatabasesPath(), 'techno_inspections.db');
    _db = await openDatabase(path, version: 11, onUpgrade: (d, from, to) async {
      if (from < 2) {
        // v2: the rep's custody quantity per item (NULL/0 for admins or unissued reps).
        await d.execute('ALTER TABLE catalog_item ADD COLUMN my_stock REAL');
      }
      if (from < 3) {
        // v3: cached customers + the regular visit's customer link.
        await d.execute('CREATE TABLE customer(id INTEGER PRIMARY KEY, name TEXT)');
        await d.execute('ALTER TABLE inspection ADD COLUMN customer_id INTEGER');
      }
      if (from < 5) {
        // v5: coupons taken back from customers on the round. Queued like an inspection —
        // the rep is at a door with no signal far more often than not.
        await d.execute(_couponReceiptTable);
      }
      if (from < 8) {
        try { await d.execute(_attachmentTable); } catch (_) {}
      }
      if (from < 11) {
        // v11: التحصيل من العربية — سند قبض بيتكتب في الشارع ويترفع بعدين.
        try { await d.execute(_receiptTable); } catch (_) {}
      }
      if (from < 10) {
        // v10: البيع من العربية — أصناف العهدة بأسعارها، وطابور الفواتير وسطورها.
        for (final ddl in [_saleItemTable, _saleInvoiceTable, _saleLineTable]) {
          try { await d.execute(ddl); } catch (_) {}
        }
        try { await d.execute('ALTER TABLE customer ADD COLUMN price_tier TEXT'); } catch (_) {}
      }
      if (from < 9) {
        // v9: تليفون محل الشراء — «محل الشراء» بقى تاجر مختار من قايمة المندوب.
        try {
          await d.execute('ALTER TABLE inspection ADD COLUMN purchase_shop_phone TEXT');
        } catch (_) {}
      }
      if (from < 7) {
        // v7: تاريخ الاستلام ونوع الكوبون وقيمته ونوع العميل.
        for (final col in [
          'received_date TEXT',
          'coupon_kind TEXT',
          'coupon_value REAL',
          'customer_type TEXT',
        ]) {
          try { await d.execute('ALTER TABLE coupon_receipt ADD COLUMN $col'); } catch (_) {}
        }
      }
      if (from < 4) {
        // v4: the inspection point-items catalog + customer contact fields for autofill.
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
          description TEXT, inspection_type TEXT,
          technician_name TEXT, technician_phone TEXT,
          purchase_shop TEXT, purchase_shop_phone TEXT, visit_details TEXT,
          customer_id INTEGER,
          total_points REAL NOT NULL DEFAULT 0,
          synced INTEGER NOT NULL DEFAULT 0,
          document_number TEXT,
          created_at TEXT NOT NULL
        )''');
      await d.execute('CREATE TABLE customer(id INTEGER PRIMARY KEY, name TEXT, phone TEXT, '
          'address TEXT, price_tier TEXT)');
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
      await d.execute(_saleItemTable);
      await d.execute(_saleInvoiceTable);
      await d.execute(_saleLineTable);
      await d.execute(_receiptTable);
    });
    return _db!;
  }

  // --- key/value (token, api base, last sync...) ---
  Future<String?> getKv(String key) async {
    final rows = await (await db).query('kv', where: 'key = ?', whereArgs: [key]);
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  Future<void> setKv(String key, String value) async {
    await (await db).insert('kv', {'key': key, 'value': value},
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  // --- catalog & lookups cache ---
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

  // --- customers cache (for the regular visit picker + owner autofill, offline) ---
  Future<void> replaceCustomers(List<CustomerRef> customers) async {
    final d = await db;
    await d.transaction((tx) async {
      await tx.delete('customer');
      final batch = tx.batch();
      for (final c in customers) {
        batch.insert('customer', {
          'id': c.id, 'name': c.name, 'phone': c.phone, 'address': c.address,
          'price_tier': c.priceTier,
        });
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<CustomerRef>> customers({String query = '', int limit = 40}) async {
    final d = await db;
    final rows = query.isEmpty
        ? await d.query('customer', orderBy: 'name', limit: limit)
        : await d.query('customer',
            where: 'name LIKE ?', whereArgs: ['%$query%'], orderBy: 'name', limit: limit);
    return rows.map(_customerFromRow).toList();
  }

  CustomerRef _customerFromRow(Map<String, Object?> r) => CustomerRef(
        id: r['id'] as int,
        name: r['name'] as String,
        phone: r['phone'] as String?,
        address: r['address'] as String?,
        priceTier: r['price_tier'] as String?,
      );

  // --- inspection point-items catalog (أصناف المعاينة) ---
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

  // --- inspections ---
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
        'technician_name': insp.technicianName,
        'technician_phone': insp.technicianPhone,
        'purchase_shop': insp.purchaseShop,
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

  /// الزيارات المسجّلة على الجهاز. [from]/[to] بصيغة yyyy-MM-dd وشاملين الطرفين.
  Future<List<Inspection>> listInspections(
      {String? date, String? from, String? to, String? visitKind, bool? synced}) async {
    final d = await db;
    final where = <String>[];
    final args = <Object?>[];
    if (date != null) {
      where.add('inspection_date = ?');
      args.add(date);
    }
    // Dates are stored as yyyy-MM-dd text, which sorts and compares the same way it reads — so a
    // plain BETWEEN is correct without parsing anything.
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
      technicianName: r['technician_name'] as String?,
      technicianPhone: r['technician_phone'] as String?,
      purchaseShop: r['purchase_shop'] as String?,
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

  // ------------------------------------------------------------ coupon receipts

  /// Queue a handover taken at the door. `client_uuid` is what makes a retry safe: the server
  /// keys on it, so a receipt sent twice after a dropped connection lands once.
  // --- المرفقات ---

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

  // --- البيع من العربية ---------------------------------------------------------------

  /// بتحطّ أصناف العهدة مكان اللي قبلها. الرصيد صورة من لحظة السحب، فبيتبدّل كله مش يتجمّع.
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

  Future<List<SaleItem>> saleItems({String query = ''}) async {
    final d = await db;
    final rows = await d.query('sale_item',
        where: query.trim().isEmpty ? null : 'name LIKE ?',
        whereArgs: query.trim().isEmpty ? null : ['%${query.trim()}%'],
        orderBy: 'name');
    return [for (final r in rows) SaleItem.fromRow(r)];
  }

  /// الرصيد المتاح للصنف ده دلوقتي = اللي في الكاش **ناقص** اللي اتباع لسه ما اترفعش.
  ///
  /// من غير الطرح ده، مندوب معاه خمسة يقدر يكتب تلات فواتير بخمسة كل واحدة وهو من غير
  /// شبكة، ويكتشف عند المزامنة إن اتنين منهم اترفضوا — بعد ما يكون سلّم البضاعة وقال
  /// للعملاء إن الفواتير اتعملت. الحساب اللي في إيده لازم يبقى صادق وهو في الشارع.
  Future<double> availableForSale(int itemId) async {
    final d = await db;
    final cached = await d.query('sale_item',
        columns: ['on_hand'], where: 'item_id = ?', whereArgs: [itemId]);
    final onHand = cached.isEmpty ? 0.0 : (cached.first['on_hand'] as num).toDouble();
    final sold = await d.rawQuery(
        'SELECT COALESCE(SUM(l.quantity), 0) AS q FROM sale_invoice_line l '
        'JOIN sale_invoice i ON i.local_id = l.invoice_local_id '
        'WHERE l.item_id = ? AND i.synced = 0',
        [itemId]);
    return onHand - ((sold.first['q'] as num?)?.toDouble() ?? 0);
  }

  /// بتحفظ فاتورة وسطورها في معاملة واحدة — فاتورة من غير سطور مش فاتورة.
  Future<int> saveSaleInvoice({
    required String clientUuid,
    required int customerId,
    required String customerName,
    required String invoiceDate,
    required double cashAmount,
    required double creditAmount,
    required double total,
    String? notes,
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

  Future<List<Map<String, Object?>>> saleInvoices({bool? synced}) async {
    final d = await db;
    return d.query('sale_invoice',
        where: synced == null ? null : 'synced = ?',
        whereArgs: synced == null ? null : [synced ? 1 : 0],
        orderBy: 'local_id DESC');
  }

  Future<List<SaleDraftLine>> saleInvoiceLines(int invoiceLocalId) async {
    final d = await db;
    final rows = await d.query('sale_invoice_line',
        where: 'invoice_local_id = ?', whereArgs: [invoiceLocalId], orderBy: 'id');
    return [for (final r in rows) SaleDraftLine.fromRow(r)];
  }

  Future<int> pendingSalesCount() async {
    final d = await db;
    final r = await d.rawQuery('SELECT COUNT(*) AS c FROM sale_invoice WHERE synced = 0');
    return (r.first['c'] as int?) ?? 0;
  }

  Future<void> markSaleSynced(String clientUuid, String documentNumber) async {
    final d = await db;
    await d.update('sale_invoice', {'synced': 1, 'document_number': documentNumber},
        where: 'client_uuid = ?', whereArgs: [clientUuid]);
  }

  // --- التحصيل ------------------------------------------------------------------------

  Future<int> saveReceipt({
    required String clientUuid,
    required int customerId,
    required String customerName,
    required double amount,
    required String receiptDate,
    String? notes,
  }) async {
    final d = await db;
    return d.insert('sale_receipt', {
      'client_uuid': clientUuid,
      'customer_id': customerId,
      'customer_name': customerName,
      'amount': amount,
      'receipt_date': receiptDate,
      'notes': notes,
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

  /// ملخّص اليوم من على الجهاز — بيع وتحصيل وعدد الفواتير.
  ///
  /// بيتحسب من اللي على الجهاز مش من السيرفر، عشان يشتغل في الشارع. ودي هي الإجابة على
  /// السؤال اللي المندوب بيسأله لنفسه آخر اليوم قبل ما يورّد.
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
    return {
      'sales': (sold.first['t'] as num?)?.toDouble() ?? 0,
      'invoices': ((sold.first['c'] as int?) ?? 0).toDouble(),
      'cash_on_invoices': (cash.first['t'] as num?)?.toDouble() ?? 0,
      'collected': (got.first['t'] as num?)?.toDouble() ?? 0,
    };
  }

  /// بتشيل فاتورة لسه ما اترفعتش — اللي اترفعت مابتتشالش من هنا، دي بقت في الدفاتر.
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

// ------------------------------------------------------------------ البيع من العربية

/// أصناف العهدة — كاش مش دفتر.
///
/// الرصيد اللي فيها صورة من لحظة السحب، والحقيقة في السيرفر. عشان كده مافيش `synced`
/// عليها: مافيش حاجة اتكتبت هنا عشان تروح لحد.
const _saleItemTable = '''
CREATE TABLE sale_item(
  item_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  on_hand REAL NOT NULL DEFAULT 0,
  base_price REAL,
  default_discount_pct REAL NOT NULL DEFAULT 0,
  tier_prices TEXT
)''';

/// فاتورة اتكتبت على الجهاز.
///
/// `client_uuid` بيتولد مرة واحدة وقت الحفظ ومابيتغيّرش مهما اتعادت المزامنة — هو اللي
/// بيخلّي السيرفر يعرف إن دي نفس الفاتورة مش واحدة جديدة، فالمندوب اللي شبكته قطعت في نص
/// الرفع يقدر يعيد من غير ما العميل يتباعله مرتين.
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
  line_total REAL NOT NULL DEFAULT 0
)''';

/// تحصيل من عميل اتكتب على الجهاز.
///
/// `client_uuid` هنا مش رفاهية: لو الاتصال قطع بعد ما السند اتكتب على السيرفر وقبل ما
/// الرد يوصل، إعادة الرفع كانت هتقيّد التحصيل مرتين — ومديونية العميل تنقص بالضعف.
const _receiptTable = '''
CREATE TABLE sale_receipt(
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uuid TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  amount REAL NOT NULL,
  receipt_date TEXT NOT NULL,
  notes TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  document_number TEXT,
  created_at TEXT NOT NULL
)''';
