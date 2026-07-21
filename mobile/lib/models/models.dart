/// Plain models shared by the local DB, API client, and screens.
library;

class CatalogItem {
  final int id;
  final String name;
  final String? category;
  final double points; // point value per unit (fractional)
  final double? myStock; // what the rep carries in his custody (null = no custody info)

  const CatalogItem(
      {required this.id, required this.name, this.category, this.points = 0, this.myStock});

  Map<String, Object?> toRow() =>
      {'id': id, 'name': name, 'category': category, 'points': points, 'my_stock': myStock};

  static CatalogItem fromRow(Map<String, Object?> r) => CatalogItem(
        id: r['id'] as int,
        name: r['name'] as String,
        category: r['category'] as String?,
        points: (r['points'] as num?)?.toDouble() ?? 0,
        myStock: (r['my_stock'] as num?)?.toDouble(),
      );
}

class CustomerRef {
  final int id;
  final String name;
  final String? phone;
  final String? address;
  const CustomerRef({required this.id, required this.name, this.phone, this.address});
}

class LookupOption {
  final String category;
  final String value;
  final String label;
  final int sort;

  const LookupOption(
      {required this.category, required this.value, required this.label, this.sort = 0});

  static LookupOption fromRow(Map<String, Object?> r) => LookupOption(
        category: r['category'] as String,
        value: r['value'] as String,
        label: r['label'] as String,
        sort: (r['sort'] as int?) ?? 0,
      );
}

class InspectionLine {
  final int? itemId;
  final String itemName;
  double quantity;
  double points;

  InspectionLine(
      {this.itemId, required this.itemName, required this.quantity, required this.points});

  double get total => double.parse((quantity * points).toStringAsFixed(3));
}

class Inspection {
  final int? localId;
  final String clientUuid;
  final String visitKind; // technician | regular
  String inspectionDate; // yyyy-MM-dd
  String ownerName;
  String? ownerPhone;
  String? nationalId;
  String? ownerAddress;
  String? floorNumber;
  String? description; // توصيف المعاينة
  String? inspectionType; // نوع المعاينة
  String? technicianName;
  String? technicianPhone;
  String? purchaseShop;
  String? visitDetails;
  int? customerId; // الزيارة العادية مرتبطة بعميل
  List<InspectionLine> lines;
  final bool synced;
  final String? documentNumber;
  final String? createdAt;

  Inspection({
    this.localId,
    required this.clientUuid,
    required this.visitKind,
    required this.inspectionDate,
    required this.ownerName,
    this.ownerPhone,
    this.nationalId,
    this.ownerAddress,
    this.floorNumber,
    this.description,
    this.inspectionType,
    this.technicianName,
    this.technicianPhone,
    this.purchaseShop,
    this.visitDetails,
    this.customerId,
    List<InspectionLine>? lines,
    this.synced = false,
    this.documentNumber,
    this.createdAt,
  }) : lines = lines ?? [];

  double get totalPoints =>
      double.parse(lines.fold<double>(0, (s, l) => s + l.total).toStringAsFixed(3));

  /// Payload for POST /inspections/sync.
  Map<String, Object?> toApi() => {
        'client_uuid': clientUuid,
        'visit_kind': visitKind,
        'inspection_date': inspectionDate,
        'owner_name': ownerName,
        'owner_phone': ownerPhone,
        'national_id': nationalId,
        'owner_address': ownerAddress,
        'floor_number': floorNumber,
        'description': description,
        'inspection_type': inspectionType,
        'technician_name': technicianName,
        'technician_phone': technicianPhone,
        'purchase_shop': purchaseShop,
        'visit_details': visitDetails,
        'customer_id': customerId,
        'items': [
          for (final l in lines)
            {
              'item_id': l.itemId,
              'item_name': l.itemName,
              'quantity': l.quantity.toString(),
              'points': l.points.toString(),
            }
        ],
      };
}
