/**
 * أنواع شاشة السندات وتسمياتها — مشتركة بين الشاشة وبوباباتها.
 */
export interface VoucherRecord {
  id: number;
  document_number: string;
  kind: 'receipt' | 'payment' | 'rep_handover' | 'expense' | 'cash_transfer';
  amount: string;
  customer_id: number | null;
  supplier_id: number | null;
  rep_user_id: number | null;
  voucher_date: string;
  payment_method: string | null;
  reference: string | null;
  description: string | null;
  /**
   * «بيان» ورقة السند — غير `description` اللي هو وصف الحركة المحاسبية.
   * و«رقم المستند» رقم السند الورقي اللي في إيد العميل، بيتحفظ **جنب** رقمنا.
   * الاتنين اختياريين لأن السندات القديمة مالهاش ولا واحد فيهم.
   */
  statement1?: string | null;
  external_document_number?: string | null;
  family?: string | null;
  is_reversal: boolean;
}

export interface StatementLine {
  entry_id: number;
  entry_date: string;
  entry_type: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface StatementData {
  account_id: number;
  opening_balance: string;
  closing_balance: string;
  total_debit: string;
  total_credit: string;
  lines: StatementLine[];
}

export interface Party {
  id: number;
  name: string;
}
export interface UserRecord {
  id: number;
  full_name: string | null;
  username: string;
  role?: string;
}

export const KIND_LABEL: Record<string, string> = {
  receipt: 'سند قبض',
  payment: 'سند صرف',
  rep_handover: 'توريد مندوب',
  expense: 'سند مصروف',
  cash_transfer: 'تحويل نقدي',
};
export const KIND_COLOR: Record<string, string> = {
  receipt: 'green',
  payment: 'red',
  rep_handover: 'blue',
  expense: 'orange',
  cash_transfer: 'purple',
};

export { money } from '../../utils/money';
