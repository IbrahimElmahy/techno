import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../db/local_db.dart';
import '../models/models.dart';

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);
  @override
  String toString() => message;
}

/// Thin client over the ERP API. The token and base URL live in the local DB so the
/// app keeps working offline and after restarts.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  /// العنوان اللي التطبيق بينده عليه لو محدش غيّره.
  ///
  /// كان `api.technothermeg.com` — نشر سحابي قديم اتوقف، والدومين نفسه مابقاش
  /// بيتحل أصلاً (`No address associated with hostname`)، فالتطبيق كان بيقف على
  /// شاشة الدخول ومافيش طريقة تعديه: خانة السيرفر كانت جوّه التطبيق بعد الدخول.
  static const defaultBase = 'https://local.technothermeg.com';

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

  /// نص من JSON، والفاضي بيبقى `null`.
  ///
  /// `'' ` و`null` نفس المعنى للي بيقرا — ومن غير التوحيد ده الفئة الفاضية بتبقى فئة
  /// اسمها فراغ في المنتقي، جنب «بدون فئة» اللي المفروض تكون فيها.
  static String? _text(Object? v) {
    final s = v?.toString().trim() ?? '';
    return s.isEmpty ? null : s;
  }

  Future<void> login(String username, String password) async {
    final r = await http
        .post(await _uri('/auth/login'),
            headers: {'Content-Type': 'application/json'},
            // client=mobile -> the server issues a long-lived token (reps sync offline work).
            body: jsonEncode(
                {'username': username, 'password': password, 'client': 'mobile'}))
        .timeout(const Duration(seconds: 20));
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final body = jsonDecode(utf8.decode(r.bodyBytes));
    await LocalDb.instance.setKv('token', body['access_token'] as String);
    await LocalDb.instance.setKv('username', username);
  }

  /// Pull the inspection point-items + lookups + customers into the offline cache.
  Future<void> pullReferenceData() async {
    final headers = await _headers();
    // أصناف المعاينة (حساب النقاط) — the list shown in the app, separate from system products.
    final typesR = await http
        .get(await _uri('/inspections/item-types'), headers: headers)
        .timeout(const Duration(seconds: 60));
    if (typesR.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
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
    // Customers for the regular-visit picker (cached so it works offline).
    final custR = await http
        .get(await _uri('/customers'), headers: headers)
        .timeout(const Duration(seconds: 60));
    // والملّاك من جدولهم، مش من العملاء.
    //
    // صاحب البيت كان متسجّل كعميل بتصنيف «الملّاك»، فخانة المالك في المعاينة كانت
    // بتقلّب في العملاء وتفلتر بالتصنيف. الملّاك اتنقلوا لجدول لوحدهم (٧٠٤٥ صف)،
    // فالتصنيف ده بقى صفر في العملاء — والخانة فضلت بتدوّر في مكان فاضي ومالقيتش حد.
    //
    // الاتنين بينزلوا في نفس الكاش المحلي عشان الخانة تفضل بتشتغل offline بنفس
    // الطريقة، والمالك بيتعلّم بتصنيفه فالفلتر بيمسكه.
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
    try {
      final ownR = await http
          .get(await _uri('/owners', {'limit': '20000'}), headers: headers)
          .timeout(const Duration(seconds: 90));
      if (ownR.statusCode == 200) {
        final body = jsonDecode(utf8.decode(ownR.bodyBytes));
        final rows = (body is List ? body : (body['rows'] as List? ?? []));
        parties.addAll([
          for (final o in rows)
            CustomerRef(
              id: -(o['id'] as int),   // سالب: مفتاح المالك غير مفتاح العميل
              name: o['name'] as String,
              phone: o['phone'] as String?,
              address: o['address'] as String?,
              customerType: 'owner',
            )
        ]);
      }
    } catch (_) {
      // الملّاك إضافة على الكاش — فشل سحبهم مايوقّفش باقي المزامنة.
    }
    if (parties.isNotEmpty) {
      await LocalDb.instance.replaceCustomers(parties);
    }

    await LocalDb.instance.setKv('last_pull', DateTime.now().toIso8601String());
  }

  /// Push every unsynced inspection; marks each one synced on success. Returns how many went up.
  Future<int> pushInspections() async {
    final pending = await LocalDb.instance.pendingSync();
    if (pending.isEmpty) return 0;
    final r = await http
        .post(await _uri('/inspections/sync'),
            headers: await _headers(),
            body: jsonEncode({'inspections': [for (final i in pending) i.toApi()]}))
        .timeout(const Duration(seconds: 120));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final results = jsonDecode(utf8.decode(r.bodyBytes)) as List;
    for (final res in results) {
      final uuid = res['client_uuid'] as String?;
      if (uuid == null) continue;
      await LocalDb.instance.markSynced(uuid, res['document_number'] as String);
      // الصور بعد ما الزيارة نفسها تدخل.
      //
      // A separate request per picture, on purpose: the RECORD is what the books need, and a rep
      // at the edge of coverage should get it in before spending his signal on photographs. A
      // photo that fails to upload leaves the visit synced and tries again next time.
      final id = res['id'];
      if (id is int) {
        try {
          await pushAttachments(uuid, id);
        } catch (_) {/* the visit is in; pictures retry on the next sync */}
      }
    }
    await LocalDb.instance.setKv('last_sync', DateTime.now().toIso8601String());
    return results.length;
  }

  /// بيرفع صور زيارة اتزامنت. بيرجّع عدد اللي اترفع.
  Future<int> pushAttachments(String inspectionUuid, int inspectionId) async {
    final rows = await LocalDb.instance.attachments(inspectionUuid);
    var sent = 0;
    for (final row in rows) {
      if ((row['synced'] as int?) == 1) continue;
      final path = row['path'] as String;
      final file = File(path);
      // A picture the phone cleaned up behind us is marked done rather than retried forever.
      if (!file.existsSync()) {
        await LocalDb.instance.markAttachmentSynced(row['local_id'] as int);
        continue;
      }
      final req = http.MultipartRequest(
        'POST',
        await _uri('/inspections/$inspectionId/attachments'),
      )
        ..headers.addAll(await _headers())
        // Its own uuid so a retry after a dropped connection stores one copy, not three.
        ..fields['client_uuid'] = 'att-$inspectionUuid-${row['local_id']}'
        ..files.add(await http.MultipartFile.fromPath(
          'file',
          path,
          contentType: MediaType('image', _ext(path)),
        ));
      // Content-Type is set per part by MultipartRequest; a JSON one from _headers would break it.
      req.headers.remove('Content-Type');

      final res = await http.Response.fromStream(
          await req.send().timeout(const Duration(seconds: 120)));
      if (res.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
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

  // ------------------------------------------------------------ البيع من العربية

  /// بتسحب كل اللي المندوب محتاجه عشان يبيع من غير شبكة — نداء واحد.
  ///
  /// عملاءه، واللي في عربيته بأرصدته وأسعاره. نداء واحد مش تلاتة عن قصد: المندوب اللي
  /// شبكته بتقطع كان هيقف في نص السحب ويفضل بنص بيانات — عملاء من غير أصناف، أو أصناف
  /// من غير أرصدة. يا يوصل كله يا ما يتغيّرش حاجة.
  Future<void> pullSalesBundle() async {
    final r = await http
        .get(await _uri('/sales/rep-bundle'), headers: await _headers())
        .timeout(const Duration(seconds: 60));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
    if (r.statusCode == 403) throw ApiException(403, 'الشاشة دي للمناديب.');
    if (r.statusCode == 404) throw ApiException(404, 'مالكش عهدة مفتوحة — كلّم المخزن.');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;

    // نوع المكان ورقمه. المندوب ممكن يكون على عهدة أو على مخزن متسجّل عليه، والاتنين
    // بيتبعتوا مختلفين وقت الترحيل — فالجهاز بيحفظ اللي السيرفر قاله مش بيفترض.
    await LocalDb.instance.setKv('store_kind', '${body['store_kind'] ?? 'custody'}');
    await LocalDb.instance.setKv('store_id', '${body['store_id']}');
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
          // الأرصدة بتنزل مع الحزمة عشان تشتغل من غير شبكة — المندوب في الشارع.
          familyBalances: {
            for (final e in ((c['family_balances'] as Map?) ?? const {}).entries)
              e.key as String: double.tryParse('${e.value}') ?? 0,
          },
          balance: double.tryParse('${c['balance'] ?? 0}') ?? 0,
        )
    ]);
    await LocalDb.instance.replaceSaleItems([
      for (final i in (body['items'] as List))
        SaleItem(
          itemId: i['item_id'] as int,
          name: i['name'] as String,
          unit: i['unit'] as String?,
          // الفئة بتتخزّن مع الصنف عشان المنتقي يقدر يقسّم من غير شبكة. الصنف اللي
          // فئته فاضية بيتخزّن بـnull، والشاشة بتلمّه تحت «بدون فئة» — مابيتخفيش.
          category: _text(i['category']),
          onHand: double.tryParse('${i['on_hand']}') ?? 0,
          basePrice: double.tryParse('${i['base_price']}'),
          defaultDiscountPct: double.tryParse('${i['default_discount_pct']}') ?? 0,
          tierPrices: {
            for (final e in ((i['tier_prices'] as Map?) ?? {}).entries)
              e.key.toString(): double.tryParse('${e.value}') ?? 0
          },
        )
    ]);
    // المخازن — عشان إذن التحويل يتكتب والجهاز من غير شبكة.
    await LocalDb.instance.replaceWarehouses([
      for (final w in ((body['warehouses'] as List?) ?? []))
        {'id': w['id'], 'name': '${w['name']}', 'kind': w['kind'] as String?}
    ]);
    // صناديقه هو بس — واحد لكل خط، باسمه اللي على الصندوق في المكتب.
    //
    // بينزلوا مع الحزمة مش وقت الحفظ، لأن المندوب بيكتب في الشارع من غير شبكة. الصندوق
    // بيتحدد من نوع الفاتورة لوحده، والشاشة بتعرضه عشان المندوب يشوف فلوسه رايحة فين.
    //
    // السيرفر القديم مابيرجّعش المفتاح ده — القايمة بتبقى فاضية، والشاشة ساعتها مابتمنعش
    // الحفظ: «مش عارف» مش زي «مالوش صندوق»، واللي بيرحّل هو السيرفر وهو اللي بيرفض.
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
    await LocalDb.instance.setKv('last_sales_pull', DateTime.now().toIso8601String());
  }

  /// بترفع الفواتير اللي على الجهاز. بترجّع عدد اللي طلع.
  ///
  /// كل فاتورة بتروح بـ`client_uuid` بتاعها، فالفاتورة اللي وصلت قبل ما الاتصال يقطع
  /// بيعرفها السيرفر ويرجّعها زي ما هي بدل ما يكتبها تاني. يعني إعادة الرفع آمنة.
  ///
  /// وواحدة واحدة مش دفعة: الفاتورة اللي بتترفض (البضاعة مش موجودة، العميل اتنقل لمندوب
  /// تاني) لازم تتقال لصاحبها بسببها، ودفعة واحدة كانت هتوقّف الباقي معاها.
  Future<int> pushSaleInvoices() async {
    final pending = await LocalDb.instance.saleInvoices(synced: false);
    var sent = 0;
    final storeId = int.tryParse(await LocalDb.instance.getKv('store_id') ?? '');
    final storeKind = await LocalDb.instance.getKv('store_kind') ?? 'custody';
    if (storeId == null && pending.isNotEmpty) {
      throw ApiException(0, 'اسحب البيانات الأول — مخزنك مش معروف على الجهاز.');
    }
    for (final inv in pending) {
      final lines = await LocalDb.instance
          .saleInvoiceLines(inv['local_id'] as int);
      final r = await http
          .post(await _uri('/sales'),
              headers: await _headers(),
              body: jsonEncode({
                'customer_id': inv['customer_id'],
                // خط المنتجات — بيقرّر الفاتورة دي على أنهي مديونية بتنزل.
                'family': inv['family'],
                'origin': {'location_kind': storeKind, 'location_id': storeId},
                'variable_discount_pct': '0',
                'cash_amount': '${inv['cash_amount']}',
                'credit_amount': '${inv['credit_amount']}',
                'invoice_date': inv['invoice_date'],
                'notes': inv['notes'],
                // الكوبونات المصروفة — صف لكل فئة بمداه، زي ما الويب بيبعتها. متخزّنة
                // JSON على صف الفاتورة، فبتتفك هنا وبتتبعت زي ما هي.
                'coupons': inv['coupons'] == null
                    ? const []
                    : jsonDecode(inv['coupons'] as String),
                'client_uuid': inv['client_uuid'],
                'lines': [
                  for (final l in lines)
                    {
                      'item_id': l.itemId,
                      'quantity': '${l.quantity}',
                      'unit_price': '${l.unitPrice}',
                      'discount_pct': '${l.discountPct}',
                    }
                ],
              }))
          .timeout(const Duration(seconds: 90));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
      if (r.statusCode == 200 || r.statusCode == 201) {
        final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
        await LocalDb.instance.markSaleSynced(
            inv['client_uuid'] as String, body['document_number'] as String);
        sent++;
        continue;
      }
      // فاتورة اترفضت مالهاش لازمة تفضل تحاول لوحدها في الخلفية — السبب لازم يوصل للمندوب.
      throw ApiException(r.statusCode,
          'فاتورة ${inv['customer_name']}: ${_error(r)}');
    }
    return sent;
  }

  /// بترفع أذون التحويل اللي المندوب كتبها على الجهاز.
  ///
  /// الإذن بيوصل السيرفر **معلّق** — المندوب بيطلب والمسؤول بيراجع ويعتمد أو يرفض. ده مش
  /// تفصيلة: المندوب مالوش صلاحية الاعتماد عن قصد، والسيرفر هو اللي بيمنعها مش الشاشة.
  ///
  /// الإذن بيتكتب على مرحلتين — المستند الأول وبعده سطوره — لأن السيرفر كده. لو السطور
  /// وقعت بعد ما المستند اتكتب، بيفضل إذن معلّق بسطر واحد على السيرفر: مرئي ومفهوم
  /// وممكن يتعدّل أو يترفض، مش حاجة ضايعة.
  Future<int> pushTransfers() async {
    final pending = await LocalDb.instance.transfers(synced: false);
    var sent = 0;
    for (final t in pending) {
      final lines = await LocalDb.instance.transferLines(t['local_id'] as int);
      if (lines.isEmpty) continue;
      final first = lines.first;

      final r = await http
          .post(await _uri('/transfers'),
              headers: await _headers(),
              body: jsonEncode({
                'item_id': first['item_id'],
                'quantity': first['quantity'],
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
              }))
          .timeout(const Duration(seconds: 60));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
      if (r.statusCode != 200 && r.statusCode != 201) {
        throw ApiException(r.statusCode, 'إذن تحويل: ${_error(r)}');
      }
      final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
      final serverId = body['id'] as int;

      // كل الأصناف بتنزل كسطور — بما فيهم الأول. ترويسة المستند شايلة الأول عشان
      // النسخ القديمة، والسطور هي اللي الاعتماد بيمشي عليها.
      for (final l in lines) {
        await http.post(await _uri('/transfers/$serverId/lines'),
            headers: await _headers(),
            body: jsonEncode({
              'item_id': l['item_id'],
              'quantity': '${l['quantity']}',
            })).timeout(const Duration(seconds: 45));
      }

      await LocalDb.instance.markTransferSynced(
          t['local_id'] as int, serverId, body['document_number'] as String?);
      sent++;
    }
    return sent;
  }

  /// الاتجاه لوحده بيحدّد المسار — نفس خريطة شاشة الويب بالحرف.
  static String _routeFor(String src, String dst) {
    if (src == 'warehouse' && dst == 'warehouse') return 'central_to_branch';
    if (src == 'warehouse' && dst == 'custody') return 'central_to_rep';
    if (src == 'custody' && dst == 'custody') return 'rep_to_rep';
    return 'rep_to_central';
  }

  /// بترفع التحصيلات اللي على الجهاز.
  ///
  /// كل واحد بـ`client_uuid` بتاعه — التحصيل اللي وصل قبل ما الاتصال يقطع بيرجع زي ما هو
  /// بدل ما يتقيّد تاني وينقّص مديونية العميل بالضعف.
  Future<int> pushReceipts() async {
    final pending = await LocalDb.instance.receipts(synced: false);
    var sent = 0;
    for (final row in pending) {
      final r = await http
          .post(await _uri('/vouchers/receipts'),
              headers: await _headers(),
              body: jsonEncode({
                'customer_id': row['customer_id'],
                'amount': '${row['amount']}',
                'voucher_date': row['receipt_date'],
                'description': row['notes'],
                // التحصيل بقى بالخط: المندوب بيتسأل «المدفوع ده أبيض ولا بولي» وقت
                // الكتابة، لأن الفلوس بتنزل في صندوق الخط والمديونية اللي بتتخصم
                // مديونية الخط. التحصيلات القديمة اللي لسه في الطابور من قبل السؤال
                // مالهاش خط — دي بتتوزّع على الإجمالي بالنسبة زي الأول.
                if ((row['family'] as String?) != null)
                  'family': row['family']
                else
                  'on_total': true,
                'client_uuid': row['client_uuid'],
              }))
          .timeout(const Duration(seconds: 60));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
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

  /// ملف العميل — رصيده وحركته. ده **بيحتاج شبكة**: الحركة بتتغيّر من المكتب ومن مناديب
  /// تانيين، ورقم قديم متخزّن على الجهاز أوحش من «مافيش شبكة» لأن الواحد بيصدّقه.
  Future<Map<String, dynamic>> customerProfile(int customerId) async {
    final r = await http
        .get(await _uri('/customers/$customerId/profile'), headers: await _headers())
        .timeout(const Duration(seconds: 30));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
  }

  /// حسابات العميل بالخط — «أبيض» و«بولي» كل واحد برصيده، حي من السيرفر.
  ///
  /// مش من كاش المزامنة عن قصد: الشاشة دي أصلاً محتاجة شبكة (الرصيد بيتغيّر من
  /// المكتب كمان)، ورقم من الكاش جنب رقم حي بيطلعوا مختلفين ومحدش عارف مين الصح.
  Future<List<Map<String, dynamic>>> customerAccounts(int customerId) async {
    final r = await http
        .get(await _uri('/customers/$customerId/accounts'), headers: await _headers())
        .timeout(const Duration(seconds: 30));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    return [
      for (final a in (body['accounts'] as List? ?? const []))
        a as Map<String, dynamic>
    ];
  }

  // ------------------------------------------------------------ coupon receipts

  /// Check one coupon before it is accepted, so the rep learns it is bad while the customer is
  /// still standing there rather than after the handover is posted.
  Future<Map<String, dynamic>> checkCoupon(String serial) async {
    final r = await http
        .get(await _uri('/coupon-receipts/check', {'serial': serial}),
            headers: await _headers())
        .timeout(const Duration(seconds: 20));
    if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
    if (r.statusCode != 200) throw ApiException(r.statusCode, _error(r));
    return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
  }

  /// Push every queued handover. Each carries its client_uuid, so a receipt that went up before
  /// the connection dropped is recognised by the server instead of being posted twice.
  Future<int> pushCouponReceipts() async {
    final pending = await LocalDb.instance.couponReceipts(synced: false);
    var sent = 0;
    for (final row in pending) {
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
                // اللي المندوب قاله على الجهاز — بيوصل زي ما هو، والسيرفر بيفضل يتحقق من السريالات.
                'received_date': row['received_date'],
                'declared_kind': row['coupon_kind'],
                'declared_value': row['coupon_value'],
                'customer_type': row['customer_type'],
              }))
          .timeout(const Duration(seconds: 60));
      if (r.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
      if (r.statusCode == 201) {
        final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
        await LocalDb.instance.markCouponReceiptSynced(
            row['client_uuid'] as String, body['document_number'] as String);
        sent++;
        continue;
      }
      // A rejected handover must not sit in the queue retrying forever — the coupons were
      // refused for a reason the rep needs to hear, so surface it and stop.
      throw ApiException(r.statusCode, _error(r));
    }
    return sent;
  }
}
