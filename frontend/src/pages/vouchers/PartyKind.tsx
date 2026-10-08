import React, { useEffect, useMemo, useState } from 'react';
import { Form, Segmented, Select } from 'antd';
import { api } from '../../api/client';
import PartyField from '../../components/PartyField';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import type { Party } from './types';
import { activeChoices, withInactiveTag } from '../../utils/active';

export type PartyKind = 'customer' | 'employee' | 'branch' | 'supplier' | 'account';

export const PARTY_KIND_OPTIONS: { value: PartyKind; label: string }[] = [
  { value: 'customer', label: 'عميل' },
  { value: 'supplier', label: 'مورد' },
  { value: 'employee', label: 'موظف' },
  { value: 'branch', label: 'فرع' },
  { value: 'account', label: 'حساب' },
];

export const PARTY_DOC_LABEL: Record<PartyKind, string> = {
  customer: 'العميل', supplier: 'المورد', employee: 'الموظف', branch: 'الفرع', account: 'الحساب',
};

export function kindOfValues(v: any, customers: Party[]): PartyKind | null {
  if (v?.supplier_id) return 'supplier';
  if (v?.customer_id) {
    const t = customers.find((c) => c.id === v.customer_id)?.customer_type;
    return t === 'employee' ? 'employee' : t === 'internal' ? 'branch' : 'customer';
  }
  if (v?.account_id) return 'account';
  return null;
}

export const isCustomerKind = (k: PartyKind) => k === 'customer' || k === 'employee' || k === 'branch';

export function customersOfKind(customers: Party[], kind: PartyKind): Party[] {
  if (kind === 'employee') return customers.filter((c) => c.customer_type === 'employee');
  if (kind === 'branch') return customers.filter((c) => c.customer_type === 'internal');
  return customers.filter((c) => c.customer_type !== 'employee' && c.customer_type !== 'internal');
}

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

export function PartyKindField({
  kind, customers, suppliers, onCustomerChange, extra,
}: {
  kind: PartyKind;
  customers: Party[];
  suppliers: Party[];
  onCustomerChange?: (id: number) => void;
  extra?: React.ReactNode;
}) {
  const accounts = usePostableAccounts(kind === 'account');
  const currentAccount = Form.useWatch('account_id') as number | undefined;
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
        options={activeChoices(accounts, currentAccount).map((a: any) => ({
          value: a.id, label: withInactiveTag(a.name ?? '', a), search: a.code ?? '',
        }))}
        filterOption={searchFilter} filterSort={searchRank}
      />
    </Form.Item>
  );
}
