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
  const name = account ? (account.name ?? null) : null;

  const party = (
    <ExpenseAccountField accounts={expenseAccounts} groups={expenseGroups}
      onCreated={loadExpenseAccounts} width="100%"
      extra={account ? (
        <span className="vs-hint">المنصرف عليه حتى الآن: <b>{money(account.balance)}</b></span>
      ) : undefined} />
  );

  const details: React.ReactNode[] = [
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
    <Form.Item key="s" name="statement1" label="بيان السند">
      <Input placeholder="النص المكتوب على ورقة السند" />
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
