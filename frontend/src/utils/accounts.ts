import { numeralsLocale } from './money';

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

export const APPEARS_IN_LABEL: Record<string, string> = {
  trading: 'متاجرة',
  profit_loss: 'أرباح وخسائر',
  balance_sheet: 'ميزانية عمومية',
};

export const MAIN_LEVELS = [
  'أصول متداولة', 'أصول ثابتة', 'التزامات متداولة', 'حقوق الملكية',
  'الإيرادات / المبيعات', 'تكلفة الإيرادات / المبيعات',
  'مصروفات مباشرة', 'مصروفات غير مباشرة', 'إيرادات متنوعة',
];

export const egp = (v: string | number) =>
  parseFloat(String(v)).toLocaleString(numeralsLocale(),
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
  reconcilable?: boolean;
  balance: string;
  owner_name?: string | null;
  owner_group?: string | null;
}

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  parent_id: number | null;
  active: boolean;
  level?: number;
  children?: CostCenter[] | null;
}
