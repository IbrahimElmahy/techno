library;

import 'discount.dart';

class CatalogItem {
  final int id;
  final String name;
  final String? category;
  final double points;
  final double? myStock;

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
  final String? priceTier;

  final String? customerType;

  final List<String> families;

  final Map<String, double> familyBalances;

  final double balance;

  const CustomerRef({
    required this.id,
    required this.name,
    this.phone,
    this.address,
    this.priceTier,
    this.customerType,
    this.families = const [],
    this.familyBalances = const {},
    this.balance = 0,
  });
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
  final String visitKind;
  String inspectionDate;
  String ownerName;
  String? ownerPhone;
  String? nationalId;
  String? ownerAddress;
  String? floorNumber;
  String? description;
  String? inspectionType;
  String? visitType;
  String? technicianName;
  String? technicianPhone;
  String? purchaseShop;
  String? purchaseShopPhone;
  int? merchantCustomerId;
  String? visitDetails;
  int? customerId;
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
    this.visitType,
    this.technicianName,
    this.technicianPhone,
    this.purchaseShop,
    this.purchaseShopPhone,
    this.merchantCustomerId,
    this.visitDetails,
    this.customerId,
    List<InspectionLine>? lines,
    this.synced = false,
    this.documentNumber,
    this.createdAt,
  }) : lines = lines ?? [];

  double get totalPoints =>
      double.parse(lines.fold<double>(0, (s, l) => s + l.total).toStringAsFixed(3));

  Map<String, Object?> toDraft() => {
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
        'visit_type': visitType,
        'technician_name': technicianName,
        'technician_phone': technicianPhone,
        'purchase_shop': purchaseShop,
        'merchant_customer_id': merchantCustomerId,
        'purchase_shop_phone': purchaseShopPhone,
        'visit_details': visitDetails,
        'customer_id': customerId,
        'lines': [
          for (final l in lines)
            {
              'item_id': l.itemId,
              'item_name': l.itemName,
              'quantity': l.quantity,
              'points': l.points,
            }
        ],
      };

  static Inspection fromDraft(Map<String, Object?> m) {
    String? s(String k) {
      final v = m[k];
      return v == null ? null : '$v';
    }

    int? i(String k) {
      final v = m[k];
      return v is int ? v : int.tryParse('${v ?? ''}');
    }

    double d(Object? v) => v is num ? v.toDouble() : double.tryParse('${v ?? ''}') ?? 0;

    return Inspection(
      clientUuid: s('client_uuid') ?? '',
      visitKind: s('visit_kind') ?? 'technician',
      inspectionDate: s('inspection_date') ?? '',
      ownerName: s('owner_name') ?? '',
      ownerPhone: s('owner_phone'),
      nationalId: s('national_id'),
      ownerAddress: s('owner_address'),
      floorNumber: s('floor_number'),
      description: s('description'),
      inspectionType: s('inspection_type'),
      visitType: s('visit_type'),
      technicianName: s('technician_name'),
      technicianPhone: s('technician_phone'),
      purchaseShop: s('purchase_shop'),
      merchantCustomerId: i('merchant_customer_id'),
      purchaseShopPhone: s('purchase_shop_phone'),
      visitDetails: s('visit_details'),
      customerId: i('customer_id'),
      lines: [
        for (final l in (m['lines'] as List? ?? const []))
          if (l is Map)
            InspectionLine(
              itemId: l['item_id'] is int ? l['item_id'] as int : null,
              itemName: '${l['item_name'] ?? ''}',
              quantity: d(l['quantity']),
              points: d(l['points']),
            )
      ],
      createdAt: s('updated_at'),
    );
  }

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
        'visit_type': visitType,
        'technician_name': technicianName,
        'technician_phone': technicianPhone,
        'purchase_shop': purchaseShop,
        'merchant_customer_id': merchantCustomerId,
        'purchase_shop_phone': purchaseShopPhone,
        'visit_details': visitDetails,
        'customer_id': (customerId != null && customerId! > 0) ? customerId : null,
        'owner_id': (customerId != null && customerId! < 0) ? -customerId! : null,
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

class SaleItem {
  final int itemId;
  final String name;
  final String? unit;

  final String? category;
  final double onHand;

  final double pendingOut;

  double get sellable {
    final v = onHand - pendingOut;
    return v > 0 ? v : 0;
  }
  final double? basePrice;
  final double defaultDiscountPct;
  final Map<String, double> tierPrices;

  final double? minPrice;

  const SaleItem({
    required this.itemId,
    required this.name,
    this.unit,
    this.category,
    this.onHand = 0,
    this.pendingOut = 0,
    this.basePrice,
    this.defaultDiscountPct = 0,
    this.tierPrices = const {},
    this.minPrice,
  });

  double priceFor(String? tier) =>
      (tier != null ? tierPrices[tier] : null) ?? basePrice ?? 0;

  double netPriceFor(String? tier) =>
      priceFor(tier) * (1 - defaultDiscountPct.clamp(0, 99.99) / 100);

  Map<String, Object?> toRow() => {
        'item_id': itemId,
        'name': name,
        'unit': unit,
        'category': category,
        'on_hand': onHand,
        'pending_out': pendingOut,
        'base_price': basePrice,
        'default_discount_pct': defaultDiscountPct,
        'tier_prices': tierPrices.entries.map((e) => '${e.key}=${e.value}').join(','),
        'min_price': minPrice,
      };

  static SaleItem fromRow(Map<String, Object?> r) => SaleItem(
        itemId: r['item_id'] as int,
        name: r['name'] as String,
        unit: r['unit'] as String?,
        category: r['category'] as String?,
        onHand: (r['on_hand'] as num?)?.toDouble() ?? 0,
        pendingOut: (r['pending_out'] as num?)?.toDouble() ?? 0,
        basePrice: (r['base_price'] as num?)?.toDouble(),
        defaultDiscountPct: (r['default_discount_pct'] as num?)?.toDouble() ?? 0,
        tierPrices: {
          for (final part in ((r['tier_prices'] as String?) ?? '').split(','))
            if (part.contains('=')) part.split('=')[0]: double.tryParse(part.split('=')[1]) ?? 0
        },
        minPrice: (r['min_price'] as num?)?.toDouble(),
      );
}

class SaleDraftLine {
  final int itemId;
  final String itemName;
  double quantity;
  double unitPrice;
  double fixedDiscountPct;
  double variableDiscountPct;

  SaleDraftLine({
    required this.itemId,
    required this.itemName,
    this.quantity = 1,
    this.unitPrice = 0,
    this.fixedDiscountPct = 0,
    this.variableDiscountPct = 0,
  });

  double get discountPct => isFull
      ? 100
      : combineDiscounts([fixedDiscountPct, variableDiscountPct]);

  bool get isFull => fixedDiscountPct >= 100 || variableDiscountPct >= 100;

  double get gross => quantity * unitPrice;
  double get net => netOf(gross, discountPct);

  Map<String, Object?> toRow(int invoiceLocalId) => {
        'invoice_local_id': invoiceLocalId,
        'item_id': itemId,
        'item_name': itemName,
        'quantity': quantity,
        'unit_price': unitPrice,
        'discount_pct': discountPct,
        'fixed_discount_pct': fixedDiscountPct,
        'variable_discount_pct': variableDiscountPct,
        'line_total': net,
      };

  static SaleDraftLine fromRow(Map<String, Object?> r) {
    final fixed = (r['fixed_discount_pct'] as num?)?.toDouble();
    final variable = (r['variable_discount_pct'] as num?)?.toDouble();
    return SaleDraftLine(
      itemId: r['item_id'] as int,
      itemName: r['item_name'] as String,
      quantity: (r['quantity'] as num?)?.toDouble() ?? 0,
      unitPrice: (r['unit_price'] as num?)?.toDouble() ?? 0,
      fixedDiscountPct: fixed ?? (r['discount_pct'] as num?)?.toDouble() ?? 0,
      variableDiscountPct: variable ?? 0,
    );
  }
}

class RepTreasury {
  final int custodyId;
  final int accountId;
  final String? family;

  final String name;
  final String code;

  const RepTreasury({
    required this.custodyId,
    required this.accountId,
    this.family,
    this.name = '',
    this.code = '',
  });

  String get label => name.trim().isNotEmpty
      ? name.trim()
      : (family == null ? 'عهدتك' : 'صندوق $family');

  Map<String, Object?> toRow() => {
        'custody_id': custodyId,
        'account_id': accountId,
        'family': family,
        'name': name,
        'code': code,
      };

  static RepTreasury fromRow(Map<String, Object?> r) => RepTreasury(
        custodyId: r['custody_id'] as int,
        accountId: (r['account_id'] as int?) ?? 0,
        family: r['family'] as String?,
        name: (r['name'] as String?) ?? '',
        code: (r['code'] as String?) ?? '',
      );
}
