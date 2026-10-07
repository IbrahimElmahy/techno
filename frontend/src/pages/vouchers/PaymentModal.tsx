/**
 * سند صرف — اتفصل عن `Vouchers.tsx`، وشكله بقى من `VoucherShell` (٢٠٢٦-١٠-٠٧).
 *
 * الحالة بتفضل في الشاشة الأم — الفورم والقايمات والحفظ بيتبعتوا كمدخلات. البوباب
 * مالوش غير اللي يخصّه هو: نوع الطرف وخطوط العميل والـpayload (زي ما كان بالظبط).
 */
import React from 'react';
import { Form, Input, Segmented, Select, message } from 'antd';
import type { FormInstance } from 'antd';
import CostCenterField from '../../components/CostCenterField';
import { api } from '../../api/client';
import { Party, money } from './types';
import {
  PartyKind, PartyKindField, PartyKindSwitch, isCustomerKind, kindOfValues, PARTY_DOC_LABEL,
  usePostableAccounts,
} from './PartyKind';
import VoucherShell, { BalanceTarget, Counterpart, PartyBalance, VoucherSubmit } from './VoucherShell';

export default function PaymentModal({
  open, onCancel, form, posting, submit, suppliers, treasuries, methodOptions, editing = false,
  customers = [],
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: VoucherSubmit;
  suppliers: Party[];
  treasuries: any[];
  methodOptions: { value: string; label: string }[];
  /** بيعدّل سند موجود — العنوان والزرار بيقولوا كده. */
  editing?: boolean;
  /** العملاء (ومعاهم الموظفين والفروع) — صرف لعميل/سلفة موظف/تحويل لفرع. */
  customers?: Party[];
}) {
  // الطرف (المرحلة ١): مورد افتراضياً زي الأول، والباقي اختيار. في التعديل من قيم السند.
  const [kind, setKind] = React.useState<PartyKind>('supplier');
  // خطوط العميل (أبيض/بولي) — لو عنده الاتنين لازم يتحدد الصرف على أنهي واحد.
  const [lines, setLines] = React.useState<any[]>([]);
  const [family, setFamily] = React.useState<string>('');
  React.useEffect(() => {
    if (!open) return;
    setKind('supplier'); setLines([]); setFamily('');
    if (!editing) return;
    const t = setTimeout(() => {
      const k = kindOfValues(form.getFieldsValue(true), customers);
      if (k) setKind(k);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);
  const switchKind = (k: PartyKind) => {
    setKind(k);
    setLines([]);
    setFamily('');
    form.setFieldsValue({ customer_id: undefined, supplier_id: undefined, account_id: undefined });
  };

  const customerId = Form.useWatch('customer_id', form);
  const supplierId = Form.useWatch('supplier_id', form);
  const accountId = Form.useWatch('account_id', form);
  const accounts = usePostableAccounts(kind === 'account');

  // الطرف التاني في القيد (مدين) — ولرصيده تحت خانته.
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

  const buildPayload = (v: any) => {
    if (isCustomerKind(kind) && lines.length >= 2 && !family) {
      message.error('حدد الصرف على أنهي حساب — أبيض ولا بولي');
      return null;
    }
    return {
      ...v,
      supplier_id: kind === 'supplier' ? v.supplier_id : undefined,
      customer_id: isCustomerKind(kind) ? v.customer_id : undefined,
      account_id: kind === 'account' ? v.account_id : undefined,
      family: isCustomerKind(kind) && family ? family : undefined,
    };
  };

  const party = (
    <>
      <PartyKindSwitch value={kind} onChange={switchKind} />
      <div data-vs-picker={kind === 'account' ? undefined : ''}>
        <PartyKindField
          kind={kind} customers={customers} suppliers={suppliers}
          onCustomerChange={(id: number) => {
            form.setFieldValue('customer_id', id);
            setFamily('');
            api.get(`/api/v1/customers/${id}/accounts`)
              .then((r) => setLines((r.data?.accounts || []).filter((a: any) => a.family)))
              .catch(() => setLines([]));
          }}
          extra={<PartyBalance target={balance} />}
        />
      </div>
      {isCustomerKind(kind) && lines.length >= 2 && (
        <Form.Item label="الصرف على أنهي حساب؟" required>
          <Segmented
            block
            value={family}
            onChange={(x: string | number) => setFamily(String(x))}
            options={lines.map((l: any) => ({
              value: l.family as string,
              label: `${l.family} (${money(Number(l.balance || 0))})`,
            }))}
          />
        </Form.Item>
      )}
    </>
  );

  const details: React.ReactNode[] = [
    <Form.Item key="m" name="payment_method" label="طريقة الدفع">
      <Select allowClear placeholder="نقدي / شيك / تحويل …"
        options={methodOptions.map((o) => ({ value: o.value, label: o.label }))} />
    </Form.Item>,
    <Form.Item key="r" name="reference" label="المرجع">
      <Input placeholder="رقم الشيك/الإيصال" />
    </Form.Item>,
    <Form.Item key="c" name="cost_center_id" label="مركز التكلفة">
      <CostCenterField style={{ width: '100%' }} />
    </Form.Item>,
    // «بيان السند» كلام الورقة، مش وصف الحركة في القيد.
    <Form.Item key="s" name="statement1" label="بيان السند">
      <Input placeholder="الكلام المكتوب على ورقة السند" />
    </Form.Item>,
  ];

  return (
    <VoucherShell
      kind="payment" open={open} onCancel={onCancel} editing={editing}
      posting={posting} form={form} submit={submit}
      url="/api/v1/vouchers/payments" okMsg="تم تسجيل سند الصرف ✔"
      buildPayload={buildPayload}
      party={party} counterpart={counterpart}
      treasuries={treasuries}
      details={details}
      detailsLabel="طريقة الدفع · المرجع · مركز التكلفة · بيان السند"
      journalNote={isCustomerKind(kind) && lines.length >= 2
        ? (family ? `على حساب «${family}»` : 'اختار أنهي حساب')
        : undefined}
      methodOptions={methodOptions}
      onAfterNew={() => { setLines([]); setFamily(''); }}
    />
  );
}
