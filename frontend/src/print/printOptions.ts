export interface PrintOptions {
  logo: boolean;
  companyName: boolean;
  invoiceNumber: boolean;
  invoiceTitle: boolean;
  customerAccount: boolean;
  customerDetails: boolean;
  branch: boolean;
  rep: boolean;
  paidAndRemaining: boolean;
}

export const PRINT_OPTION_LABELS: { key: keyof PrintOptions; label: string }[] = [
  { key: 'logo', label: 'شعار الشركة' },
  { key: 'companyName', label: 'اسم الشركة' },
  { key: 'invoiceNumber', label: 'الفاتورة رقم' },
  { key: 'invoiceTitle', label: 'عنوان الفاتورة' },
  { key: 'customerAccount', label: 'حساب العميل' },
  { key: 'customerDetails', label: 'بيانات العميل' },
  { key: 'branch', label: 'الفرع' },
  { key: 'rep', label: 'مندوب' },
  { key: 'paidAndRemaining', label: 'المدفوع والمتبقي' },
];

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  logo: true,
  companyName: true,
  invoiceNumber: true,
  invoiceTitle: true,
  customerAccount: true,
  customerDetails: true,
  branch: true,
  rep: true,
  paidAndRemaining: true,
};

const KEY = 'print:invoice-options';

export function loadPrintOptions(): PrintOptions {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? { ...DEFAULT_PRINT_OPTIONS, ...JSON.parse(saved) } : DEFAULT_PRINT_OPTIONS;
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
}

export function savePrintOptions(o: PrintOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
  }
}
