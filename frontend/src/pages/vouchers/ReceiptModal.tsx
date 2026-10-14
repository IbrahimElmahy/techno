import React from 'react';
import { Form, Input, Segmented, Select, message } from 'antd';
import type { FormInstance } from 'antd';
import CostCenterField from '../../components/CostCenterField';
import { api } from '../../api/client';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import { Party, UserRecord, money } from './types';
import {
  PartyKind, PartyKindField, PartyKindSwitch, isCustomerKind, kindOfValues, PARTY_DOC_LABEL,
  usePostableAccounts,
} from './PartyKind';
import VoucherShell, { BalanceTarget, Counterpart, PartyBalance, VoucherSubmit } from './VoucherShell';
import { repOptions } from '../../utils/reps';

const alefs = (t: string) => t.replace(/[أإآ]/g, 'ا');

export default function ReceiptModal({
  open, onCancel, form, posting, submit, customers, treasuries,
  methodOptions, families, setFamilies, target, setTarget, reps = [],
  editing = false, treasuryOptional = false, suppliers = [], initialKind = 'customer',
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: VoucherSubmit;
  customers: Party[];
  treasuries: any[];
  methodOptions: { value: string; label: string }[];
  families: Record<number, any[]>;
  setFamilies: React.Dispatch<React.SetStateAction<Record<number, any[]>>>;
  target: string;
  setTarget: (v: string) => void;
  reps?: UserRecord[];
  editing?: boolean;
  treasuryOptional?: boolean;
  suppliers?: Party[];
  initialKind?: PartyKind;
}) {
  const [kind, setKind] = React.useState<PartyKind>('customer');
  React.useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    if (!editing) return;
    const t = setTimeout(() => {
      const k = kindOfValues(form.getFieldsValue(true), customers);
      if (k) setKind(k);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);
  const switchKind = (k: PartyKind) => {
    setKind(k);
    setTarget('');
    form.setFieldsValue({ customer_id: undefined, supplier_id: undefined, account_id: undefined });
  };

  const customerId = Form.useWatch('customer_id', form);
  const supplierId = Form.useWatch('supplier_id', form);
  const accountId = Form.useWatch('account_id', form);
  const kindKey = `${Form.useWatch('customer_id', form) ?? ''}|${Form.useWatch('supplier_id', form) ?? ''}|${Form.useWatch('account_id', form) ?? ''}`;
  React.useEffect(() => {
    if (!open || !editing) return;
    const k = kindOfValues(form.getFieldsValue(true), customers || []);
    if (k && k !== kind) setKind(k);
  }, [open, editing, kindKey, (customers || []).length]);
  const repUserId = Form.useWatch('rep_user_id', form) as number | undefined;
  const treasuryId = Form.useWatch('treasury_id', form) as number | undefined;
  const [boxes, setBoxes] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/api/v1/cash-boxes', { params: { active_only: true } })
      .then((r) => setBoxes((r.data || []).filter((b) => b.kind === 'safe' && b.custody_id)))
      .catch(() => setBoxes([]));
  }, [open]);
  const boxTreasuries = React.useMemo(() => boxes
    .filter((b) => !repUserId || b.rep_id === repUserId || -b.custody_id === treasuryId)
    .map((b) => ({
      id: -b.custody_id,
      name: b.family && !alefs(String(b.name)).includes(alefs(b.family)) ? `${b.name} — ${b.family}` : b.name,
      balance: b.balance, kind: 'custody', active: true, rep_id: b.rep_id, family: b.family,
    })), [boxes, repUserId, treasuryId]);
  const accounts = usePostableAccounts(kind === 'account');
  const lines = isCustomerKind(kind) ? families[customerId] || [] : [];
  React.useEffect(() => {
    if (!open || !editing || !boxes.length) return;
    const cash = form.getFieldValue('cash_account_id');
    if (!cash || form.getFieldValue('treasury_id')) return;
    const box = boxes.find((b) => b.account_id === cash);
    if (box) form.setFieldValue('treasury_id', -box.custody_id);
  }, [open, editing, boxes]);
  React.useEffect(() => {
    if (!treasuryId || treasuryId >= 0) return;
    const box = boxTreasuries.find((b) => b.id === treasuryId);
    if (!box) return;
    if (!form.getFieldValue('rep_user_id')) form.setFieldValue('rep_user_id', box.rep_id);
    if (box.family && !target && lines.some((l: any) => l.family === box.family)) setTarget(box.family);
  }, [treasuryId, lines.length]);

  const loadLines = (id: number) => {
    form.setFieldValue('customer_id', id);
    setTarget('');
    if (families[id]) return;
    api.get(`/api/v1/customers/${id}/accounts`)
      .then((r) => setFamilies((prev) => ({
        ...prev,
        [id]: (r.data?.accounts || []).filter((a: any) => a.family),
      })))
      .catch(() => setFamilies((prev) => ({ ...prev, [id]: [] })));
  };

  let counterpart: Counterpart;
  let balance: BalanceTarget;
  if (isCustomerKind(kind)) {
    counterpart = {
      label: PARTY_DOC_LABEL[kind],
      name: customerId ? customers.find((c) => c.id === customerId)?.name ?? `#${customerId}` : null,
    };
    balance = { side: 'customer', id: customerId };
  } else if (kind === 'supplier') {
    const s = suppliers.find((x) => x.id === supplierId);
    counterpart = { label: 'المورد', name: supplierId ? s?.name ?? `#${supplierId}` : null };
    balance = { side: 'supplier', id: supplierId, known: s?.balance };
  } else {
    const a = accounts.find((x: any) => x.id === accountId);
    counterpart = {
      label: 'الحساب',
      name: a ? (a.name ?? null) : null,
    };
    balance = { side: 'account', id: accountId };
  }

  const buildPayload = (raw: any) => {
    const { cash_account_id: _cash, ...rest } = raw;
    const v = rest.treasury_id < 0
      ? { ...rest, custody_id: -rest.treasury_id, treasury_id: undefined } : rest;
    if (!isCustomerKind(kind)) {
      return {
        ...v, customer_id: undefined, rep_user_id: undefined,
        supplier_id: kind === 'supplier' ? v.supplier_id : undefined,
        account_id: kind === 'account' ? v.account_id : undefined,
      };
    }
    const ls = families[v.customer_id] || [];
    if (ls.length >= 2 && !target) {
      message.error('حدد المديونية أو اختر «على الإجمالي»');
      return null;
    }
    return {
      ...v,
      family: target && target !== '__total__' ? target : undefined,
      on_total: target === '__total__',
    };
  };

  const party = (
    <>
      <PartyKindSwitch value={kind} onChange={switchKind} />
      <div data-vs-picker={kind === 'account' ? undefined : ''}>
        <PartyKindField
          kind={kind} customers={customers} suppliers={suppliers}
          onCustomerChange={isCustomerKind(kind) ? loadLines : undefined}
          extra={<PartyBalance target={balance} />}
        />
      </div>
      {lines.length >= 2 && (
        <Form.Item label="على أي مديونية؟" required>
          <Segmented
            block
            value={target}
            onChange={(v: string | number) => setTarget(String(v))}
            options={[
              ...lines.map((l: any) => ({
                value: l.family as string,
                label: `${l.family} (${money(Number(l.balance || 0))})`,
              })),
              { value: '__total__', label: 'على الإجمالي' },
            ]}
          />
        </Form.Item>
      )}
    </>
  );

  const details: React.ReactNode[] = [
    <Form.Item key="m" name="payment_method" label="طريقة الدفع">
      <Select allowClear placeholder="نقدي / تحويل …"
        options={methodOptions.map((o) => ({ value: o.value, label: o.label }))} />
    </Form.Item>,
    <Form.Item key="r" name="reference" label="المرجع">
      <Input placeholder="رقم الإيصال" />
    </Form.Item>,
    <Form.Item key="c" name="cost_center_id" label="مركز التكلفة">
      <CostCenterField style={{ width: '100%' }} />
    </Form.Item>,
    <Form.Item key="s" name="statement1" label="بيان السند">
      <Input placeholder="النص المكتوب على ورقة السند" />
    </Form.Item>,
  ];
  if (isCustomerKind(kind)) {
    details.unshift(
      <Form.Item key="rep" name="rep_user_id" label="المندوب">
        <Select
          allowClear showSearch placeholder="مندوب العميل (تلقائي)"
          options={repOptions(reps, repUserId)}
          filterOption={searchFilter} filterSort={searchRank}
        />
      </Form.Item>,
    );
  }

  return (
    <VoucherShell
      kind="receipt" open={open} onCancel={onCancel} editing={editing}
      posting={posting} form={form} submit={submit}
      url="/api/v1/vouchers/receipts" okMsg="تم تسجيل سند القبض ✔"
      buildPayload={buildPayload}
      party={party} counterpart={counterpart}
      treasuries={isCustomerKind(kind) ? [...treasuries, ...boxTreasuries] : treasuries}
      treasuryOptional={treasuryOptional}
      treasuryPlaceholder={treasuryOptional ? 'عهدة المندوب (دون تغيير)' : undefined}
      details={details}
      detailsLabel={`${isCustomerKind(kind) ? 'المندوب · ' : ''}طريقة الدفع · المرجع · مركز التكلفة · بيان السند`}
      journalNote={lines.length >= 2
        ? (target === '__total__' ? 'على الإجمالي — موزّع على الخطين'
          : target ? `على مديونية «${target}»` : 'اختر المديونية')
        : undefined}
      methodOptions={methodOptions}
      onAfterNew={() => setTarget('')}
    />
  );
}
