import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import 'package:printing/printing.dart';

import '../db/local_db.dart';

const thermalFormat =
    PdfPageFormat(100 * PdfPageFormat.mm, 600 * PdfPageFormat.mm);

bool isRoll(PdfPageFormat f) => f.width < 120 * PdfPageFormat.mm;

const _dots = 576;
const _macKey = 'thermal_printer_mac';
const _nameKey = 'thermal_printer_name';

class ThermalPrintButton extends StatelessWidget {
  final bool enabled;
  final Future<Uint8List> Function(PdfPageFormat format) pdf;

  const ThermalPrintButton({super.key, required this.enabled, required this.pdf});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: enabled ? () => printThermal(context, pdf) : null,
            icon: const Icon(Icons.receipt_long),
            label: const Text('طباعة على الطابعة الحرارية'),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
          ),
        ),
        const SizedBox(width: 6),
        IconButton.outlined(
          tooltip: 'تغيير الطابعة',
          onPressed: enabled ? () => _choosePrinter(context) : null,
          icon: const Icon(Icons.settings_bluetooth),
        ),
      ],
    );
  }
}

void _say(BuildContext context, String msg) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg)));
}

Future<bool> _ready(BuildContext context) async {
  if (!await PrintBluetoothThermal.isPermissionBluetoothGranted) {
    if (context.mounted) _say(context, 'يلزم السماح للتطبيق باستخدام البلوتوث للطباعة.');
    return false;
  }
  if (!await PrintBluetoothThermal.bluetoothEnabled) {
    if (context.mounted) _say(context, 'يرجى تشغيل البلوتوث في الهاتف ثم إعادة المحاولة.');
    return false;
  }
  return true;
}

Future<String?> _choosePrinter(BuildContext context) async {
  if (!await _ready(context) || !context.mounted) return null;
  final devices = await PrintBluetoothThermal.pairedBluetooths;
  if (!context.mounted) return null;
  if (devices.isEmpty) {
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('لا توجد طابعة مقترنة'),
        content: const Text(
            'شغّل الطابعة، ثم افتح إعدادات البلوتوث في الهاتف واقرن الطابعة، ثم عد إلى هنا.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('حسناً'))],
      ),
    );
    return null;
  }
  final saved = await LocalDb.instance.getKv(_macKey);
  if (!context.mounted) return null;
  final picked = await showDialog<BluetoothInfo>(
    context: context,
    builder: (ctx) => SimpleDialog(
      title: const Text('اختر الطابعة'),
      children: [
        for (final d in devices)
          ListTile(
            leading: Icon(d.macAdress == saved ? Icons.check_circle : Icons.print_outlined),
            title: Text(d.name.isEmpty ? d.macAdress : d.name),
            subtitle: Text(d.macAdress, textDirection: TextDirection.ltr),
            onTap: () => Navigator.pop(ctx, d),
          ),
      ],
    ),
  );
  if (picked == null) return null;
  await LocalDb.instance.setKv(_macKey, picked.macAdress);
  await LocalDb.instance.setKv(_nameKey, picked.name);
  await PrintBluetoothThermal.disconnect;
  return picked.macAdress;
}

Future<void> printThermal(
    BuildContext context, Future<Uint8List> Function(PdfPageFormat format) build) async {
  if (!await _ready(context) || !context.mounted) return;
  var mac = await LocalDb.instance.getKv(_macKey);
  if (!context.mounted) return;
  if (mac == null || mac.isEmpty) {
    mac = await _choosePrinter(context);
    if (mac == null || !context.mounted) return;
  }

  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const PopScope(
      canPop: false,
      child: AlertDialog(
        content: Row(children: [
          CircularProgressIndicator(),
          SizedBox(width: 16),
          Expanded(child: Text('جارٍ الطباعة…')),
        ]),
      ),
    ),
  );
  String? error;
  try {
    final data = await _render(build);
    var ok = await PrintBluetoothThermal.connectionStatus;
    if (!ok) ok = await PrintBluetoothThermal.connect(macPrinterAddress: mac);
    if (!ok) {
      error = 'تعذّر الاتصال بالطابعة. تأكد أنها مشغّلة وقريبة من الهاتف.';
    } else if (!await PrintBluetoothThermal.writeBytes(data)) {
      await PrintBluetoothThermal.disconnect;
      if (await PrintBluetoothThermal.connect(macPrinterAddress: mac) &&
          await PrintBluetoothThermal.writeBytes(data)) {
        error = null;
      } else {
        error = 'انقطع الاتصال بالطابعة أثناء الإرسال. أعد المحاولة.';
      }
    }
  } catch (e) {
    error = 'تعذّرت الطباعة: $e';
  }
  if (!context.mounted) return;
  Navigator.of(context, rootNavigator: true).pop();
  if (error == null) return;
  final retry = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('لم تتم الطباعة'),
      content: Text(error!),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, 'change'), child: const Text('اختيار طابعة أخرى')),
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إغلاق')),
        FilledButton(onPressed: () => Navigator.pop(ctx, 'retry'), child: const Text('إعادة المحاولة')),
      ],
    ),
  );
  if (!context.mounted || retry == null) return;
  if (retry == 'change' && await _choosePrinter(context) == null) return;
  if (context.mounted) await printThermal(context, build);
}

Future<List<int>> _render(Future<Uint8List> Function(PdfPageFormat format) build) async {
  final pdf = await build(thermalFormat);
  final dpi = _dots * 72 / thermalFormat.width;
  const rowBytes = _dots ~/ 8;
  final rows = <Uint8List>[];
  await for (final page in Printing.raster(pdf, dpi: dpi)) {
    final w = page.width < _dots ? page.width : _dots;
    final px = page.pixels;
    final pageRows = <Uint8List>[];
    var first = -1, last = -1;
    for (var y = 0; y < page.height; y++) {
      final row = Uint8List(rowBytes);
      var any = false;
      for (var x = 0; x < w; x++) {
        final i = (y * page.width + x) * 4;
        if (px[i + 3] < 128) continue;
        final lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) ~/ 1000;
        if (lum < 200) {
          row[x >> 3] |= 0x80 >> (x & 7);
          any = true;
        }
      }
      if (any) { if (first < 0) first = y; last = y; }
      pageRows.add(row);
    }
    if (last >= 0) rows.addAll(pageRows.sublist(rows.isEmpty ? first : 0, last + 1));
  }

  final out = BytesBuilder();
  out.add(const [0x1B, 0x40]);
  const chunk = 240;
  for (var start = 0; start < rows.length; start += chunk) {
    final n = (rows.length - start) < chunk ? rows.length - start : chunk;
    out.add([0x1D, 0x76, 0x30, 0x00, rowBytes & 0xFF, rowBytes >> 8, n & 0xFF, n >> 8]);
    for (var k = 0; k < n; k++) {
      out.add(rows[start + k]);
    }
  }
  out.add(const [0x1B, 0x64, 0x06, 0x1D, 0x56, 0x42, 0x00]);
  return List<int>.of(out.takeBytes(), growable: false);
}
