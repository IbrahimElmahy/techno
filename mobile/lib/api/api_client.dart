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

  static const defaultBase = 'https://api.technothermeg.com';

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

    for (final category in ['inspection_description', 'inspection_type']) {
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
    if (custR.statusCode == 200) {
      final rows = jsonDecode(utf8.decode(custR.bodyBytes)) as List;
      await LocalDb.instance.replaceCustomers([
        for (final c in rows)
          CustomerRef(
            id: c['id'] as int,
            name: c['name'] as String,
            phone: c['phone'] as String?,
            address: c['address'] as String?,
          )
      ]);
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
