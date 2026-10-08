import React, { useMemo, useState } from 'react';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Button, Form, Input, Select, Tag, message,
} from 'antd';
import { InputNumber } from './NumberInput';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { TabModal } from './TabModal';
import { money } from '../utils/money';

export interface Treasury {
  id: number; name: string; kind?: string; balance?: string | number;
  is_default?: boolean; active?: boolean; bank_name?: string | null;
  account_id?: number;
}

export interface ExpenseAccount {
  id: number; code?: string | null; name?: string | null; balance?: string | number;
  parent_id?: number | null;
}

const GA_NAME = 'مصروفات عموميه';
const normAr = (v?: string | null) => (v || '').trim()
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
const branchOfCode = (code?: string | null) => (
  code?.startsWith('AL-') ? 'العلياء' : code?.startsWith('FC-') ? 'السادات' : 'أكتوبر');

function gaTree(accounts: ExpenseAccount[], groups: ExpenseAccount[]) {
  const roots = groups.filter((g) => normAr(g.name) === GA_NAME);
  if (!roots.length) return null;
  const all = [...groups, ...accounts];
  const kids = new Map<number, ExpenseAccount[]>();
  all.forEach((a) => {
    if (a.parent_id == null) return;
    kids.set(a.parent_id, [...(kids.get(a.parent_id) || []), a]);
  });
  const postable = new Set(accounts.map((a) => a.id));
  const groupIds = new Set(groups.map((g) => g.id));
  return roots.map((root) => {
    const leaves: ExpenseAccount[] = [];
    const subGroups: ExpenseAccount[] = [root];
    const stack = [root.id];
    const seen = new Set<number>();
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      (kids.get(id) || []).forEach((c) => {
        if (postable.has(c.id)) leaves.push(c);
        if (groupIds.has(c.id)) { subGroups.push(c); stack.push(c.id); }
      });
    }
    return { root, leaves, subGroups };
  }).filter((t) => t.leaves.length || t.subGroups.length);
}

export function TreasuryField({
  treasuries, amount, width = 260, optional = false, placeholder, extra,
}: {
  treasuries: Treasury[]; amount?: number | null; width?: number | string;
  optional?: boolean; placeholder?: string;
  extra?: React.ReactNode;
}) {
  const live = treasuries.filter((t) => t.active !== false);

  const options = live.map((t) => {
    const bal = Number(t.balance || 0);
    return {
      value: t.id,
      label: `${t.name}${t.is_default ? ' (الافتراضية)' : ''}`,
      title: `${t.name} — ${money(bal)}`,
      short: t.name,
      balance: bal,
      kind: t.kind,
      isDefault: !!t.is_default,
    };
  });

  return (
    <Form.Item
      name="treasury_id"
      label="الخزينة"
      extra={extra}
      rules={optional ? [] : [{ required: true, message: 'اختر الخزينة التي ستتحرك منها الأموال' }]}
    >
      <Select
        showSearch style={{ width }} allowClear={optional}
        placeholder={placeholder ?? 'اختر الخزينة'}
        options={options.map((o) => ({
          value: o.value,
          label: o.label,
          title: o.title,
          children: undefined,
        }))}
        optionRender={(opt) => {
          const o = options.find((x) => x.value === opt.value)!;
          const short = Number(o.balance) < Number(amount || 0);
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>
                {o.short}
                {o.kind === 'bank' && <Tag style={{ marginInlineStart: 6 }}>بنك</Tag>}
                {o.isDefault && <Tag color="green" style={{ marginInlineStart: 6 }}>الافتراضية</Tag>}
              </span>
              <span style={{ color: short ? '#cf1322' : '#6AB42D', fontSize: 14 }}>
                {money(o.balance)}
              </span>
            </div>
          );
        }} filterOption={searchFilter} filterSort={searchRank}/>
    </Form.Item>
  );
}

export function defaultTreasuryId(treasuries: Treasury[]): number | undefined {
  const live = treasuries.filter((t) => t.active !== false);
  return (live.find((t) => t.is_default) ?? live[0])?.id;
}

export function ExpenseAccountField({
  accounts, onCreated, width = 300, groups = [], extra,
}: {
  accounts: ExpenseAccount[]; onCreated: () => void; width?: number | string;
  groups?: ExpenseAccount[];
  extra?: React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const tree = useMemo(() => gaTree(accounts, groups), [accounts, groups]);
  const toOpt = (a: ExpenseAccount) => ({
    value: a.id,
    label: a.name ?? a.code ?? '',
    search: a.code ?? '',
    full: a.name ?? a.code ?? '',
    spent: Number(a.balance || 0),
  });
  const options = useMemo(() => (tree
    ? tree.flatMap((t) => sortByName(t.leaves, (a) => a.name).map(toOpt))
    : sortByName(accounts, (a) => a.name).map(toOpt)), [accounts, tree]);
  const selectOptions = useMemo(() => (tree && tree.length > 1
    ? tree.map((t) => ({
      label: `${t.root.name} — ${branchOfCode(t.root.code)}`,
      options: sortByName(t.leaves, (a) => a.name).map(toOpt),
    }))
    : options), [tree, options]);
  const parentGroups = tree ? tree.flatMap((t) => t.subGroups) : groups;

  const create = async (v: any) => {
    setSaving(true);
    try {
      await api.post('/api/v1/accounts', {
        code: v.code, name: v.name, nature: 'expense', is_postable: true,
        parent_id: v.parent_id ?? null,
      });
      message.success('تمت إضافة حساب المصروف');
      setAdding(false);
      form.resetFields();
      onCreated();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إضافة الحساب');
    } finally { setSaving(false); }
  };

  return (
    <>
      <Form.Item
        name="expense_account_id"
        label="حساب المصروف"
        extra={extra}
        rules={[{ required: true, message: 'اختر حساب المصروف' }]}
      >
        <Select
          showSearch style={{ width }}
          placeholder="إيجار / مرتبات / بنزين…"
          options={selectOptions as any}
          optionRender={(opt) => {
            const o = options.find((x) => x.value === opt.value);
            if (!o) return opt.label;
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{o.full}</span>
                <span style={{ color: '#6b6b6b', fontSize: 14 }}>{money(o.spent)}</span>
              </div>
            );
          }}
          dropdownRender={(menu) => (
            <>
              {menu}
              <div style={{ borderTop: '1px solid #f0f0f0', padding: 6 }}>
                <Button type="link" icon={<PlusOutlined />} size="small"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (parentGroups.length === 1) form.setFieldsValue({ parent_id: parentGroups[0].id });
                    setAdding(true);
                  }}>
                  حساب مصروف جديد
                </Button>
              </div>
            </>
          )} filterOption={searchFilter} filterSort={searchRank}/>
      </Form.Item>

      <TabModal
        open={adding} onCancel={() => setAdding(false)} onOk={() => form.submit()}
        title="حساب مصروف جديد" okText="إضافة" cancelText="إلغاء"
        confirmLoading={saving} destroyOnHidden width={420}
      >
        <Form form={form} layout="vertical" onFinish={create} requiredMark={false}>
          <Form.Item name="parent_id" label="الحساب الرئيسي"
            rules={[{ required: true, message: 'اختر الحساب الرئيسي' }]}>
            <Select showSearch placeholder="مصروفات ..."
              options={parentGroups.map((g) => ({
                value: g.id,
                label: `${g.name ?? g.code ?? ''}${tree && tree.length > 1 ? ` — ${branchOfCode(g.code)}` : ''}`,
                search: g.code ?? '',
              }))} filterOption={searchFilter} filterSort={searchRank}/>
          </Form.Item>
          <Form.Item name="code" label="الكود"
            rules={[{ required: true, message: 'اكتب كود الحساب' }]}>
            <Input placeholder="مثال: 5.010" />
          </Form.Item>
          <Form.Item name="name" label="الاسم"
            rules={[{ required: true, message: 'اكتب اسم الحساب' }]}>
            <Input placeholder="مثال: بنزين وانتقالات" />
          </Form.Item>
        </Form>
      </TabModal>
    </>
  );
}

export { money as voucherMoney };
