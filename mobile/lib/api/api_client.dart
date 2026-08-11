import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

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
    final u = username.trim();
    final p = password.trim();

    // 1. Try remote API with short 3-second timeout
    try {
      final r = await http
          .post(await _uri('/auth/login'),
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode({'username': u, 'password': p, 'client': 'mobile'}))
          .timeout(const Duration(seconds: 3));
      if (r.statusCode == 200) {
        final body = jsonDecode(utf8.decode(r.bodyBytes));
        await LocalDb.instance.setKv('token', body['access_token'] as String);
        await LocalDb.instance.setKv('username', u);
        await rememberOfflineCredential(u, p);
        return;
      }
    } catch (_) {
      // Remote API unreachable or timed out — try local backend on port 8000
      try {
        final localUri = Uri.parse('http://127.0.0.1:8000/api/v1/auth/login');
        final r = await http
            .post(localUri,
                headers: {'Content-Type': 'application/json'},
                body: jsonEncode({'username': u, 'password': p, 'client': 'mobile'}))
            .timeout(const Duration(seconds: 2));
        if (r.statusCode == 200) {
          final body = jsonDecode(utf8.decode(r.bodyBytes));
          await LocalDb.instance.setKv('api_base', 'http://127.0.0.1:8000');
          await LocalDb.instance.setKv('token', body['access_token'] as String);
          await LocalDb.instance.setKv('username', u);
          await rememberOfflineCredential(u, p);
          return;
        }
      } catch (_) {}
    }

    // 2. الدخول من غير نت — لمين سجّل دخول صح على الجهاز ده قبل كده، وبس.
    //
    // This used to end in `|| u.isNotEmpty`, which meant ANY username with ANY password — an empty
    // one included — was let in the moment the server did not answer within three seconds. Whoever
    // picked the phone up was inside, reading every cached customer and writing inspections that
    // would later sync into the ERP under that name. The three-second timeout made it trivial to
    // reach: turn the wifi off.
    //
    // A rep genuinely has to work with no signal, so offline entry stays — but only for somebody
    // this device has already seen log in successfully, checked against what they typed then.
    if (await _matchesRemembered(u, p)) {
      await LocalDb.instance.setKv('token', 'local_offline_token_$u');
      await LocalDb.instance.setKv('username', u);
      return;
    }

    // Demo accounts are for development only. Shipping them means two passwords that open the app
    // for anybody who has ever seen the manual.
    if (kDebugMode && ((u == 'rep' && p == 'rep123') || (u == 'admin' && p == 'admin123'))) {
      await LocalDb.instance.setKv('token', 'local_offline_token_$u');
      await LocalDb.instance.setKv('username', u);
      return;
    }

    throw ApiException(401, await _everLoggedIn(u)
        ? 'اسم المستخدم أو كلمة المرور غير صحيحة'
        : 'مفيش نت دلوقتي، وإنت لسه ما دخلتش على الجهاز ده قبل كده. '
            'لازم تسجّل دخول مرة وإنت متصل الأول.');
  }

  /// بصمة الباسورد على الجهاز ده — عشان الدخول من غير نت يفضل ممكن من غير ما يبقى مفتوح للكل.
  ///
  /// Salted per install, so the stored value cannot be compared against another device's. This is
  /// not meant to survive somebody taking the phone apart at leisure — it is meant to stop the
  /// phone being picked up off a desk and used.
  Future<String> _fingerprint(String username, String password) async {
    var salt = await LocalDb.instance.getKv('offline_auth_salt');
    if (salt == null) {
      final rnd = Random.secure();
      salt = base64Url.encode(List<int>.generate(24, (_) => rnd.nextInt(256)));
      await LocalDb.instance.setKv('offline_auth_salt', salt);
    }
    return sha256.convert(utf8.encode('$salt|$username|$password')).toString();
  }

  /// بيسجّل إن الشخص ده دخل صح على الجهاز ده — بينادى بعد كل دخول ناجح وإنت أونلاين.
  @visibleForTesting
  Future<void> rememberOfflineCredential(String username, String password) async {
    await LocalDb.instance
        .setKv('offline_auth_$username', await _fingerprint(username, password));
  }

  Future<bool> _everLoggedIn(String username) async =>
      (await LocalDb.instance.getKv('offline_auth_$username')) != null;

  Future<bool> _matchesRemembered(String username, String password) async {
    final stored = await LocalDb.instance.getKv('offline_auth_$username');
    if (stored == null || password.isEmpty) return false;
    return stored == await _fingerprint(username, password);
  }

  /// Pull the inspection point-items + lookups + customers into the offline cache.
  Future<void> pullReferenceData() async {
    try {
      final headers = await _headers();
      final typesR = await http
          .get(await _uri('/inspections/item-types'), headers: headers)
          .timeout(const Duration(seconds: 3));
      if (typesR.statusCode == 200) {
        final types = jsonDecode(utf8.decode(typesR.bodyBytes)) as List;
        await LocalDb.instance.replaceItemTypes([
          for (final t in types)
            CatalogItem(
              id: t['id'] as int,
              name: t['name'] as String,
              points: double.tryParse(t['points'].toString()) ?? 0,
            )
        ]);
      }

      for (final category in ['inspection_description', 'inspection_type']) {
        final r = await http
            .get(await _uri('/settings/lookups', {'category': category}), headers: headers)
            .timeout(const Duration(seconds: 2));
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

      final custR = await http
          .get(await _uri('/customers'), headers: headers)
          .timeout(const Duration(seconds: 3));
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
    } catch (_) {}
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
      if (uuid != null) {
        await LocalDb.instance.markSynced(uuid, res['document_number'] as String);
      }
    }
    await LocalDb.instance.setKv('last_sync', DateTime.now().toIso8601String());
    return results.length;
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
