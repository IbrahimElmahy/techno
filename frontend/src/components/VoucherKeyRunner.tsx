import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Alert, Button, Card, DatePicker, Descriptions, Form, Input, Select, Space, Spin, Steps, Tag, Tooltip, message,
} from 'antd';
import { InputNumber } from './NumberInput';
import { ThunderboltOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import PartyField from './PartyField';
import { Treasury, defaultTreasuryId } from './VoucherFields';
import { TabModal } from './TabModal';
import { money } from '../utils/money';
import { repOptions } from '../utils/reps';

export interface VoucherKey {
  id: number;
  name: string;
  debit_account_id: number | null;
  credit_account_id: number | null;
  debit_group: string | null;
  credit_group: string | null;
  debit_account_name: string | null;
  credit_account_name: string | null;
  payment_method: string | null;
  family: string | null;
  cost_center_id: number | null;
  description: string | null;
  sort_order: number;
  active: boolean;
  voucher_kind: string;
  asks: string[];
}

export const KIND_LABELS: Record<string, string> = {
  receipt: 'سند قبض',
  payment: 'سند صرف',
  handover: 'سند توريد مندوب',
  expense: 'سند مصروف',
  transfer: 'تحويل بين خزينتين',
  journal: 'قيد حر',
};

export const KIND_COLORS: Record<string, string> = {
  receipt: 'green',
  payment: 'red',
  handover: 'blue',
  expense: 'orange',
  transfer: 'purple',
  journal: 'default',
};

interface Party { id: number; name?: string; full_name?: string; username?: string }
interface Account { id: number; code: string | null; name: string | null; parent_id: number | null;
  account_type?: string | null; is_postable: boolean; active: boolean; owner_name?: string | null }

export interface RunnerWorld {
  treasuries: Treasury[];
  customers: Party[];
  suppliers: Party[];
  reps: Party[];
  accounts: Account[];
}

export const EMPTY_WORLD: RunnerWorld = {
  treasuries: [], customers: [], suppliers: [], reps: [], accounts: [],
};

export function useRunnerWorld(enabled = true): [RunnerWorld, () => void] {
  const [world, setWorld] = useState<RunnerWorld>(EMPTY_WORLD);

  const load = useCallback(() => {
    if (!enabled) return;
    Promise.all([
      api.get('/api/v1/treasuries').catch(() => ({ data: [] })),
      api.get('/api/v1/customers/options', { params: { limit: 20000 } }).catch(() => ({ data: [] })),
      api.get('/api/v1/suppliers').catch(() => ({ data: [] })),
      api.get('/api/v1/users', { params: { role: 'rep' } }).catch(() => ({ data: [] })),
      api.get('/api/v1/accounts').catch(() => ({ data: [] })),
    ]).then(([t, c, s, r, a]) => setWorld({
      treasuries: t.data || [],
      customers: (c.data?.items ?? c.data) || [],
      suppliers: (s.data?.items ?? s.data) || [],
      reps: sortByName(((r.data?.items ?? r.data) || [])
        .filter((u: any) => u.role === 'sales_rep'), (u: any) => u.full_name || u.username),
      accounts: a.data || [],
    }));
  }, [enabled]);

  useEffect(() => { load(); }, [load]);
  return [world, load];
}

function treasuryFor(world: RunnerWorld, accountId: number): Treasury | undefined {
  return world.treasuries.find((t: any) => t.account_id === accountId);
}

function choicesFor(accounts: Account[], accountId: number | null, group: string | null): Account[] {
  const live = accounts.filter((a) => a.is_postable && a.active !== false);
  if (group) return live.filter((a) => a.account_type === group);
  if (!accountId) return [];
  const kids: Account[] = [];
  const walk = (parent: number) => {
    for (const a of accounts) {
      if (a.parent_id !== parent) continue;
      if (a.is_postable && a.active !== false) kids.push(a);
      walk(a.id);
    }
  };
  walk(accountId);
  return kids;
}

const label = (a: Account) => a.owner_name || a.name || a.code || `#${a.id}`;

export interface RunnerProps {
  keyDef: VoucherKey | null;
  world: RunnerWorld;
  onClose: () => void;
  onPosted?: () => void;
}

export default function VoucherKeyRunner({ keyDef, world, onClose, onPosted }: RunnerProps) {
  const [step, setStep] = useState(0);
  const [posting, setPosting] = useState(false);
  const [form] = Form.useForm();

  const asks = keyDef?.asks ?? [];
  const kind = keyDef?.voucher_kind ?? 'journal';

  const debitTreasury = keyDef?.debit_account_id
    ? treasuryFor(world, keyDef.debit_account_id) : undefined;
  const creditTreasury = keyDef?.credit_account_id
    ? treasuryFor(world, keyDef.credit_account_id) : undefined;

  useEffect(() => {
    if (!keyDef) return;
    setStep(0);
    form.resetFields();
    form.setFieldsValue({
      voucher_date: dayjs(),
      description: keyDef.description || undefined,
      payment_method: keyDef.payment_method || undefined,
      treasury_id: debitTreasury?.id ?? creditTreasury?.id ?? defaultTreasuryId(world.treasuries),
    });
  }, [keyDef?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsTreasury = kind === 'receipt' || kind === 'payment' || kind === 'expense';
  const askingTreasury = needsTreasury && !debitTreasury && !creditTreasury;

  const doors = useMemo(() => {
    if (kind === 'transfer') {
      const d: string[] = [];
      if (!creditTreasury) d.push('from_treasury');
      if (!debitTreasury) d.push('to_treasury');
      return d;
    }
    const treasurySide = keyDef?.debit_group === 'treasury' ? 'debit_account'
      : keyDef?.credit_group === 'treasury' ? 'credit_account' : null;
    const d = asks.filter((a) => a !== treasurySide);
    if (askingTreasury || treasurySide) d.push('treasury');
    return d;
  }, [asks, askingTreasury, kind, debitTreasury, creditTreasury,
    keyDef?.debit_group, keyDef?.credit_group]);

  const values = Form.useWatch([], form) || {};

  const partyName = () => {
    if (values.customer_id) {
      return world.customers.find((c) => c.id === values.customer_id)?.name;
    }
    if (values.supplier_id) {
      return world.suppliers.find((s) => s.id === values.supplier_id)?.name;
    }
    if (values.rep_user_id) {
      const r = world.reps.find((x) => x.id === values.rep_user_id);
      return r?.full_name || r?.username;
    }
    return undefined;
  };

  const sideAccount = (side: 'debit' | 'credit') => {
    if (!keyDef) return undefined;
    const group = side === 'debit' ? keyDef.debit_group : keyDef.credit_group;
    if (group === 'treasury' && values.treasury_id) {
      return world.treasuries.find((t: any) => t.id === values.treasury_id)?.account_id;
    }
    const asked = values[`${side}_account_id`];
    if (asked) return asked;
    return side === 'debit' ? keyDef.debit_account_id : keyDef.credit_account_id;
  };

  const submit = async () => {
    if (!keyDef) return;
    const v = await form.validateFields();
    const date = (v.voucher_date as Dayjs)?.format('YYYY-MM-DD');
    const amount = String(v.amount);
    const common = {
      amount,
      voucher_date: date,
      description: v.description || null,
      reference: v.reference || null,
    };
    setPosting(true);
    try {
      if (kind === 'receipt') {
        await api.post('/api/v1/vouchers/receipts', {
          ...common,
          customer_id: v.customer_id,
          treasury_id: v.treasury_id ?? debitTreasury?.id,
          payment_method: v.payment_method || null,
          family: keyDef.family || undefined,
          on_total: !keyDef.family,
        });
      } else if (kind === 'payment') {
        await api.post('/api/v1/vouchers/payments', {
          ...common,
          supplier_id: v.supplier_id,
          treasury_id: v.treasury_id ?? creditTreasury?.id,
          payment_method: v.payment_method || null,
        });
      } else if (kind === 'handover') {
        await api.post('/api/v1/vouchers/handovers', {
          ...common,
          rep_user_id: v.rep_user_id,
        });
      } else if (kind === 'expense') {
        await api.post('/api/v1/vouchers/expenses', {
          ...common,
          expense_account_id: sideAccount('debit'),
          treasury_id: v.treasury_id ?? creditTreasury?.id,
        });
      } else if (kind === 'transfer') {
        await api.post('/api/v1/vouchers/transfers', {
          ...common,
          from_treasury_id: creditTreasury?.id ?? v.from_treasury_id,
          to_treasury_id: debitTreasury?.id ?? v.to_treasury_id,
        });
      } else {
        await api.post('/api/v1/journal-entries', {
          date,
          description: v.description || keyDef.name,
          lines: [
            { account_id: sideAccount('debit'), direction: 'debit', amount,
              statement: v.description || null, cost_center_id: keyDef.cost_center_id || null },
            { account_id: sideAccount('credit'), direction: 'credit', amount,
              statement: v.description || null, cost_center_id: keyDef.cost_center_id || null },
          ],
        });
      }
      message.success(`تم تسجيل ${KIND_LABELS[kind] || 'السند'} — ${keyDef.name}`);
      onClose();
      onPosted?.();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message
        || err?.response?.data?.detail
        || 'تعذّر ترحيل السند');
    } finally {
      setPosting(false);
    }
  };

  if (!keyDef) return null;

  const stoppedSafe = [debitTreasury, creditTreasury]
    .find((t) => t && t.active === false);

  const groupSide = (side: 'debit' | 'credit') => choicesFor(
    world.accounts,
    side === 'debit' ? keyDef.debit_account_id : keyDef.credit_account_id,
    side === 'debit' ? keyDef.debit_group : keyDef.credit_group,
  );

  const stepItems = [
    ...(doors.length ? [{ title: 'الطرف' }] : []),
    { title: 'المبلغ' },
    { title: 'مراجعة' },
  ];
  const partyStep = doors.length ? 0 : -1;
  const amountStep = partyStep + 1;
  const reviewStep = amountStep + 1;

  const next = async () => {
    await form.validateFields(
      step === partyStep
        ? doors.map((d) => (d === 'rep' ? 'rep_user_id' : `${d}_id`))
        : ['amount', 'voucher_date'],
    );
    setStep(step + 1);
  };

  return (
    <TabModal
      open
      title={(
        <Space>
          <ThunderboltOutlined />
          {keyDef.name}
          <Tag color={KIND_COLORS[kind]}>{KIND_LABELS[kind] || kind}</Tag>
        </Space>
      )}
      onCancel={onClose}
      destroyOnHidden
      width={560}
      footer={(
        <Space>
          <Button onClick={onClose}>إلغاء</Button>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>رجوع</Button>}
          {step < reviewStep
            ? <Button type="primary" onClick={next}>التالي</Button>
            : (
              <Button type="primary" loading={posting} onClick={submit}
                disabled={!!stoppedSafe}>
                ترحيل {KIND_LABELS[kind] || 'السند'}
              </Button>
            )}
        </Space>
      )}
    >
      {stoppedSafe && (
        <Alert
          type="error" showIcon style={{ marginBottom: 12 }}
          message={`خزنة «${stoppedSafe.name}» موقوفة — لن يُرحَّل هذا المفتاح.`}
          description="أعد تشغيل الخزنة من صفحة الخزائن، أو عدّل المفتاح ليشير إلى خزنة نشطة."
        />
      )}
      <Steps size="small" current={step} items={stepItems} style={{ marginBottom: 16 }} />

      <Form form={form} layout="vertical" requiredMark={false}>
        <div style={{ display: step === partyStep ? 'block' : 'none' }}>
          {doors.includes('customer') && (
            <Form.Item name="customer_id" label="العميل"
              rules={[{ required: true, message: 'اختر العميل' }]}>
              <PartyField
                kind="customer"
                options={world.customers.map((c) => ({ value: c.id, label: c.name || '' }))}
                onChange={(id: number) => form.setFieldValue('customer_id', id)}
              />
            </Form.Item>
          )}
          {doors.includes('supplier') && (
            <Form.Item name="supplier_id" label="المورد"
              rules={[{ required: true, message: 'اختر المورد' }]}>
              <PartyField
                kind="supplier"
                options={world.suppliers.map((s) => ({ value: s.id, label: s.name || '' }))}
                onChange={(id: number) => form.setFieldValue('supplier_id', id)}
              />
            </Form.Item>
          )}
          {doors.includes('rep') && (
            <Form.Item name="rep_user_id" label="المندوب"
              rules={[{ required: true, message: 'اختر المندوب' }]}>
              <Select showSearch placeholder="اختر المندوب"
                options={repOptions(world.reps)} filterOption={searchFilter} filterSort={searchRank}/>
            </Form.Item>
          )}
          {(['debit', 'credit'] as const).map((side) => doors.includes(`${side}_account`) && (
            <Form.Item key={side} name={`${side}_account_id`}
              label={`${side === 'debit' ? 'المدين' : 'الدائن'} — تحت «${
                (side === 'debit' ? keyDef.debit_account_name : keyDef.credit_account_name) || '—'}»`}
              rules={[{ required: true, message: 'اختر الحساب' }]}>
              <Select showSearch placeholder="اختر الحساب"
                options={groupSide(side).map((a) => ({ value: a.id, label: label(a) }))} filterOption={searchFilter} filterSort={searchRank}/>
            </Form.Item>
          ))}
          {(['from_treasury', 'to_treasury'] as const).map((door) => doors.includes(door) && (
            <Form.Item key={door} name={`${door}_id`}
              label={door === 'from_treasury' ? 'من خزنة' : 'إلى خزنة'}
              rules={[{ required: true, message: 'اختر الخزنة' }]}>
              <Select
                options={world.treasuries.filter((t) => t.active).map((t) => ({
                  value: t.id, label: `${t.name} (${money((t as any).balance)})` }))} />
            </Form.Item>
          ))}
          {doors.includes('treasury') && (
            <Form.Item name="treasury_id" label="الخزنة"
              rules={[{ required: true, message: 'اختر الخزنة' }]}>
              <Select
                options={world.treasuries.filter((t) => t.active).map((t) => ({
                  value: t.id, label: `${t.name} (${money((t as any).balance)})` }))} />
            </Form.Item>
          )}
        </div>

        <div style={{ display: step === amountStep ? 'block' : 'none' }}>
          <Form.Item name="amount" label="المبلغ"
            rules={[{ required: true, message: 'اكتب المبلغ' }]}>
            <InputNumber autoFocus style={{ width: '100%' }} min={0.01} step={0.01}
              placeholder="0.00" />
          </Form.Item>
          <Form.Item name="voucher_date" label="التاريخ"
            rules={[{ required: true, message: 'اختر التاريخ' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          {(kind === 'receipt' || kind === 'payment') && !keyDef.payment_method && (
            <Form.Item name="payment_method" label="طريقة الدفع">
              <Select allowClear options={[
                { value: 'cash', label: 'نقدي' },
                { value: 'bank', label: 'تحويل بنكي' },
                { value: 'cheque', label: 'شيك' },
              ]} />
            </Form.Item>
          )}
          <Form.Item name="reference" label="المرجع">
            <Input placeholder="اختياري — رقم إيصال مثلاً" />
          </Form.Item>
          <Form.Item name="description" label="البيان" style={{ marginBottom: 0 }}>
            <Input placeholder="اختياري" />
          </Form.Item>
        </div>
      </Form>

      {step === reviewStep && (
        <>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="النوع">
              <Tag color={KIND_COLORS[kind]}>{KIND_LABELS[kind] || kind}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="مدين">
              {keyDef.debit_account_name || '—'}
              {values.debit_account_id && (
                <> ← {label(groupSide('debit').find((a) => a.id === values.debit_account_id)
                  || ({ id: 0, code: null, name: null, parent_id: null,
                    is_postable: true, active: true } as Account))}</>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="دائن">
              {keyDef.credit_account_name || '—'}
              {values.credit_account_id && (
                <> ← {label(groupSide('credit').find((a) => a.id === values.credit_account_id)
                  || ({ id: 0, code: null, name: null, parent_id: null,
                    is_postable: true, active: true } as Account))}</>
              )}
            </Descriptions.Item>
            {partyName() && (
              <Descriptions.Item label="الطرف">{partyName()}</Descriptions.Item>
            )}
            <Descriptions.Item label="المبلغ">
              <b style={{ fontSize: 16 }}>{money(values.amount)}</b>
            </Descriptions.Item>
            <Descriptions.Item label="التاريخ">
              {(values.voucher_date as Dayjs)?.format('YYYY-MM-DD')}
            </Descriptions.Item>
            {values.description && (
              <Descriptions.Item label="البيان">{values.description}</Descriptions.Item>
            )}
          </Descriptions>
        </>
      )}
    </TabModal>
  );
}

export function VoucherKeyStrip(
  { world, onPosted }: { world: RunnerWorld; onPosted?: () => void },
) {
  const [keys, setKeys] = useState<VoucherKey[] | null>(null);
  const [running, setRunning] = useState<VoucherKey | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  useEffect(() => {
    api.get<VoucherKey[]>('/api/v1/voucher-keys')
      .then((r) => {
        const live = (r.data || []).filter((k) => k.active);
        setKeys(live);
        const needsChart = live.some((k) => k.asks.some((a) => a.endsWith('_account')));
        if (needsChart && !world.accounts.length) {
          api.get<Account[]>('/api/v1/accounts')
            .then((a) => setAccounts(a.data || []))
            .catch(() => setAccounts([]));
        }
      })
      .catch(() => setKeys([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filled = useMemo<RunnerWorld>(
    () => (accounts && !world.accounts.length ? { ...world, accounts } : world),
    [world, accounts],
  );

  if (keys === null) return <Spin size="small" />;
  if (!keys.length) return null;

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}
        title={<Space><ThunderboltOutlined /> مفاتيح خاصة</Space>}>
        <Space wrap>
          {keys.map((k) => (
            <Tooltip key={k.id}
              title={`${k.debit_account_name || '—'} ← ${k.credit_account_name || '—'}`}>
              <Button onClick={() => setRunning(k)}>
                {k.name}
                <Tag color={KIND_COLORS[k.voucher_kind]} style={{ marginInlineStart: 6 }}>
                  {KIND_LABELS[k.voucher_kind] || k.voucher_kind}
                </Tag>
              </Button>
            </Tooltip>
          ))}
        </Space>
      </Card>
      <VoucherKeyRunner keyDef={running} world={filled}
        onClose={() => setRunning(null)} onPosted={onPosted} />
    </>
  );
}
