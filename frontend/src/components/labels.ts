export const ENTRY_TYPE_LABEL: Record<string, string> = {
  opening_balance: 'رصيد افتتاحي',
  sale: 'فاتورة بيع',
  sale_return: 'مرتجع بيع',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
  receipt: 'سند قبض',
  payment: 'سند صرف',
  rep_handover: 'توريد مندوب',
  journal: 'قيد يومية',
  reversal: 'عكس قيد',
  coupon_redeem: 'استبدال كوبون',
  coupon_redeem_reverse: 'إلغاء استبدال كوبون',
  cash_transfer: 'تحويل نقدي',
  partner_withdraw: 'سحب شريك',
  partner_deposit: 'إيداع شريك',
  cheque_register: 'تسجيل شيك',
  cheque_settle: 'تحصيل شيك',
  cheque_bounce: 'ارتداد شيك',
  expense: 'مصروف',
  netting: 'مقاصة',
  depreciation: 'إهلاك',
  asset_disposal: 'استبعاد أصل',
  employee_advance: 'سلفة موظف',
  payroll_accrual: 'استحقاق مرتبات',
  payroll_payment: 'صرف مرتبات',
  payroll_remittance: 'سداد تأمينات/ضرائب',
  sales_invoice: 'فاتورة بيع',
  sales_return: 'مرتجع بيع',
  purchase_invoice: 'فاتورة شراء',
};

export const entryTypeLabel = (value: string | null | undefined): string =>
  (value ? ENTRY_TYPE_LABEL[value] || value : '-');

export const DOC_KIND_LABEL: Record<string, string> = {
  invoice: 'طلب بيع',
  return: 'مرتجع بيع',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
  voucher: 'سند',
};
