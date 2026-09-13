import React from 'react';
import { Menu } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * شريط المحاسبة الأفقي — زي شريط التطبيق في أودو.
 *
 * أودو بيحط قايمة التطبيق **فوق** الشاشة: لوحة · عملاء · موردين · محاسبة ·
 * تقارير · إعدادات. اللي شغّال في المحاسبة بيتنقل بين شاشاتها من غير ما يرجع
 * للشجرة الجانبية ويفتحها ويدوّر تحت مجموعتين.
 *
 * **الشريط بيتضاف والشجرة بتفضل.** القايمة الجانبية متعمّدة تحاكي a5 عشان اللي
 * عارف مكان حاجة يلاقيها من غير ما يسأل — شيلها كان هيكسر ده. الاتنين مع بعض:
 * اللي جاي من a5 بيستعمل الشجرة، واللي قاعد في المحاسبة طول اليوم بيستعمل
 * الشريط، ومحدش اتفرض عليه يتعلّم من الأول.
 *
 * التقسيمة بتاعة أودو مش بتاعتنا: العميل والمورد كل واحد بابه، لأن اللي بيحصّل
 * من العملاء مابيدخلش على فواتير الشرا في يومه خالص.
 */

interface Item { key: string; label: string; children?: Item[] }

const MENU: Item[] = [
  { key: '/accounting', label: 'اللوحة' },
  {
    key: 'customers',
    label: 'العملاء',
    children: [
      { key: '/invoices', label: 'فواتير البيع' },
      { key: '/returns', label: 'مردودات البيع' },
      { key: '/vouchers?tab=receipt', label: 'سند قبض' },
      { key: '/reconciliation?kind=customer', label: 'تسوية العملاء' },
      { key: '/finance-reports?tab=aging&side=customers', label: 'مديونية عملاء' },
    ],
  },
  {
    key: 'suppliers',
    label: 'الموردين',
    children: [
      { key: '/purchases', label: 'فواتير الشرا' },
      { key: '/purchase-returns', label: 'مردودات الشرا' },
      { key: '/vouchers?tab=payment', label: 'سند صرف' },
      { key: '/reconciliation?kind=supplier', label: 'تسوية الموردين' },
      { key: '/finance-reports?tab=aging&side=suppliers', label: 'أرصدة موردين' },
    ],
  },
  {
    key: 'books',
    label: 'المحاسبة',
    children: [
      { key: '/general-ledger?tab=journal', label: 'قيد حر' },
      { key: '/general-ledger?tab=journals', label: 'الدفاتر' },
      { key: '/account-statement', label: 'كشف حساب' },
      { key: '/treasury', label: 'حركة خزينة' },
      { key: '/vouchers?tab=expense', label: 'سند مصروف' },
      { key: '/vouchers?tab=cheques', label: 'أوراق قبض ودفع' },
    ],
  },
  {
    key: 'reports',
    label: 'التقارير',
    children: [
      { key: '/general-ledger?tab=trial', label: 'ميزان المراجعة' },
      { key: '/finance-reports?tab=income', label: 'قائمة الدخل' },
      { key: '/finance-reports?tab=sheet', label: 'الميزانية' },
      { key: '/finance-reports?tab=partner', label: 'دفتر الشريك' },
      { key: '/finance-reports?tab=cashflow', label: 'التدفق النقدي' },
      { key: '/profitability?view=cost-centers', label: 'أرباح مراكز التكلفة' },
      { key: '/general-ledger?tab=integrity', label: 'سلامة الدفاتر' },
    ],
  },
  {
    key: 'config',
    label: 'الإعدادات',
    children: [
      { key: '/general-ledger?tab=chart', label: 'دليل الحسابات' },
      { key: '/cost-centers', label: 'مراكز التكلفة' },
      { key: '/treasuries', label: 'الخزن والبنوك' },
      { key: '/settings', label: 'إعدادات المحاسبة' },
    ],
  },
];

/** المسار من غير الاستعلام — المقارنة بتتم عليه عشان تبويب جوّه الشاشة مايكسرش التحديد. */
const bare = (key: string) => key.split('?')[0];

export default function AccountingNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // البند المحدَّد: اللي مساره هو الصفحة المفتوحة. القسم اللي فيه بيتعلّم لوحده.
  const selected = MENU.flatMap((m) => (m.children ? m.children : [m]))
    .filter((i) => bare(i.key) === pathname)
    .map((i) => i.key);

  return (
    <Menu
      mode="horizontal"
      selectedKeys={selected}
      onClick={({ key }) => navigate(key)}
      style={{ marginBottom: 12, borderBottom: '1px solid rgba(0,0,0,.06)' }}
      items={MENU.map((m) => ({
        key: m.key,
        label: m.label,
        children: m.children?.map((c) => ({ key: c.key, label: c.label })),
      }))}
    />
  );
}
