/**
 * أنواع الأستاذ العام المشتركة بين تبويباته.
 */
export interface Account {
  id: number;
  code: string | null;
  name: string | null;
  parent_id: number | null;
  nature: string | null;
  appears_in?: string | null;
  main_level?: string | null;
  normal_side: 'debit' | 'credit';
  is_postable: boolean;
  is_system: boolean;
  active: boolean;
  balance: string;
  children?: Account[] | null;
}

export interface JournalLine {
  account_id: number;
  direction: 'debit' | 'credit';
  amount: string;
  statement: string | null;
  cost_center_id?: number | null;
  cost_center_distribution?: Record<string, number> | null;
}

export interface Journal {
  id: number;
  code: string;
  name: string;
  kind: string;
  kind_label: string;
  active: boolean;
  is_system: boolean;
  sort_order: number;
  restrict_mode_hash: boolean;
}

export interface JournalEntry {
  id: number;
  entry_type: string;
  date: string | null;
  description: string;
  branch_id: number | null;
  reverses_entry_id: number | null;
  lines: JournalLine[];
  total: string;
  journal_id: number | null;
  journal_code: string | null;
  journal_name: string | null;
  state: 'draft' | 'posted' | 'cancelled';
  number: string | null;
  total_credit: string;
  balanced: boolean;
  // (المرحلة ٢) القيد كمستند: نوعه، وعلى مين، وامتى مستحق.
  move_type: string | null;
  move_type_label: string | null;
  partner_kind: 'customer' | 'supplier' | 'employee' | null;
  partner_id: number | null;
  partner_name: string | null;
  due_date: string | null;
  // (المرحلة ٣) حالة الدفع والمتبقّي — محسوبين من مطابقة السطور.
  payment_state: 'not_paid' | 'partial' | 'paid' | null;
  payment_state_label: string | null;
  residual: string | null;
}

export interface TrialRow {
  account_id: number;
  code: string | null;
  name: string | null;
  is_postable: boolean;
  opening: string;
  period_debit: string;
  period_credit: string;
  closing: string;
  nature: 'asset' | 'liability' | 'equity' | 'income' | 'expense' | null;
}

export interface LineDraft {
  key: string;
  account_id: number | null;
  direction: 'debit' | 'credit';
  amount: number;
  statement: string;
  cost_center_id?: number | null;
  cost_center_distribution?: Record<string, number> | null;
}

export const flatten = <T extends { children?: T[] | null }>(node: T): T[] =>
  [node, ...(node.children || []).flatMap(flatten)];
