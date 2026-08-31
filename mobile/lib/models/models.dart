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
  /// فئة سعر العميل — هي اللي بتقرّر بكام الصنف يتباع له، فبتنزل معاه في حزمة البيع.
  final String? priceTier;

  /// تصنيف العميل («تاجر»، «الملّاك»، …). قائمة حرة في النظام، فبينزل نص زي ما هو.
  final String? customerType;

  /// خطوط المنتجات اللي للعميل حساب عليها — «أبيض»، «بولي».
  ///
  /// العميل الواحد ممكن يبقى مديون على الخطين بحسابين منفصلين، والفاتورة لازم تقول على
  /// أنهي واحد فيهم. من غير القايمة دي التطبيق مش هيعرف يسأل، والفاتورة بتنزل على
  /// المديونية الغلط — وده اللي بيخلّي كشف حساب العميل يطلع مالوش معنى.
  final List<String> families;

  /// رصيد كل خط لوحده — «أبيض» و«بولي» — زي ما شاشة الفاتورة على النظام بتوريه.
  ///
  /// المندوب واقف قدام العميل وبيقول له عليك كام. رقم واحد مجمّع مابيردّش على السؤال
  /// ده: العميل بيسأل «الأبيض بكام؟» لأن الفلوس بتتحصّل بالخط والصناديق مقسومة بالخط.
  final Map<String, double> familyBalances;

  /// إجمالي المديونية — مجموع الخطوط. بينزل من السيرفر مش بيتجمع هنا: العميل ممكن
  /// يكون له حساب مالوش خط (كارت قديم قبل التقسيم) وده مابيبانش في القايمة فوق.
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
  final String visitKind; // technician | regular
  String inspectionDate; // yyyy-MM-dd
  String ownerName;
  String? ownerPhone;
  String? nationalId;
  String? ownerAddress;
  String? floorNumber;
  String? description; // توصيف المعاينة
  String? inspectionType; // نوع المعاينة
  String? visitType; // نوع الزيارة — معاينة/مرمة
  String? technicianName;
  String? technicianPhone;
  String? purchaseShop;
  String? purchaseShopPhone;
  /// التاجر اللي «محل الشراء» بيشاور عليه — رقمه عندنا مش اسمه.
  ///
  /// الاسم كان بيتبعت لوحده، فالمعاينة توصل السيرفر ومعاها نص مالوش طرف. ومن غير
  /// الطرف ده مافيش حد تتخصم منه نقط المعاينة وقت القبول: الخصم بيدوّر على
  /// `merchant_customer_id` ويلاقيه فاضي ويعدّي بتحذير في اللوج.
  int? merchantCustomerId;
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
        'visit_type': visitType,
        'technician_name': technicianName,
        'technician_phone': technicianPhone,
        'purchase_shop': purchaseShop,
        'merchant_customer_id': merchantCustomerId,
        'purchase_shop_phone': purchaseShopPhone,
        'visit_details': visitDetails,
        // المالك بيتخزّن محلياً برقم سالب عشان يتميّز عن العميل في نفس الكاش،
        // وبيتبعت في خانته الصح: `owner_id` موجب. الموجب عميل حقيقي.
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

// ------------------------------------------------------------------ البيع من العربية

/// صنف في عهدة المندوب — بسعره ورصيده، زي ما نزلوا في حزمة البيع.
///
/// الأسعار نازلة بالفئات لأن السعر بيتحدّد بفئة العميل، والجهاز لازم يحسب **نفس** الرقم
/// اللي السيرفر هيحسبه: الورقة اللي في إيد العميل والقيد في الدفتر مايختلفوش.
class SaleItem {
  final int itemId;
  final String name;
  final String? unit;

  /// فئة الصنف زي ما هي في الأصناف على السيرفر — ممكن تكون فاضية.
  ///
  /// موجودة عشان منتقي الأصناف يبقى خطوتين: ٣٢٦ صنف في قايمة واحدة على شاشة تليفون
  /// كومة مش قايمة. الفئة هنا **عرض بس** — مالهاش أي دخل بالسعر ولا بالرصيد.
  final String? category;
  final double onHand;
  final double? basePrice;
  final double defaultDiscountPct;
  final Map<String, double> tierPrices;

  const SaleItem({
    required this.itemId,
    required this.name,
    this.unit,
    this.category,
    this.onHand = 0,
    this.basePrice,
    this.defaultDiscountPct = 0,
    this.tierPrices = const {},
  });

  /// سعر الصنف لعميل فئته دي — وبيرجع للسعر الأساسي لو الفئة مالهاش سعر خاص.
  double priceFor(String? tier) =>
      (tier != null ? tierPrices[tier] : null) ?? basePrice ?? 0;

  Map<String, Object?> toRow() => {
        'item_id': itemId,
        'name': name,
        'unit': unit,
        'category': category,
        'on_hand': onHand,
        'base_price': basePrice,
        'default_discount_pct': defaultDiscountPct,
        // الفئات بتتخزّن نص «فئة=سعر» مفصولين بفاصلة — عمود واحد بدل جدول تاني لحاجة
        // بتتقرا كلها مع الصنف ومابتتسألش لوحدها أبداً.
        'tier_prices': tierPrices.entries.map((e) => '${e.key}=${e.value}').join(','),
      };

  static SaleItem fromRow(Map<String, Object?> r) => SaleItem(
        itemId: r['item_id'] as int,
        name: r['name'] as String,
        unit: r['unit'] as String?,
        category: r['category'] as String?,
        onHand: (r['on_hand'] as num?)?.toDouble() ?? 0,
        basePrice: (r['base_price'] as num?)?.toDouble(),
        defaultDiscountPct: (r['default_discount_pct'] as num?)?.toDouble() ?? 0,
        tierPrices: {
          for (final part in ((r['tier_prices'] as String?) ?? '').split(','))
            if (part.contains('=')) part.split('=')[0]: double.tryParse(part.split('=')[1]) ?? 0
        },
      );
}

/// سطر في فاتورة على الجهاز.
///
/// **الخصم اتنين مش واحد**، زي الشاشة الكبيرة بالظبط:
///
/// * **الثابت** — بتاع الصنف نفسه، نازل معاه من النظام. ده سعر الشركة، والمندوب بيشوفه
///   مش بيخترعه.
/// * **المتغيّر** — اللي المندوب بيزوّده عند العميل. ده اللي بيتفاوض عليه.
///
/// خلطهم في رقم واحد بيخلّي اللي بيراجع الفاتورة مايعرفش الشركة خصمت كام والمندوب زوّد
/// كام — وده بالظبط السؤال اللي بيتسأل لما رقم يبان كبير.
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

  /// الاتنين مع بعض — وده اللي بيروح للسيرفر، لأن سطر الفاتورة عنده بيشيل خصم واحد.
  /// و`99.99` سقف مقصود: خصم ١٠٠٪ معناه سطر بصفر، ودي حاجة تتعمل بمسح السطر مش بخصم.
  double get discountPct =>
      (fixedDiscountPct + variableDiscountPct).clamp(0, 99.99).toDouble();

  double get gross => quantity * unitPrice;
  double get net => gross * (1 - discountPct / 100);

  Map<String, Object?> toRow(int invoiceLocalId) => {
        'invoice_local_id': invoiceLocalId,
        'item_id': itemId,
        'item_name': itemName,
        'quantity': quantity,
        'unit_price': unitPrice,
        // المجموع بيتخزّن كمان عشان أي قراءة قديمة تفضل شغالة.
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
      // السطور اللي اتكتبت قبل ما الخصم ينقسم بيتقروا كأن كله ثابت — ده اللي كان
      // معروف عنه وقتها، والتخمين إنه متغيّر كان هيقول على الشركة حاجة ماقالتهاش.
      fixedDiscountPct: fixed ?? (r['discount_pct'] as num?)?.toDouble() ?? 0,
      variableDiscountPct: variable ?? 0,
    );
  }
}

// ------------------------------------------------------------------ صناديق المندوب

/// صندوق المندوب لخط منتجات — زي ما نزل في حزمة البيع.
///
/// a5 بيدّي كل مندوب صندوقين، «صندوق أبيض السيارة (أ)» و«صندوق بولي السيارة (أ)»،
/// والفلوس بتتفصل بالخط زي المديونية بالظبط. فالصندوق مش سؤال على الشاشة: نوع الفاتورة
/// بيحدّده لوحده، والمندوب بيشوفه عشان يعرف فلوسه رايحة فين — مش عشان يختار.
///
/// `family` بـ`null` = عهدة قديمة من قبل ما الصناديق تتقسم. نازلة زي ما هي عشان المندوب
/// اللي لسه ماتقسمش يفضل شغّال، والشاشة مابتقعش عليها لما الفاتورة قايلة خطها: صندوق خط
/// تاني أوحش من مافيش صندوق — التاني بيشتكي، والأول بيسكت والفلوس بتروح مكان غلط.
class RepTreasury {
  final int custodyId;
  final int accountId;
  final String? family;

  /// اسم الصندوق زي ما هو في شجرة حسابات a5 — ده اللي المكتب بينده بيه في التليفون.
  final String name;
  final String code;

  const RepTreasury({
    required this.custodyId,
    required this.accountId,
    this.family,
    this.name = '',
    this.code = '',
  });

  /// اللي بيتعرض. الصندوق القديم اللي مالوش اسم بيتسمّى بخطه، واللي مالوش خط «عهدتك».
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
