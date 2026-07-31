/**
 * مفاتيح الطباعة — what goes on the printed invoice and what does not.
 *
 * Read off their فاتوره بيع screen, which carries the same nine switches across its header. They
 * are not decoration: a company printing on pre-printed letterhead already has its logo and name
 * on the paper and does not want them again, while one printing on plain A4 needs both. The same
 * invoice goes to a customer who should see the salesman's name and to a file copy where the
 * account number matters — one layout cannot be right for both, and the person at the counter is
 * the only one who knows which is in the printer.
 *
 * Saved per browser rather than per company: it follows the machine the printer is attached to,
 * which is the thing that actually differs.
 */

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

/** Their order and their wording, so the list reads the same on both systems. */
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

/** Everything on. A document that prints less than the paper can hold is a deliberate choice, so
 *  the default is the complete one and every omission is somebody's decision. */
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
    // Merged over the defaults, not used raw: a switch added in a later release must arrive ON
    // rather than silently missing for everyone who saved a choice before it existed.
    return saved ? { ...DEFAULT_PRINT_OPTIONS, ...JSON.parse(saved) } : DEFAULT_PRINT_OPTIONS;
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
}

export function savePrintOptions(o: PrintOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* storage disabled just loses the preference, not the print */
  }
}
