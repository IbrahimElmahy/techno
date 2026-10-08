import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart'
    show MethodChannel, MissingPluginException, PlatformException;
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';

const _whatsapp = MethodChannel('techno/whatsapp');

String? whatsappNumber(String? raw) {
  var d = (raw ?? '').replaceAll(RegExp(r'\D'), '');
  if (d.startsWith('00')) d = d.substring(2);
  if (d.length == 11 && d.startsWith('01')) return '2$d';
  if (d.length == 10 && d.startsWith('1')) return '20$d';
  if (d.startsWith('20') && d.length >= 12) return d;
  return d.length >= 10 ? d : null;
}

String safeFileName(String raw) => raw
    .replaceAll(RegExp(r'[\\/:*?"<>|]'), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

Future<void> sendPdfToWhatsApp(
  BuildContext context, {
  required Uint8List bytes,
  required String fileTitle,
  required String? phone,
  required String text,
  String subdir = 'invoices',
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final number = whatsappNumber(phone);

  Future<void> fallback(String? why) async {
    if (why != null) {
      messenger.showSnackBar(SnackBar(content: Text(why)));
    }
    await Printing.sharePdf(bytes: bytes, filename: '$fileTitle.pdf');
  }

  if (!Platform.isAndroid) return fallback(null);
  if (number == null) {
    return fallback('العميل مالوش رقم متسجل — اختار من المشاركة');
  }
  try {
    final dir = Directory('${(await getTemporaryDirectory()).path}/$subdir');
    await dir.create(recursive: true);
    final file = File('${dir.path}/$fileTitle.pdf');
    await file.writeAsBytes(bytes, flush: true);
    await _whatsapp.invokeMethod('sendFile', {
      'path': file.path,
      'phone': number,
      'text': text,
    });
  } on PlatformException catch (e) {
    await fallback(e.code == 'NOT_INSTALLED'
        ? 'واتساب مش متثبت على الجهاز — اختار من المشاركة'
        : 'ماقدرناش نفتح واتساب — اختار من المشاركة');
  } on MissingPluginException {
    await fallback('ماقدرناش نفتح واتساب — اختار من المشاركة');
  } catch (_) {
    await fallback('ماقدرناش نفتح واتساب — اختار من المشاركة');
  }
}
