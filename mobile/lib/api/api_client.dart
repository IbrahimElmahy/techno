import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../db/local_db.dart';
import '../models/models.dart';

typedef CountProgress = void Function(int done, int total);

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const defaultBase = String.fromEnvironment('API_BASE',
      defaultValue: 'https://app.technothermeg.com');

  Future<String> baseUrl() async =>
      (await LocalDb.instance.getKv('api_base')) ?? defaultBase;

  Future<Uri> _uri(String path, [Map<String, String>? q]) async =>
      Uri.parse('${await baseUrl()}/api/v1$path').replace(queryParameters: q);

  Future<Map<String, String>> _headers() async {
    final token = await LocalDb.instance.getKv('token');
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  String _error(http.Response r) {
    try {
      final body = jsonDecode(utf8.decode(r.bodyBytes));
      final detail = body['detail'];
      if (detail is Map && detail['message'] != null) return detail['message'].toString();
      if (detail != null) return detail.toString();
    } catch (_) {}
    return 'خطأ من الخادم (${r.statusCode})';
  }

  static String? _text(Object? v) {
    final s = v?.toString().trim() ?? '';
    return s.isEmpty ? null : s;
  }

  Future<void> login(String username, String password) async {
    final r = await http
        .post(await _uri('/auth/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(
                {'username': username, 'password': password, 'client': 'mobile'}))
        .timeout(const Duration(seconds: 20));
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final body = jsonDecode(utf8.decode(r.bodyBytes));

    final owner = (await LocalDb.instance.getKv('data_owner') ??
            await LocalDb.instance.getKv('username'))
        ?.trim()
        .toLowerCase();
    final me = username.trim().toLowerCase();
    final hasData = await LocalDb.instance.hasUserData();

    if (hasData && owner != me) {
      final pending = await LocalDb.instance.pendingByKind();
      if (pending.isNotEmpty) {
        final what = pending.entries.map((e) => '${e.value} ${e.key}').join(' · ');
        final who = owner == null ? 'مستخدم سابق' : '«$owner»';
        throw ApiException(
            0,
            'توجد على الجهاز بيانات لـ$who لم تُرفع بعد ($what). '
            'سجّل الدخول بحسابه ونفّذ المزامنة أولاً، ثم سجّل الدخول بالحساب الجديد.');
      }
      await LocalDb.instance.wipeUserData();

      final left = await LocalDb.instance.userDataCounts();
      if (left.isNotEmpty) {
        final what = left.entries.map((e) => '${e.value} ${e.key}').join(' · ');
        throw ApiException(
            0, 'تعذر مسح بيانات المستخدم السابق من الجهاز ($what). '
                'امسح بيانات التطبيق من إعدادات الهاتف وأعد المحاولة.');
      }
    }

    await LocalDb.instance.setKv('token', body['access_token'] as String);
    await LocalDb.instance.setKv('username', username);
    await LocalDb.instance.setKv('data_owner', me);
    await LocalDb.instance.setKv('role', _roleOf(body) ?? '');
    await LocalDb.instance.setKv('full_name', '');
    try {
      await refreshAppCapabilities();
    } catch (_) {}
  }

  Future<void> refreshAppCapabilities() async {
    final r = await http
        .get(await _uri('/auth/me'), headers: await _headers())
        .timeout(const Duration(seconds: 20));
    if (r.statusCode != 200) return;
    final me = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    final role = _text(me['role']);
    if (role != null) await LocalDb.instance.setKv('role', role);
    final fullName = _text(me['full_name']);
    if (fullName != null) await LocalDb.instance.setKv('full_name', fullName);
    final caps = ((me['capabilities'] as List?) ?? const [])
        .map((e) => e.toString())
        .where((c) => c.startsWith('app.'))
        .toList();
    await LocalDb.instance.setKv('app_caps', jsonEncode(caps));
  }

  static String? _roleOf(Object? body) {
    if (body is Map) {
      final r = _text(body['role']);
      if (r != null) return r;
      final token = body['access_token'];
      if (token is String) {
        try {
          final parts = token.split('.');
          if (parts.length == 3) {
            final payload =
                jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
            if (payload is Map) return _text(payload['role']);
          }
        } catch (_) {}
      }
    }
    return null;
  }

  static const supervisorRole = 'rep_supervisor';

  Future<String?> role() async => _text(await LocalDb.instance.getKv('role'));

  Future<bool> isSupervisor() async => await role() == supervisorRole;

  Future<Map<String, dynamic>> _getJson(String path, [Map<String, String>? q]) async {
    final r = await http
        .get(await _uri(path, q), headers: await _headers())
        .timeout(const Duration(seconds: 30));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode == 403) {
      throw ApiException(403, 'ليس لهذا الحساب صلاحية متابعة المناديب');
    }
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> supervisorOverview(String dateFrom, String dateTo) =>
      _getJson('/supervisor/overview', {'date_from': dateFrom, 'date_to': dateTo});

  Future<Map<String, dynamic>> supervisorRepActivity(
    int repId, {
    String kind = 'all',
    required String dateFrom,
    required String dateTo,
    int limit = 50,
    int offset = 0,
  }) =>
      _getJson('/supervisor/reps/$repId/activity', {
        'kind': kind,
        'date_from': dateFrom,
        'date_to': dateTo,
        'limit': '$limit',
        'offset': '$offset',
      });

  Future<Map<String, dynamic>> supervisorDocument(int repId, String kind, int id) =>
      _getJson('/supervisor/reps/$repId/documents/$kind/$id');

  Future<void> pullReferenceData({void Function(String step)? onStep}) async {
    final headers = await _headers();
    onStep?.call('جارٍ جلب أصناف المعاينة…');
    final typesR = await http
        .get(await _uri('/inspections/item-types'), headers: headers)
        .timeout(const Duration(seconds: 60));
    if (typesR.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (typesR.statusCode != 200) throw ApiException(typesR.statusCode, _error(typesR));
    final types = jsonDecode(utf8.decode(typesR.bodyBytes)) as List;
    await LocalDb.instance.replaceItemTypes([
      for (final t in types)
        CatalogItem(
          id: t['id'] as int,
          name: t['name'] as String,
          points: double.tryParse(t['points'].toString()) ?? 0,
        )
    ]);

    onStep?.call('جارٍ جلب القوائم…');
    for (final category in ['inspection_description', 'inspection_type', 'coupon_kind']) {
      final r = await http
          .get(await _uri('/settings/lookups', {'category': category}), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (r.statusCode != 200) continue;
      final opts = jsonDecode(utf8.decode(r.bodyBytes)) as List;
      await LocalDb.instance.replaceLookups(category, [
        for (var i = 0; i < opts.length; i++)
          LookupOption(
            category: category,
            value: opts[i]['value'] as String,
            label: (opts[i]['label'] ?? opts[i]['value']) as String,
            sort: (opts[i]['sort_order'] as int?) ?? i,
          )
      ]);
    }
    await refreshPriceSheetHidden();
    onStep?.call('جارٍ جلب العملاء…');
    final custR = await http
        .get(await _uri('/customers'), headers: headers)
        .timeout(const Duration(seconds: 60));
    List<CustomerRef> parties = [];
    if (custR.statusCode == 200) {
      final rows = jsonDecode(utf8.decode(custR.bodyBytes)) as List;
      parties.addAll([
        for (final c in rows)
          CustomerRef(
            id: c['id'] as int,
            name: c['name'] as String,
            phone: c['phone'] as String?,
            address: c['address'] as String?,
            customerType: c['customer_type'] as String?,
          )
      ]);
    }
    var ownersFailed = false;
    try {
      const page = 1000;
      for (var offset = 0;; offset += page) {
        onStep?.call(offset == 0 ? 'جارٍ جلب الملّاك…' : 'جارٍ جلب الملّاك ($offset)…');
        final ownR = await http
            .get(await _uri('/owners', {'limit': '$page', 'offset': '$offset'}),
                headers: headers)
            .timeout(const Duration(seconds: 90));
        if (ownR.statusCode != 200) {
          ownersFailed = true;
          break;
        }
        final body = jsonDecode(utf8.decode(ownR.bodyBytes));
        final rows = (body is List ? body : (body['rows'] as List? ?? []));
        parties.addAll([
          for (final o in rows)
            CustomerRef(
              id: -(o['id'] as int),
              name: o['name'] as String,
              phone: o['phone'] as String?,
              address: o['address'] as String?,
              customerType: 'owner',
            )
        ]);
        if (rows.length < page) break;
      }
    } catch (_) {
      ownersFailed = true;
    }
    if (ownersFailed && parties.every((p) => p.customerType != 'owner')) {
      throw ApiException(0, 'تعذر تحديث كشف الملّاك — أعد المزامنة');
    }
    if (parties.isNotEmpty) {
      await LocalDb.instance.replaceCustomers(parties);
    }

    await LocalDb.instance.setKv('last_pull', DateTime.now().toIso8601String());
  }

  Future<int> pushInspections() async {
    final pending = await LocalDb.instance.pendingSync();
    if (pending.isEmpty) return 0;
    final r = await http
        .post(await _uri('/inspections/sync'),
            headers: await _headers(),
            body: jsonEncode({'inspections': [for (final i in pending) i.toApi()]}))
        .timeout(const Duration(seconds: 120));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final results = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    for (final res in results) {
      final uuid = res['client_uuid'] as String?;
      if (uuid == null) continue;
      await LocalDb.instance.markSynced(uuid, res['document_number'] as String);
      final id = res['id'];
      if (id is int) {
        try {
          await pushAttachments(uuid, id);
        } catch (_) {}
      }
    }
    await LocalDb.instance.setKv('last_sync', DateTime.now().toIso8601String());
    return results.length;
  }

  Future<int> pushAttachments(String inspectionUuid, int inspectionId) async {
    final rows = await LocalDb.instance.attachments(inspectionUuid);
    var sent = 0;
    for (final row in rows) {
      if ((row['synced'] as int?) == 1) continue;
      final path = row['path'] as String;
      final file = File(path);
      if (!file.existsSync()) {
        await LocalDb.instance.markAttachmentSynced(row['local_id'] as int);
        continue;
      }
      final req = http.MultipartRequest(
        'POST',
        await _uri('/inspections/$inspectionId/attachments'),
      )
        ..headers.addAll(await _headers())
        ..fields['client_uuid'] = 'att-$inspectionUuid-${row['local_id']}'
        ..files.add(await http.MultipartFile.fromPath(
          'file',
          path,
          contentType: MediaType('image', _ext(path)),
        ));
      req.headers.remove('Content-Type');

      final res = await http.Response.fromStream(
          await req.send().timeout(const Duration(seconds: 120)));
      if (res.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
      if (res.statusCode == 201) {
        await LocalDb.instance.markAttachmentSynced(row['local_id'] as int);
        sent++;
      }
    }
    return sent;
  }

  static String _ext(String path) {
    final dot = path.lastIndexOf('.');
    final ext = dot < 0 ? '' : path.substring(dot + 1).toLowerCase();
    return const {'jpg': 'jpeg', 'jpeg': 'jpeg', 'png': 'png', 'webp': 'webp', 'heic': 'heic'}[ext]
        ?? 'jpeg';
  }

  Future<void> refreshPriceSheetHidden(
      {Duration timeout = const Duration(seconds: 30)}) async {
    try {
      final r = await http
          .get(await _uri('/settings/lookups', {'category': 'item_category'}),
              headers: await _headers())
          .timeout(timeout);
      if (r.statusCode == 200) {
        final cats = (jsonDecode(utf8.decode(r.bodyBytes)) as List).cast<Map>();
        final hiddenVals = {
          for (final c in cats)
            if (c['hidden_in_price_sheet'] == true) '${c['value']}'
        };
        await LocalDb.instance.setKv('price_sheet_hidden_categories', jsonEncode([
          for (final c in cats)
            if (hiddenVals.contains('${c['value']}') ||
                hiddenVals.contains('${c['parent_value']}'))
              '${c['label'] ?? c['value']}'
        ]));
      }
    } catch (_) {}
  }

  Future<void> pullSalesBundle() async {
    final r = await http
        .get(await _uri('/sales/rep-bundle'), headers: await _headers())
        .timeout(const Duration(seconds: 60));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode == 403) throw ApiException(403, 'هذه الشاشة مخصصة للمناديب.');
    if (r.statusCode == 404) throw ApiException(404, 'ليس لديك عهدة مفتوحة — تواصل مع المخزن.');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;

    await LocalDb.instance.setKv('store_kind', '${body['store_kind'] ?? 'custody'}');
    await LocalDb.instance.setKv('store_id', '${body['store_id']}');
    final hiddenCats = body['price_sheet_hidden_categories'];
    if (hiddenCats is List) {
      await LocalDb.instance.setKv(
          'price_sheet_hidden_categories', jsonEncode([for (final c in hiddenCats) '$c']));
    }
    await LocalDb.instance.setKv(
        'can_sell_below_price', (body['can_sell_below_price'] ?? true) == true ? '1' : '0');
    await LocalDb.instance.setKv(
        'can_sell_below_cost', (body['can_sell_below_cost'] ?? true) == true ? '1' : '0');
    await LocalDb.instance.replaceCustomers([
      for (final c in (body['customers'] as List))
        CustomerRef(
          id: c['id'] as int,
          name: c['name'] as String,
          phone: c['phone'] as String?,
          address: c['address'] as String?,
          priceTier: c['price_tier'] as String?,
          customerType: c['customer_type'] as String?,
          families: [
            for (final f in ((c['families'] as List?) ?? const [])) f as String
          ],
          familyBalances: {
            for (final e in ((c['family_balances'] as Map?) ?? const {}).entries)
              e.key as String: double.tryParse('${e.value}') ?? 0,
          },
          balance: double.tryParse('${c['balance'] ?? 0}') ?? 0,
        )
    ]);
    await LocalDb.instance
        .applyServerInvoices((body['recent_invoices'] as List?) ?? const []);
    await LocalDb.instance.replaceSaleItems([
      for (final i in (body['items'] as List))
        SaleItem(
          itemId: i['item_id'] as int,
          name: i['name'] as String,
          unit: i['unit'] as String?,
          category: _text(i['category']),
          onHand: double.tryParse('${i['on_hand']}') ?? 0,
          pendingOut: double.tryParse('${i['pending_out'] ?? 0}') ?? 0,
          basePrice: double.tryParse('${i['base_price']}'),
          defaultDiscountPct: double.tryParse('${i['default_discount_pct']}') ?? 0,
          tierPrices: {
            for (final e in ((i['tier_prices'] as Map?) ?? {}).entries)
              e.key.toString(): double.tryParse('${e.value}') ?? 0
          },
          minPrice: i['min_price'] == null ? null : double.tryParse('${i['min_price']}'),
        )
    ]);
    final catalog = body['catalog'] as List?;
    if (catalog != null) {
      await LocalDb.instance.replaceCatalogItems([
        for (final i in catalog)
          SaleItem(
            itemId: i['item_id'] as int,
            name: i['name'] as String,
            unit: i['unit'] as String?,
            category: _text(i['category']),
            basePrice: double.tryParse('${i['base_price']}'),
            defaultDiscountPct:
                double.tryParse('${i['default_discount_pct']}') ?? 0,
            tierPrices: {
              for (final e in ((i['tier_prices'] as Map?) ?? {}).entries)
                e.key.toString(): double.tryParse('${e.value}') ?? 0
            },
          )
      ]);
    }
    await LocalDb.instance.replaceWarehouses([
      for (final w in ((body['warehouses'] as List?) ?? []))
        {'id': w['id'], 'name': '${w['name']}', 'kind': w['kind'] as String?}
    ]);
    final whItems = (body['warehouse_items'] as Map?) ?? const {};
    await LocalDb.instance.replaceWarehouseItems([
      for (final e in whItems.entries)
        for (final i in (e.value as List? ?? const []))
          {
            'warehouse_id': int.tryParse('${e.key}') ?? 0,
            'item_id': i['item_id'] as int,
            'name': '${i['name']}',
            'unit': i['unit'] as String?,
            'category': _text(i['category']),
          }
    ]);
    await LocalDb.instance.replaceTreasuries([
      for (final t in ((body['treasuries'] as List?) ?? const []))
        RepTreasury(
          custodyId: t['custody_id'] as int,
          accountId: (t['account_id'] as int?) ?? 0,
          family: _text(t['family']),
          name: _text(t['name']) ?? '',
          code: _text(t['code']) ?? '',
        )
    ]);
    await LocalDb.instance.replaceCouponCustody(
        body['coupon_custody'], body['coupon_custody_kinds']);
    await LocalDb.instance.setKv('last_sales_pull', DateTime.now().toIso8601String());
  }

  Future<int> pushSaleInvoices({bool refreshStock = true, CountProgress? onProgress}) async {
    final all = await LocalDb.instance.saleInvoices(synced: false);
    final pending = [
      for (final r in all) if ((r['is_bonus'] as int? ?? 0) != 1) r,
      for (final r in all.reversed) if ((r['is_bonus'] as int? ?? 0) == 1) r,
    ];
    var sent = 0;
    final storeId = int.tryParse(await LocalDb.instance.getKv('store_id') ?? '');
    final storeKind = await LocalDb.instance.getKv('store_kind') ?? 'custody';
    if (storeId == null && pending.isNotEmpty) {
      throw ApiException(0, 'اسحب البيانات أولاً — مخزنك غير معروف على الجهاز.');
    }
    for (final inv in pending) {
      onProgress?.call(sent, pending.length);
      final lines = await LocalDb.instance
          .saleInvoiceLines(inv['local_id'] as int);
      final isBonus = (inv['is_bonus'] as int? ?? 0) == 1;
      final r = await http
          .post(await _uri('/sales'),
              headers: await _headers(),
              body: jsonEncode({
                'customer_id': inv['customer_id'],
                'family': inv['family'],
                'origin': {'location_kind': storeKind, 'location_id': storeId},
                'variable_discount_pct': '0',
                'cash_amount': '${inv['cash_amount']}',
                'invoice_date': inv['invoice_date'],
                'notes': inv['notes'],
                'coupons': inv['coupons'] == null
                    ? const []
                    : jsonDecode(inv['coupons'] as String),
                'client_uuid': inv['client_uuid'],
                if (isBonus) ...{
                  'is_bonus': true,
                  'bonus_for_invoice_id': inv['bonus_for_invoice_id'],
                  'bonus_for_client_uuid': inv['bonus_for_client_uuid'],
                },
                'lines': [
                  for (final l in lines)
                    {
                      'item_id': l.itemId,
                      'quantity': '${l.quantity}',
                      'unit_price': '${l.unitPrice}',
                      'discount_pct': '${l.discountPct}',
                      'fixed_discount_pct': '${l.fixedDiscountPct}',
                      'variable_discount_pct': '${l.variableDiscountPct}',
                    }
                ],
              }))
          .timeout(const Duration(seconds: 90));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
      if (r.statusCode == 200 || r.statusCode == 201) {
        final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
        await LocalDb.instance.markSaleSynced(
            inv['client_uuid'] as String, body['document_number'] as String,
            bonusForNumber: body['bonus_for_number'] as String?);
        sent++;
        continue;
      }
      throw ApiException(r.statusCode,
          'فاتورة ${inv['customer_name']}: ${_error(r)}');
    }
    if (sent > 0 && refreshStock) {
      try {
        await pullSalesBundle();
      } catch (_) {}
    }
    return sent;
  }

  Future<int> pushTransfers({CountProgress? onProgress}) async {
    final pending = await LocalDb.instance.transfers(synced: false);
    var sent = 0;
    for (final t in pending) {
      onProgress?.call(sent, pending.length);
      final lines = await LocalDb.instance.transferLines(t['local_id'] as int);
      if (lines.isEmpty) continue;
      final first = lines.first;

      final r = await http
          .post(await _uri('/transfers'),
              headers: await _headers(),
              body: jsonEncode({
                'item_id': first['item_id'],
                'quantity': '${first['quantity']}',
                'route': _routeFor(
                    '${t['source_kind']}', '${t['dest_kind']}'),
                'source': {
                  'location_kind': t['source_kind'],
                  'location_id': t['source_id'],
                },
                'dest': {
                  'location_kind': t['dest_kind'],
                  'location_id': t['dest_id'],
                },
                'transfer_date': t['transfer_date'],
                'client_uuid': t['client_uuid'],
                'lines': [
                  for (final l in lines)
                    {'item_id': l['item_id'], 'quantity': '${l['quantity']}'},
                ],
              }))
          .timeout(const Duration(seconds: 90));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
      if (r.statusCode != 200 && r.statusCode != 201) {
        throw ApiException(r.statusCode, 'إذن تحويل: ${_error(r)}');
      }
      final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
      final serverId = body['id'] as int;

      final got = (body['lines'] as List?)?.length ?? 0;
      if (got != lines.length) {
        throw ApiException(
            502, 'إذن تحويل: وصل $got صنف من ${lines.length} — الطلب ما زال في قائمة الانتظار');
      }

      await LocalDb.instance.markTransferSynced(
          t['local_id'] as int, serverId, body['document_number'] as String?);
      sent++;
    }
    return sent;
  }

  static String _routeFor(String src, String dst) {
    if (src == 'warehouse' && dst == 'warehouse') return 'central_to_branch';
    if (src == 'warehouse' && dst == 'custody') return 'central_to_rep';
    if (src == 'custody' && dst == 'custody') return 'rep_to_rep';
    return 'rep_to_central';
  }

  Future<int> pushReceipts({CountProgress? onProgress}) async {
    final pending = await LocalDb.instance.receipts(synced: false);
    var sent = 0;
    for (final row in pending) {
      onProgress?.call(sent, pending.length);
      final r = await http
          .post(await _uri('/vouchers/receipts'),
              headers: await _headers(),
              body: jsonEncode({
                'customer_id': row['customer_id'],
                'amount': '${row['amount']}',
                'voucher_date': row['receipt_date'],
                'description': row['notes'],
                if ((row['family'] as String?) != null)
                  'family': row['family']
                else
                  'on_total': true,
                'client_uuid': row['client_uuid'],
              }))
          .timeout(const Duration(seconds: 60));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
      if (r.statusCode == 200 || r.statusCode == 201) {
        final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
        await LocalDb.instance.markReceiptSynced(
            row['client_uuid'] as String, body['document_number'] as String);
        sent++;
        continue;
      }
      throw ApiException(r.statusCode, 'تحصيل ${row['customer_name']}: ${_error(r)}');
    }
    return sent;
  }

  Future<Map<String, dynamic>> customerProfile(int customerId) async {
    final r = await http
        .get(await _uri('/customers/$customerId/profile'), headers: await _headers())
        .timeout(const Duration(seconds: 30));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
  }

  Future<List<Map<String, dynamic>>> customerSaleInvoices(int customerId) async {
    final r = await http
        .get(
            await _uri('/sales', {
              'customer_id': '$customerId',
              'kind': 'sale',
              'limit': '100',
            }),
            headers: await _headers())
        .timeout(const Duration(seconds: 12));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final rows = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return [
      for (final e in rows)
        if (e is Map<String, dynamic> && e['is_bonus'] != true) e
    ];
  }

  Future<List<SaleItem>> stockAtLocation(String kind, int id) async {
    final r = await http
        .get(
            await _uri('/stock/by-location', {
              'location_kind': kind,
              'location_id': '$id',
              'only_available': 'true',
            }),
            headers: await _headers())
        .timeout(const Duration(seconds: 30));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final rows = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    return [
      for (final i in rows)
        SaleItem(
          itemId: i['item_id'] as int,
          name: i['name'] as String,
          unit: _text(i['unit_of_measure']),
          category: _text(i['category']),
          onHand: double.tryParse('${i['on_hand']}') ?? 0,
          pendingOut: double.tryParse('${i['pending_out'] ?? 0}') ?? 0,
        )
    ];
  }

  Future<List<Map<String, dynamic>>> customerAccounts(int customerId) async {
    final r = await http
        .get(await _uri('/customers/$customerId/accounts'), headers: await _headers())
        .timeout(const Duration(seconds: 30));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    return [
      for (final a in (body['accounts'] as List? ?? const []))
        a as Map<String, dynamic>
    ];
  }

  Future<Map<String, dynamic>> checkCoupon(String serial, {String? couponKind}) async {
    final r = await http
        .get(
            await _uri('/coupon-receipts/check', {
              'serial': serial,
              if (couponKind != null && couponKind.isNotEmpty)
                'coupon_kind': couponKind,
            }),
            headers: await _headers())
        .timeout(const Duration(seconds: 20));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
  }

  Future<int> pushCouponReceipts({CountProgress? onProgress}) async {
    final pending = await LocalDb.instance.couponReceipts(synced: false);
    var sent = 0;
    for (final row in pending) {
      onProgress?.call(sent, pending.length);
      final serials = (row['serials'] as String)
          .split(',')
          .where((s) => s.trim().isNotEmpty)
          .toList();
      final r = await http
          .post(await _uri('/coupon-receipts'),
              headers: await _headers(),
              body: jsonEncode({
                'serials': serials,
                'customer_id': row['customer_id'],
                'notes': row['notes'],
                'client_uuid': row['client_uuid'],
                'received_date': row['received_date'],
                'coupon_kind': row['coupon_kind'],
                'declared_kind': row['coupon_kind'],
                'declared_value': row['coupon_value'],
                'customer_type': row['customer_type'],
              }))
          .timeout(const Duration(seconds: 60));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول مرة أخرى');
      if (r.statusCode == 201) {
        final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
        await LocalDb.instance.markCouponReceiptSynced(
            row['client_uuid'] as String, body['document_number'] as String);
        sent++;
        continue;
      }
      throw ApiException(r.statusCode, _error(r));
    }
    return sent;
  }
}
