/** Shared vocabulary of the chart of accounts.
 *
 * Lifted out of the general-ledger page when الحسابات الرئيسيه and الحسابات الفرعيه became screens
 * of their own. Three screens naming the same five natures is three places for them to drift, and
 * a chart where «مصروفات» is spelled two ways is a chart nobody trusts to add up.
 */

export const NATURE_LABEL: Record<string, string> = {
  asset: 'أصول',
  liability: 'التزامات',
  equity: 'حقوق ملكية',
  income: 'إيرادات',
  expense: 'مصروفات',
};

export const NATURE_COLOR: Record<string, string> = {
  asset: 'green', liability: 'volcano', equity: 'gold', income: 'blue', expense: 'orange',
};

/**
 * «يظهر في» — which statement the account is presented on. Egyptian practice reads three, not
 * two: المتاجرة carries sales and cost of sales down to gross profit, أرباح وخسائر carries the
 * indirect expenses and other income down to net profit, and الميزانية carries the balances.
 * Merging the first two would lose the gross-profit line, which is the figure a trader looks at
 * before any other.
 */
export const APPEARS_IN_LABEL: Record<string, string> = {
  trading: 'متاجرة',
  profit_loss: 'أرباح وخسائر',
  balance_sheet: 'ميزانية عمومية',
};

/** «المستوى الرئيسي» — the standard grouping the account rolls up into. Suggestions, not a
 *  closed list: the field is free text because every chart arranges these differently. */
export const MAIN_LEVELS = [
  'أصول متداولة', 'أصول ثابتة', 'التزامات متداولة', 'حقوق الملكية',
  'الإيرادات / المبيعات', 'تكلفة الإيرادات / المبيعات',
  'مصروفات مباشرة', 'مصروفات غير مباشرة', 'إيرادات متنوعة',
];

export const egp = (v: string | number) =>
  parseFloat(String(v)).toLocaleString('ar-EG',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ChartAccount {
  id: number;
  code: string | null;
  name: string | null;
  parent_id: number | null;
  nature: string | null;
  is_postable: boolean;
  is_system: boolean;
  active: boolean;
  appears_in: string | null;
  main_level: string | null;
  balance: string;
  /** Set for accounts opened FOR somebody — a customer, a supplier, a safe, a custody holder.
   *  They have no name of their own; this is derived from the owner on every read, so renaming
   *  the customer renames his account with him. */
  owner_name?: string | null;
  /** «العملاء», «الموردين» … — the heading such an account belongs under. */
  owner_group?: string | null;
}
