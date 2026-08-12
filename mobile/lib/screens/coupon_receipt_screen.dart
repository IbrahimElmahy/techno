import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../db/local_db.dart';
import '../models/models.dart';
import '../theme.dart';

class CouponReceiptScreen extends StatefulWidget {
  const CouponReceiptScreen({super.key});

  @override
  State<CouponReceiptScreen> createState() => _CouponReceiptScreenState();
}

class _CouponReceiptScreenState extends State<CouponReceiptScreen> {
  DateTime _receiptDate = DateTime.now();
  String _customerType = 'plumber'; // 'plumber' | 'merchant'
  List<CustomerRef> _customers = [];
  CustomerRef? _selectedCustomer;
  final _searchCustomerCtrl = TextEditingController();

  String _couponType = 'silver'; // 'standard' | 'silver' | 'gold' | 'diamond'
  final _couponValueCtrl = TextEditingController(text: '50');
  final _serialCtrl = TextEditingController();
  // النطاق «من – إلى». الكوبونات بتتصرف على شكل دفاتر متسلسلة، فالمندوب بيستلم عشرين ورقة
  // ورا بعض — كتابتهم واحدة واحدة هي اللي خلّت الشاشة غير قابلة للاستخدام في الميدان.
  final _fromCtrl = TextEditingController();
  final _toCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();

  List<Map<String, dynamic>> _addedItems = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  Future<void> _loadCustomers() async {
    final list = await LocalDb.instance.customers();
    if (mounted) {
      setState(() {
        _customers = list;
        if (list.isNotEmpty) {
          _selectedCustomer = list.first;
          _searchCustomerCtrl.text = list.first.name;
        }
      });
    }
  }

  void _addItem() {
    final val = double.tryParse(_couponValueCtrl.text.trim()) ?? 0;
    if (val <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى إدخال قيمة صحيحة للكوبون')),
      );
      return;
    }

    setState(() {
      _addedItems.add({
        'type': _couponType,
        'value': val,
        'serial': _serialCtrl.text.trim(),
        'qty': 1,
      });
      _serialCtrl.clear();
    });
  }

  /// أقصى عدد في المرة. رقم نهاية مكتوب غلط ممكن يعمل ملايين الصفوف ويقفل الشاشة.
  static const _maxRange = 100;

  @override
  void dispose() {
    // مكانش فيه dispose خالص — كل الكنترولرات كانت بتتسرّب كل مرة الشاشة تتقفل.
    _searchCustomerCtrl.dispose();
    _couponValueCtrl.dispose();
    _serialCtrl.dispose();
    _fromCtrl.dispose();
    _toCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  /// إضافة نطاق كامل بنفس الفئة والقيمة.
  ///
  /// Each serial becomes its own line, exactly as if it had been typed one at a time — the summary,
  /// the totals and what gets sent all stay in the same shape, so nothing downstream has to know a
  /// range was used.
  void _addRange() {
    final first = int.tryParse(_fromCtrl.text.trim());
    final last = int.tryParse(_toCtrl.text.trim());
    if (first == null || last == null) {
      _snack('النطاق لازم يكون أرقام');
      return;
    }
    if (last < first) {
      _snack('رقم النهاية أصغر من البداية');
      return;
    }
    if (last - first + 1 > _maxRange) {
      _snack('النطاق كبير — أقصى $_maxRange كوبون في المرة');
      return;
    }
    final val = double.tryParse(_couponValueCtrl.text.trim()) ?? 0;
    if (val <= 0) {
      _snack('يرجى إدخال قيمة صحيحة للكوبون');
      return;
    }

    var added = 0;
    var duplicates = 0;
    setState(() {
      for (var n = first; n <= last; n++) {
        final serial = n.toString();
        if (_addedItems.any((i) => i['serial'] == serial)) {
          duplicates++;
          continue;
        }
        _addedItems.add({'type': _couponType, 'value': val, 'serial': serial, 'qty': 1});
        added++;
      }
      _fromCtrl.clear();
      _toCtrl.clear();
    });
    _snack(duplicates == 0
        ? 'اتضاف $added كوبون'
        : 'اتضاف $added كوبون، و$duplicates كانوا مضافين قبل كده');
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  double get _totalAmount {
    double total = 0;
    for (final item in _addedItems) {
      total += (item['value'] as double) * (item['qty'] as int);
    }
    return total;
  }

  Future<void> _saveReceipt() async {
    if (_selectedCustomer == null && _searchCustomerCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى اختيار العميل أولاً')),
      );
      return;
    }
    if (_addedItems.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى إضافة كوبون واحد على الأقل للقائمة')),
      );
      return;
    }

    setState(() => _busy = true);
    try {
      final serialList = _addedItems
          .map((i) => i['serial'].toString().isEmpty ? i['type'].toString() : i['serial'].toString())
          .toList();

      await LocalDb.instance.saveCouponReceipt(
        clientUuid: Uuid().v4(),
        serials: serialList,
        customerId: _selectedCustomer?.id,
        customerName: _selectedCustomer?.name,
        customerType: _customerType,
        receiptDate: intl.DateFormat('yyyy-MM-dd').format(_receiptDate),
        couponType: _couponType,
        couponValue: _totalAmount,
        notes: _notesCtrl.text.trim(),
      );

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ استلام الكوبونات بنجاح ✔')),
      );
      setState(() {
        _addedItems.clear();
        _serialCtrl.clear();
        _notesCtrl.clear();
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('حدث خطأ أثناء الحفظ: $e')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _getCouponTypeName(String type) {
    switch (type) {
      case 'standard':
        return 'عادي';
      case 'silver':
        return 'فضة';
      case 'gold':
        return 'ذهبي';
      case 'diamond':
        return 'ماسي';
      default:
        return type;
    }
  }

  @override
  Widget build(BuildContext context) {
    final dateStr = intl.DateFormat('d MMMM yyyy', 'ar').format(_receiptDate);

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: const Text('استلام كوبونات', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Date Picker Card
          InkWell(
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _receiptDate,
                firstDate: DateTime(2022),
                lastDate: DateTime(2030),
              );
              if (picked != null) setState(() => _receiptDate = picked);
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: Row(
                children: [
                  Text(
                    dateStr,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppColors.ink),
                  ),
                  const Spacer(),
                  const Icon(Icons.calendar_month_outlined, color: AppColors.primary, size: 22),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // Customer Section Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFF3F4F6)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'العميل',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF6B7280)),
                ),
                const SizedBox(height: 12),

                // Plumber / Merchant Toggle Switch
                Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF3F4F6),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => _customerType = 'plumber'),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: _customerType == 'plumber' ? AppColors.primary : Colors.transparent,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Center(
                              child: Text(
                                'سباك',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                  color: _customerType == 'plumber' ? Colors.white : const Color(0xFF4B5563),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => _customerType = 'merchant'),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: _customerType == 'merchant' ? AppColors.primary : Colors.transparent,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Center(
                              child: Text(
                                'تاجر',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                  color: _customerType == 'merchant' ? Colors.white : const Color(0xFF4B5563),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 14),

                // Customer Search Autocomplete
                Autocomplete<CustomerRef>(
                  displayStringForOption: (c) => c.name,
                  optionsBuilder: (textEditingValue) {
                    if (textEditingValue.text.isEmpty) return _customers;
                    return _customers.where((c) =>
                        c.name.contains(textEditingValue.text) ||
                        (c.phone != null && c.phone!.contains(textEditingValue.text)));
                  },
                  onSelected: (c) {
                    setState(() {
                      _selectedCustomer = c;
                      _searchCustomerCtrl.text = c.name;
                    });
                  },
                  fieldViewBuilder: (context, controller, focusNode, onEditingComplete) {
                    return TextField(
                      controller: controller,
                      focusNode: focusNode,
                      decoration: const InputDecoration(
                        hintText: 'البحث عن اسم أو رقم العميل...',
                        prefixIcon: Icon(Icons.search, color: Color(0xFF9CA3AF)),
                      ),
                    );
                  },
                ),

                if (_selectedCustomer != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAFAFA),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE5E7EB)),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 20,
                          backgroundColor: AppColors.primary,
                          child: Text(
                            _selectedCustomer!.name.isNotEmpty
                                ? _selectedCustomer!.name.substring(0, 1)
                                : 'ع',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _selectedCustomer!.name,
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppColors.ink),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${_selectedCustomer!.phone ?? '01012345678'} • ${_customerType == 'plumber' ? 'سباك' : 'تاجر'}',
                              style: const TextStyle(fontSize: 11, color: Color(0xFF6B7280)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Coupon Details Card ("تفاصيل الكوبون")
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFF3F4F6)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'تفاصيل الكوبون',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF6B7280)),
                ),
                const SizedBox(height: 14),

                // 4 Coupon Categories Grid (2x2)
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                  childAspectRatio: 1.6,
                  children: [
                    _CouponCategoryCard(
                      title: 'عادي',
                      icon: Icons.workspace_premium_outlined,
                      isSelected: _couponType == 'standard',
                      onTap: () => setState(() => _couponType = 'standard'),
                    ),
                    _CouponCategoryCard(
                      title: 'فضة',
                      icon: Icons.stars_outlined,
                      isSelected: _couponType == 'silver',
                      onTap: () => setState(() => _couponType = 'silver'),
                    ),
                    _CouponCategoryCard(
                      title: 'ذهبي',
                      icon: Icons.military_tech_outlined,
                      isSelected: _couponType == 'gold',
                      onTap: () => setState(() => _couponType = 'gold'),
                    ),
                    _CouponCategoryCard(
                      title: 'ماسي',
                      icon: Icons.diamond_outlined,
                      isSelected: _couponType == 'diamond',
                      onTap: () => setState(() => _couponType = 'diamond'),
                    ),
                  ],
                ),

                const SizedBox(height: 16),

                // Coupon Value Field
                const Text(
                  'قيمة الكوبون',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF6B7280)),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: _couponValueCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    suffixText: 'ج.م',
                    hintText: 'أدخل قيمة الكوبون بالجنيه',
                  ),
                ),

                const SizedBox(height: 14),

                // Serial Number Field + Scan Icon
                const Text(
                  'الرقم التسلسلي (اختياري)',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF6B7280)),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFFE5E7EB),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.qr_code_scanner, color: Color(0xFF374151)),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _serialCtrl,
                        decoration: const InputDecoration(
                          hintText: 'S/N...',
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 14),

                // نطاق متسلسل «من – إلى»
                const Text(
                  'أو نطاق متسلسل (من – إلى)',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF6B7280)),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _fromCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(hintText: 'من'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _toCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(hintText: 'إلى'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    SizedBox(
                      height: 48,
                      child: OutlinedButton(
                        onPressed: _addRange,
                        child: const Text('أضف النطاق'),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 16),

                // Add to List Button (Brown Primary Button matching mockup)
                FilledButton(
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    backgroundColor: AppColors.brown,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: _addItem,
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_circle_outline, size: 20),
                      SizedBox(width: 8),
                      Text('إضافة للقائمة', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Summary Card ("ملخص التسليم")
          if (_addedItems.isNotEmpty)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFF3F4F6)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.receipt_long_outlined, size: 20, color: Color(0xFF6B7280)),
                      SizedBox(width: 8),
                      Text(
                        'ملخص التسليم',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppColors.ink),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ..._addedItems.map(
                    (item) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Text(
                            '${_getCouponTypeName(item['type'] as String)} (${item['qty']})',
                            style: const TextStyle(fontSize: 14, color: AppColors.ink),
                          ),
                          const Spacer(),
                          Text(
                            '${((item['value'] as double) * (item['qty'] as int)).toInt()} ج.م',
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppColors.ink),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const Divider(height: 24),
                  Row(
                    children: [
                      const Text(
                        'الإجمالي',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.primary),
                      ),
                      const Spacer(),
                      Text(
                        '${_totalAmount.toInt()} ج.م',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppColors.primary),
                      ),
                    ],
                  ),
                ],
              ),
            ),

          const SizedBox(height: 20),

          // Primary Confirm Button
          FilledButton(
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(54),
              backgroundColor: AppColors.primary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: _busy ? null : _saveReceipt,
            child: _busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                  )
                : const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.check_circle_outline, size: 22),
                      SizedBox(width: 8),
                      Text('تأكيد التسليم', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
                    ],
                  ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _CouponCategoryCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;

  const _CouponCategoryCard({
    required this.title,
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFF2F9F1) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? AppColors.primary : const Color(0xFFE5E7EB),
            width: isSelected ? 1.5 : 1.0,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: isSelected ? AppColors.primary : const Color(0xFF6B7280), size: 26),
            const SizedBox(height: 4),
            Text(
              title,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: isSelected ? AppColors.primary : const Color(0xFF374151),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
