/**
 * أسماء عربية للقيم اللي الباك إند بيبعتها بالإنجليزي.
 *
 * A ledger entry is stored under a machine name — `sale_return`, `cheque_bounce` — because that is
 * what code branches on. The screen is not code: somebody reading كشف حساب should see «مرتجع بيع»,
 * not `sale_return`, and «قيد» not `journal`.
 *
 * **One map, not one per screen.** حركة الخزينة already had an Arabic map of its own and كشف
 * الحساب had none, so the same movement read as «سند قبض» on one screen and `receipt` on the
 * other. A second copy is also a second thing to forget: that private map covered eleven of the
 * nineteen types the backend actually writes, and the other eight showed through raw.
 */

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
  // The eight that were showing through in English.
  coupon_redeem_reverse: 'إلغاء استبدال كوبون',
  cash_transfer: 'تحويل نقدي',
  cheque_register: 'تسجيل شيك',
  cheque_settle: 'تحصيل شيك',
  cheque_bounce: 'ارتداد شيك',
  expense: 'مصروف',
  depreciation: 'إهلاك',
  asset_disposal: 'استبعاد أصل',
};

/**
 * The Arabic name, or the raw value when there is none.
 *
 * Falling back to the raw string rather than to «غير معروف»: a type nobody has named yet is still
 * information — «cheque_bounce» tells a reader something, and «غير معروف» tells them nothing and
 * hides which row needs the fix.
 */
export const entryTypeLabel = (value: string | null | undefined): string =>
  (value ? ENTRY_TYPE_LABEL[value] || value : '-');

/** أسماء المستندات اللي `DocumentLink` بيفتحها. */
export const DOC_KIND_LABEL: Record<string, string> = {
  invoice: 'فاتورة بيع',
  return: 'مرتجع بيع',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
  voucher: 'سند',
};
