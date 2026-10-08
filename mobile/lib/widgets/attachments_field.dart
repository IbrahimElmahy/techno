import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../theme.dart';

class AttachmentsField extends StatelessWidget {
  const AttachmentsField({
    super.key,
    required this.items,
    required this.onAdd,
    required this.onRemove,
  });

  final List<AttachmentRef> items;
  final void Function(AttachmentRef added) onAdd;
  final void Function(AttachmentRef removed) onRemove;

  Future<void> _pick(BuildContext context, _Source source) async {
    try {
      final picked = await _read(source);
      if (picked == null) return;
      final saved = await _keep(picked);
      onAdd(saved);
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('تعذّر إضافة المرفق: $e')));
    }
  }

  Future<AttachmentRef?> _read(_Source source) async {
    switch (source) {
      case _Source.camera:
      case _Source.gallery:
        final shot = await ImagePicker().pickImage(
          source: source == _Source.camera ? ImageSource.camera : ImageSource.gallery,
          maxWidth: 1600,
          imageQuality: 80,
        );
        if (shot == null) return null;
        return AttachmentRef(path: shot.path, name: p.basename(shot.path), kind: 'image');
    }
  }

  Future<AttachmentRef> _keep(AttachmentRef picked) async {
    if (kIsWeb) return picked;

    final dir = Directory(p.join((await getApplicationDocumentsDirectory()).path, 'attachments'));
    if (!dir.existsSync()) dir.createSync(recursive: true);
    final stamp = DateTime.now().microsecondsSinceEpoch;
    final target = p.join(dir.path, '$stamp-${p.basename(picked.path)}');
    final copy = await File(picked.path).copy(target);
    return AttachmentRef(
      path: copy.path,
      name: picked.name,
      kind: picked.kind,
      bytes: await copy.length(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.attach_file, size: 18, color: AppColors.primary),
            const SizedBox(width: 6),
            const Text('المرفقات', style: TextStyle(fontWeight: FontWeight.w700)),
            const Spacer(),
            if (items.isNotEmpty)
              Text('${items.length}',
                  style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.primary)),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _AddButton(
              icon: Icons.photo_camera_outlined,
              label: 'كاميرا',
              onTap: () => _pick(context, _Source.camera),
            ),
            _AddButton(
              icon: Icons.photo_library_outlined,
              label: 'من الصور',
              onTap: () => _pick(context, _Source.gallery),
            ),
          ],
        ),
        if (items.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [for (final a in items) _Thumb(item: a, onRemove: () => onRemove(a))],
          ),
        ],
      ],
    );
  }
}

enum _Source { camera, gallery }

class AttachmentRef {
  const AttachmentRef({
    required this.path,
    this.name,
    this.kind,
    this.bytes,
    this.localId,
  });

  final String path;
  final String? name;
  final String? kind;
  final int? bytes;

  final int? localId;

  bool get isImage => kind == 'image';

  AttachmentRef withLocalId(int id) =>
      AttachmentRef(path: path, name: name, kind: kind, bytes: bytes, localId: id);
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 18),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.item, required this.onRemove});

  final AttachmentRef item;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          width: 82,
          height: 82,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.blueGrey.shade100),
          ),
          clipBehavior: Clip.antiAlias,
          child: item.isImage && !kIsWeb
              ? Image.file(
                  File(item.path),
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const _FileTile(),
                )
              : const _FileTile(),
        ),
        PositionedDirectional(
          top: -6,
          end: -6,
          child: InkWell(
            onTap: onRemove,
            child: Container(
              padding: const EdgeInsets.all(3),
              decoration: const BoxDecoration(color: AppColors.danger, shape: BoxShape.circle),
              child: const Icon(Icons.close, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

class _FileTile extends StatelessWidget {
  const _FileTile();

  @override
  Widget build(BuildContext context) => const Center(
        child: Icon(Icons.insert_drive_file_outlined, color: AppColors.primary),
      );
}
