import 'dart:convert';

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

  /// Pull the item catalog + point values + the two inspection lookups into the offline cache.
  Future<void> pullReferenceData() async {
    final headers = await _headers();
    final itemsR = await http
        .get(await _uri('/items'), headers: headers)
        .timeout(const Duration(seconds: 60));
    if (itemsR.statusCode == 401) throw ApiException(401, 'انتهت الجلسة — سجّل الدخول تاني');
    if (itemsR.statusCode != 200) throw ApiException(itemsR.statusCode, _error(itemsR));
    final items = (jsonDecode(utf8.decode(itemsR.bodyBytes)) as List)
        .where((it) => it['active'] == true && it['kind'] == 'product');

    final pointsR = await http
        .get(await _uri('/products/point-values'), headers: headers)
        .timeout(const Duration(seconds: 30));
    final pointsByItem = <int, double>{};
    if (pointsR.statusCode == 200) {
      for (final row in jsonDecode(utf8.decode(pointsR.bodyBytes)) as List) {
        pointsByItem[row['item_id'] as int] =
            double.tryParse(row['point_value'].toString()) ?? 0;
      }
    }
    await LocalDb.instance.replaceCatalog([
      for (final it in items)
        CatalogItem(
          id: it['id'] as int,
          name: it['name'] as String,
          category: it['category'] as String?,
          points: pointsByItem[it['id']] ?? 0,
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
      if (uuid != null) {
        await LocalDb.instance.markSynced(uuid, res['document_number'] as String);
      }
    }
    await LocalDb.instance.setKv('last_sync', DateTime.now().toIso8601String());
    return results.length;
  }
}
