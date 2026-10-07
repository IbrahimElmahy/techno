/**
 * سند مصروف — اتفصل عن `Vouchers.tsx`، وشكله بقى من `VoucherShell` (٢٠٢٦-١٠-٠٧).
 *
 * الطرف هنا حساب المصروف (من الشجرة، وبيتضاف من نفس الخانة)، والقيد: مدين المصروف /
 * دائن الخزينة. الـpayload هو هو زي ما كان.
 */
import React from 'react';
import { Form, Input, Space } from 'antd';
import type { FormInstance } from 'antd';
import CostCenterField from '../../components/CostCenterField';
import CostCenterSplit from '../../components/CostCenterSplit';
import { ExpenseAccountField } from '../../components/VoucherFields';
import { money } from './types';
import VoucherShell, { VoucherSubmit } from './VoucherShell';

export default function ExpenseModal({
  open, onCancel, form, posting, submit, expenseAccounts, expenseGroups,
  loadExpenseAccounts, treasuries,
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: VoucherSubmit;
  expenseAccounts: any[];
  expenseGroups: any[];
  loadExpenseAccounts: () => void;
  treasuries: any[];
}) {
  const accountId = Form.useWatch('expense_account_id', form);
  const account = expenseAccounts.find((a) => a.id === accountId);
  const name = account ? `${account.code ? `${account.code} — ` : ''}${account.name ?? ''}` : null;

  const party = (
    <ExpenseAccountField accounts={expenseAccounts} groups={expenseGroups}
      onCreated={loadExpenseAccounts} width="100%"
      // «صرفنا على البنزين كام لحد دلوقتي» — السؤال اللي في الدماغ وهو بيختار الحساب.
      extra={account ? (
        <span className="vs-hint">اتصرف عليه لحد دلوقتي: <b>{money(account.balance)}</b></span>
      ) : undefined} />
  );

  const details: React.ReactNode[] = [
    // المصروف هو السند الوحيد اللي بيلمس حساب نتيجة، فهو الوحيد اللي التوزيع بيفرق
    // فيه — إيجار بيتقسّم على فرعين مثلاً.
    <Form.Item key="c" label="مركز التكلفة">
      <Space align="start" wrap>
        <Form.Item name="cost_center_id" noStyle>
          <CostCenterField style={{ width: 220 }} />
        </Form.Item>
        <Form.Item name="cost_center_distribution" noStyle>
          <CostCenterSplit size="middle" />
        </Form.Item>
      </Space>
    </Form.Item>,
    // «بيان السند» كلام الورقة، مش وصف الحركة في القيد.
    <Form.Item key="s" name="statement1" label="بيان السند">
      <Input placeholder="الكلام المكتوب على ورقة السند" />
    </Form.Item>,
  ];

  return (
    <VoucherShell
      kind="expense" open={open} onCancel={onCancel}
      posting={posting} form={form} submit={submit}
      url="/api/v1/vouchers/expenses" okMsg="تم تسجيل سند المصروف ✔"
      buildPayload={(v) => v}
      party={party} counterpart={{ label: 'حساب المصروف', name }}
      treasuries={treasuries}
      details={details}
      detailsLabel="مركز التكلفة · بيان السند"
    />
  );
}
