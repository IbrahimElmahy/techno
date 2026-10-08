export type LedgerDim = 'account' | 'main_account' | 'account_type' | 'nature' | 'branch' | 'cost_center'
  | 'entry_type' | 'party' | 'party_kind' | 'territory' | 'rep' | 'family' | 'day' | 'month' | 'year';
export type LedgerMode = 'asof' | 'range';
export interface LedgerPreset {
  key: string; label: string; dims: LedgerDim[]; mode: LedgerMode; group: string;
  accountType?: string; partyKind?: 'customer' | 'supplier';
}

const P = (group: string, key: string, label: string, dims: LedgerDim[], mode: LedgerMode,
  extra: Partial<LedgerPreset> = {}): LedgerPreset => ({ group, key, label, dims, mode, ...extra });

export const LEDGER_PRESETS: LedgerPreset[] = [
  P('موازين وأرصدة', 'balances', 'ارصدة حسابات', ['account'], 'asof'),
  P('موازين وأرصدة', 'balances-range', 'ارصدة حسابات خلال فترة', ['account'], 'range'),
  P('موازين وأرصدة', 'main-range', 'مجمل حركة حساب خلال فترة', ['main_account'], 'range'),
  P('موازين وأرصدة', 'american-daily', 'يومية امريكية', ['day', 'main_account'], 'range'),
  P('موازين وأرصدة', 'american-monthly', 'شهرية امريكية - استاذ عام', ['month', 'main_account'], 'range'),
  P('موازين وأرصدة', 'by-nature', 'أرصدة حسب طبيعة الحساب', ['nature', 'main_account'], 'asof'),
  P('حركة حسابية', 'acc-day', 'اجمالى حركة حساب باليوم', ['account', 'day'], 'range'),
  P('حركة حسابية', 'acc-month', 'اجمالى حركة حساب بالشهر', ['account', 'month'], 'range'),
  P('حركة حسابية', 'main-month', 'مجمع حساب رئيسى بالشهر', ['main_account', 'month'], 'range'),
  P('حركة حسابية', 'entry-types', 'الحركة حسب نوع القيد', ['entry_type'], 'range'),
  P('حركة حسابية', 'branches', 'الحركة حسب الفرع', ['branch', 'nature'], 'range'),
  P('حركة حسابية', 'cost-centers', 'مراكز تكلفة', ['cost_center', 'main_account'], 'range'),
  P('الخزينة', 'treasury-report', 'تقرير خزينه', ['account'], 'range', { accountType: 'treasury' }),
  P('الخزينة', 'treasury-daily', 'تحليلى خزينة', ['account', 'day'], 'range', { accountType: 'treasury' }),
  P('الخزينة', 'custody', 'أرصدة العهد', ['account'], 'asof', { accountType: 'custody' }),
  P('العملاء والموردين', 'cust-area-rep', 'ارصدة عملاء مناطق = مندوبين', ['territory', 'rep'], 'asof', { partyKind: 'customer' }),
  P('العملاء والموردين', 'cust-area-rep-range', 'ارصدة عملاء = مناطق = مندوبين = خلال فترة', ['territory', 'rep', 'party'], 'range', { partyKind: 'customer' }),
  P('العملاء والموردين', 'cust-rep', 'ارصدة عملاء تحصيلات مندوب', ['rep', 'party'], 'range', { partyKind: 'customer' }),
  P('العملاء والموردين', 'parties-movement', 'حركة العملاء والموردين', ['party_kind', 'party'], 'range'),
  P('العملاء والموردين', 'cust-balances', 'ارصدة العملاء', ['party'], 'asof', { partyKind: 'customer' }),
  P('العملاء والموردين', 'cust-family', 'ارصدة العملاء حسب الحساب (أبيض/بولي)', ['family', 'party'], 'asof', { partyKind: 'customer' }),
  P('العملاء والموردين', 'supp-dues', 'مستحقات موردين', ['party'], 'asof', { partyKind: 'supplier' }),
];
