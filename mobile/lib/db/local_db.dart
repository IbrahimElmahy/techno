import 'package:flutter/foundation.dart';
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
    // A bare filename is a RELATIVE path, and on a phone the working directory is not somewhere
    // the app may write — so this fallback turned «I could not find the databases directory» into
    // «unable to open database file (code 14)», which points at the file and not at the reason.
    // Kept for desktop and tests, where a relative path does work, and it says so when it happens.
    String path;
    try {
      path = p.join(await getDatabasesPath(), 'techno_inspections.db');
    } catch (e) {
      debugPrint('getDatabasesPath() فشل ($e) — هنجرب مسار نسبي، وده مابيشتغلش على الموبايل');
      path = 'techno_inspections.db';
    }
    _db = await openDatabase(path, version: 6, onUpgrade: (d, from, to) async {
      if (from < 2) {
        try { await d.execute('ALTER TABLE catalog_item ADD COLUMN my_stock REAL'); } catch (_) {}
      }
      if (from < 3) {
        try { await d.execute('CREATE TABLE IF NOT EXISTS customer(id INTEGER PRIMARY KEY, name TEXT)'); } catch (_) {}
        try { await d.execute('ALTER TABLE inspection ADD COLUMN customer_id INTEGER'); } catch (_) {}
      }
      if (from < 5) {
        try { await d.execute(_couponReceiptTable); } catch (_) {}
      }
      if (from < 4) {
        try {
          await d.execute('CREATE TABLE IF NOT EXISTS insp_item_type('
              'id INTEGER PRIMARY KEY, name TEXT, points REAL)');
        } catch (_) {}
        try { await d.execute('ALTER TABLE customer ADD COLUMN phone TEXT'); } catch (_) {}
        try { await d.execute('ALTER TABLE customer ADD COLUMN address TEXT'); } catch (_) {}
      }
      if (from < 6) {
        try { await d.execute('ALTER TABLE coupon_receipt ADD COLUMN customer_type TEXT'); } catch (_) {}
        try { await d.execute('ALTER TABLE coupon_receipt ADD COLUMN receipt_date TEXT'); } catch (_) {}
        try { await d.execute('ALTER TABLE coupon_receipt ADD COLUMN coupon_type TEXT'); } catch (_) {}
        try { await d.execute('ALTER TABLE coupon_receipt ADD COLUMN coupon_value REAL'); } catch (_) {}
      }
    }, onCreate: (d, v) async {
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
          purchase_shop TEXT, visit_details TEXT,
          customer_id INTEGER,
          total_points REAL NOT NULL DEFAULT 0,
          synced INTEGER NOT NULL DEFAULT 0,
          document_number TEXT,
          created_at TEXT NOT NULL
        )''');
      await d.execute(
          'CREATE TABLE customer(id INTEGER PRIMARY KEY, name TEXT, phone TEXT, address TEXT)');
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
        batch.insert('customer',
            {'id': c.id, 'name': c.name, 'phone': c.phone, 'address': c.address});
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
      {String? date, String? fromDate, String? toDate, String? visitKind, bool? synced}) async {
    final d = await db;
    final where = <String>[];
    final args = <Object?>[];
    if (date != null) {
      where.add('inspection_date = ?');
      args.add(date);
    }
    if (fromDate != null) {
      where.add('inspection_date >= ?');
      args.add(fromDate);
    }
    if (toDate != null) {
      where.add('inspection_date <= ?');
      args.add(toDate);
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
  Future<int> saveCouponReceipt({
    required String clientUuid,
    required List<String> serials,
    int? customerId,
    String? customerName,
    String? customerType,
    String? receiptDate,
    String? couponType,
    double? couponValue,
    String? notes,
  }) async {
    return (await db).insert('coupon_receipt', {
      'client_uuid': clientUuid,
      'customer_id': customerId,
      'customer_name': customerName,
      'customer_type': customerType,
      'receipt_date': receiptDate,
      'coupon_type': couponType,
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
}

const _couponReceiptTable = '''
  CREATE TABLE coupon_receipt(
    local_id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_uuid TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    customer_name TEXT,
    customer_type TEXT,
    receipt_date TEXT,
    coupon_type TEXT,
    coupon_value REAL,
    serials TEXT NOT NULL,
    coupon_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    synced INTEGER NOT NULL DEFAULT 0,
    document_number TEXT,
    created_at TEXT NOT NULL
  )''';
