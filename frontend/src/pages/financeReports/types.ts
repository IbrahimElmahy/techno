/**
 * أنواع التقارير المالية المشتركة + تنسيق المبلغ.
 */
export interface ReportLine {
  account_id: number;
  code: string | null;
  name: string | null;
  amount: string;
}

export interface IncomeStatement {
  income: ReportLine[];
  expenses: ReportLine[];
  total_income: string;
  total_expenses: string;
  net_profit: string;
}

export interface BalanceSheet {
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  total_assets: string;
  total_liabilities: string;
  total_equity: string;
  net_profit: string;
  balanced: boolean;
}

export interface AgingRow {
  party_id: number;
  party_name: string;
  total: string;
  buckets: Record<string, string>;
}

export interface PartnerLedgerLine {
  line_id: number;
  entry_id: number;
  entry_number: string | null;
  entry_date: string;
  date_maturity: string | null;
  journal_code: string | null;
  move_type_label: string | null;
  account_code: string | null;
  account_name: string | null;
  description: string;
  statement: string | null;
  debit: string;
  credit: string;
  balance: string;
  residual: string | null;
  reconcile_number: string | null;
}

export interface PartnerLedgerRow {
  partner_kind: string;
  partner_id: number;
  partner_name: string;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  open_residual: string;
  lines: PartnerLedgerLine[];
}

export interface CashFlowLine {
  account_id: number | null;
  code: string | null;
  name: string | null;
  inflow: string;
  outflow: string;
  net: string;
}

export interface CashFlowSection {
  key: string;
  label: string;
  net: string;
  lines: CashFlowLine[];
}

export interface CashFlow {
  opening: string;
  closing: string;
  net_change: string;
  consistent: boolean;
  sections: CashFlowSection[];
}

export interface VatReturn {
  rate_pct: string;
  output_tax: string;
  input_tax: string;
  net_payable: string;
}

export interface CommissionRow {
  rep_user_id: number;
  rep_name: string;
  basis: string;
  rate_pct: string;
  base_amount: string;
  commission: string;
}

export const money = (v: string | number) =>
  Number(v).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const BUCKETS = ['0-30', '31-60', '61-90', '90+'];
