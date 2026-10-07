/**
 * الطرف في سند القبض/الصرف — المرحلة ١ (٢٠٢٦-١٠-٠٦).
 *
 * a5 بيعمل السند على أي حساب: يصرف لعميل (رد فلوس)، يقبض من مورد (رجّع دفعة)، يصرف سلفة
 * لموظف، يحوّل لفرع. عندنا كان القبض من عميل بس والصرف لمورد بس. الطرف هنا واحد من خمسة،
 * والسيرفر بيقيّد على حسابه هو (`voucher_service._party_voucher`):
 *
 *   عميل / موظف / فرع ⇒ `customer_id` (الموظف والفرع كروت عملاء بتصنيفهم)
 *   مورد              ⇒ `supplier_id`
 *   حساب              ⇒ `account_id` — أي حساب فرعي في الشجرة غير الخزن
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Form, Segmented, Select } from 'antd';
import { api } from '../../api/client';
import PartyField from '../../components/PartyField';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import type { Party } from './types';

export type PartyKind = 'customer' | 'employee' | 'branch' | 'supplier' | 'account';

export const PARTY_KIND_OPTIONS: { value: PartyKind; label: string }[] = [
  { value: 'customer', label: 'عميل' },
  { value: 'supplier', label: 'مورد' },
  { value: 'employee', label: 'موظف' },
  { value: 'branch', label: 'فرع' },
  { value: 'account', label: 'حساب' },
];

/** اسم الطرف على ورقة السند وفي معاينة القيد — «العميل» مش «عميل». */
export const PARTY_DOC_LABEL: Record<PartyKind, string> = {
  customer: 'العميل', supplier: 'المورد', employee: 'الموظف', branch: 'الفرع', account: 'الحساب',
};

/**
 * نوع الطرف من قيم سند محفوظ — لفتحه للتعديل على النوع الصح.
 *
 * من غيرها سند صرف لعميل كان بيتفتح على «مورد» (الافتراضي) فالعميل بيضيع من الفورم،
 * وسند قبض من مورد بيتفتح على «عميل» فاضي ومايتحفظش.
 */
export function kindOfValues(v: any, customers: Party[]): PartyKind | null {
  if (v?.supplier_id) return 'supplier';
  if (v?.customer_id) {
    const t = customers.find((c) => c.id === v.customer_id)?.customer_type;
    return t === 'employee' ? 'employee' : t === 'internal' ? 'branch' : 'customer';
  }
  if (v?.account_id) return 'account';
  return null;
}

/** الأنواع اللي بتتقيّد على كارت عميل. */
export const isCustomerKind = (k: PartyKind) => k === 'customer' || k === 'employee' || k === 'branch';

/** كروت العملاء حسب النوع — الموظف «employee» والفرع «internal»، والباقي عملاء. */
export function customersOfKind(customers: Party[], kind: PartyKind): Party[] {
  if (kind === 'employee') return customers.filter((c) => c.customer_type === 'employee');
  if (kind === 'branch') return customers.filter((c) => c.customer_type === 'internal');
  return customers.filter((c) => c.customer_type !== 'employee' && c.customer_type !== 'internal');
}

/**
 * الحسابات الفرعية من الشجرة (غير الخزن) — بتتحمّل أول ما «حساب» يتختار.
 *
 * **مرة واحدة للشاشة كلها.** خانة الطرف وتلميح رصيده وكارت القيد التلاتة محتاجين نفس
 * القايمة؛ لو كل واحد جابها لوحده كانت هتتطلب تلات مرات مع كل اختيار «حساب».
 */
let accountsPromise: Promise<any[]> | null = null;
export function loadPostableAccounts(): Promise<any[]> {
  if (!accountsPromise) {
    accountsPromise = api.get('/api/v1/accounts', { params: { postable_only: true } })
      .then((r) => (r.data || []).filter((a: any) => a.account_type !== 'treasury'))
      .catch(() => { accountsPromise = null; return []; });
  }
  return accountsPromise;
}

export function usePostableAccounts(active: boolean) {
  const [accounts, setAccounts] = useState<any[]>([]);
  useEffect(() => {
    if (!active || accounts.length) return;
    let alive = true;
    loadPostableAccounts().then((list) => { if (alive) setAccounts(list); });
    return () => { alive = false; };
  }, [active]);
  return accounts;
}

export function PartyKindSwitch({ value, onChange }: {
  value: PartyKind; onChange: (k: PartyKind) => void;
}) {
  return (
    <Form.Item label="الطرف">
      <Segmented value={value} onChange={(v) => onChange(v as PartyKind)} options={PARTY_KIND_OPTIONS} />
    </Form.Item>
  );
}

/** خانة الطرف للنوع المختار — عميل/موظف/فرع أو مورد أو حساب. */
export function PartyKindField({
  kind, customers, suppliers, onCustomerChange, extra,
}: {
  kind: PartyKind;
  customers: Party[];
  suppliers: Party[];
  /** للعميل: الشاشة بتجيب خطوطه (أبيض/بولي). */
  onCustomerChange?: (id: number) => void;
  /** سطر تحت الخانة — رصيد الطرف (`PartyBalance`). */
  extra?: React.ReactNode;
}) {
  const accounts = usePostableAccounts(kind === 'account');
  const custs = useMemo(() => customersOfKind(customers, kind), [customers, kind]);
  const label = PARTY_KIND_OPTIONS.find((o) => o.value === kind)?.label || 'الطرف';

  if (isCustomerKind(kind)) {
    return (
      <Form.Item name="customer_id" label={label} rules={[{ required: true, message: `اختر ال${label}` }]}
        extra={extra}>
        <PartyField
          kind="customer"
          options={custs.map((c) => ({ value: c.id, label: c.name }))}
          onChange={onCustomerChange}
        />
      </Form.Item>
    );
  }
  if (kind === 'supplier') {
    return (
      <Form.Item name="supplier_id" label="المورد" rules={[{ required: true, message: 'اختر المورد' }]}
        extra={extra}>
        <PartyField kind="supplier" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      </Form.Item>
    );
  }
  return (
    <Form.Item name="account_id" label="الحساب" rules={[{ required: true, message: 'اختر الحساب' }]}
      extra={extra ?? 'أي حساب فرعي في الشجرة — زي a5'}>
      <Select
        showSearch allowClear placeholder="اكتب اسم الحساب أو كوده"
        options={accounts.map((a: any) => ({
          value: a.id, label: `${a.name ?? ''}${a.code ? ` — ${a.code}` : ''}`,
        }))}
        filterOption={searchFilter} filterSort={searchRank}
      />
    </Form.Item>
  );
}
