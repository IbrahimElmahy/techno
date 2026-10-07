/**
 * سند قبض — اتفصل عن `Vouchers.tsx`، وشكله بقى من `VoucherShell` (٢٠٢٦-١٠-٠٧).
 *
 * الحالة بتفضل في الشاشة الأم — الفورم والقايمات والحفظ بيتبعتوا كمدخلات. البوباب
 * مالوش غير اللي يخصّه هو: نوع الطرف والـpayload. والـpayload هو هو زي ما كان.
 */
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

export default function ReceiptModal({
  open, onCancel, form, posting, submit, customers, treasuries,
  methodOptions, families, setFamilies, target, setTarget, reps = [],
  editing = false, treasuryOptional = false, suppliers = [],
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
  /** المناديب — لخانة «المندوب» (اختيارية). */
  reps?: UserRecord[];
  /** بيعدّل سند موجود — العنوان والزرار بيقولوا كده. */
  editing?: boolean;
  /** السند اللي بيتعدّل في عهدة المندوب — فاضي = يفضل فيها. */
  treasuryOptional?: boolean;
  /** الموردين — قبض من مورد (رجّع فلوس). */
  suppliers?: Party[];
}) {
  // الطرف (المرحلة ١): عميل افتراضياً زي الأول، والباقي اختيار. في التعديل من قيم السند.
  const [kind, setKind] = React.useState<PartyKind>('customer');
  React.useEffect(() => {
    if (!open) return;
    setKind('customer');
    if (!editing) return;
    // القيم بتتحط بعد ما البوباب يتركّب (`useQuickVoucher.edit`) — فبنقراها بعدها.
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
  const repUserId = Form.useWatch('rep_user_id', form) as number | undefined;
  const accounts = usePostableAccounts(kind === 'account');
  const lines = isCustomerKind(kind) ? families[customerId] || [] : [];

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

  // الطرف التاني في القيد (دائن) — ولرصيده تحت خانته.
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
      name: a ? `${a.code ? `${a.code} — ` : ''}${a.name ?? ''}` : null,
    };
    balance = { side: 'account', id: accountId };
  }

  const buildPayload = (v: any) => {
    if (!isCustomerKind(kind)) {
      return {
        ...v, customer_id: undefined, rep_user_id: undefined,
        supplier_id: kind === 'supplier' ? v.supplier_id : undefined,
        account_id: kind === 'account' ? v.account_id : undefined,
      };
    }
    const ls = families[v.customer_id] || [];
    if (ls.length >= 2 && !target) {
      message.error('حدد أنهي مديونية — أو اختر «على الإجمالي»');
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
        <Form.Item label="على أنهي مديونية؟" required
          tooltip="الإجمالي بيتوزّع على الخطين بنسبة مديونية كل واحد">
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
    // «بيان» الورقة — غير «البيان» اللي فوق: ده وصف الحركة في القيد، وده الكلام المكتوب
    // على السند نفسه. الاتنين موجودين في a5.
    <Form.Item key="s" name="statement1" label="بيان السند">
      <Input placeholder="الكلام المكتوب على ورقة السند" />
    </Form.Item>,
  ];
  // المندوب اللي حصّل — فاضي = مندوب العميل. من غيره السند كان بيتكتب من غير مندوب،
  // فكشف الحساب وفلتر المندوب مابيشوفوش التحصيل ده.
  if (isCustomerKind(kind)) {
    details.unshift(
      <Form.Item key="rep" name="rep_user_id" label="المندوب" tooltip="فاضي = مندوب العميل">
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
      treasuries={treasuries} treasuryOptional={treasuryOptional}
      treasuryPlaceholder={treasuryOptional ? 'عهدة المندوب (من غير تغيير)' : undefined}
      details={details}
      detailsLabel={`${isCustomerKind(kind) ? 'المندوب · ' : ''}طريقة الدفع · المرجع · مركز التكلفة · بيان السند`}
      journalNote={lines.length >= 2
        ? (target === '__total__' ? 'على الإجمالي — موزّع على الخطين'
          : target ? `على مديونية «${target}»` : 'اختار أنهي مديونية')
        : undefined}
      methodOptions={methodOptions}
      onAfterNew={() => setTarget('')}
    />
  );
}
