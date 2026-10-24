import { useEffect, useState } from 'react';
import { api } from '../api/client';

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
  paymentMethod: boolean;
  date: boolean;
  unitColumn: boolean;
  discountColumn: boolean;
  pointsColumn: boolean;
  priorBalance: boolean;
  loyaltyPoints: boolean;
  signatures: boolean;
  footerNote: boolean;
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
  { key: 'paymentMethod', label: 'طريقة السداد' },
  { key: 'date', label: 'التاريخ' },
  { key: 'unitColumn', label: 'عمود الوحدة' },
  { key: 'discountColumn', label: 'عمود الخصم' },
  { key: 'pointsColumn', label: 'عمود النقاط' },
  { key: 'priorBalance', label: 'الحساب السابق' },
  { key: 'loyaltyPoints', label: 'نقاط الولاء' },
  { key: 'signatures', label: 'التوقيعات' },
  { key: 'footerNote', label: 'الملاحظة أسفل الفاتورة' },
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
  paymentMethod: true,
  date: true,
  unitColumn: true,
  discountColumn: true,
  pointsColumn: true,
  priorBalance: true,
  loyaltyPoints: true,
  signatures: true,
  footerNote: true,
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

function keepLocal(o: PrintOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
  }
}

export function savePrintOptions(o: PrintOptions): Promise<void> {
  keepLocal(o);
  return api.put('/api/v1/settings/print-options', { options: o }).then(() => undefined);
}

export function usePrintOptions(): [PrintOptions, (o: PrintOptions) => void] {
  const [opts, setOpts] = useState<PrintOptions>(loadPrintOptions);
  useEffect(() => {
    let alive = true;
    api.get('/api/v1/settings/print-options')
      .then((r) => {
        const saved = r.data?.options;
        if (!alive || !saved) return;
        const next = { ...DEFAULT_PRINT_OPTIONS, ...saved };
        keepLocal(next);
        setOpts(next);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return [opts, setOpts];
}
