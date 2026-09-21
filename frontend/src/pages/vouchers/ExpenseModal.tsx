/**
 * سند مصروف — اتفصل عن `Vouchers.tsx`.
 *
 * الشاشة كانت مكوّن واحد ١٤٧٨ سطر فيه ستة بوبابات فوق بعض. كل بوباب بقى ملف
 * بمدخلاته مكتوبة: اللي بيعدّل سند المصروف مابيفتحش سند القبض قدامه، واللي بيقرا
 * بيشوف الفورم ده محتاج إيه بالظبط بدل ما يدوّر في حالة الشاشة كلها.
 *
 * الحالة بتفضل في الشاشة الأم — الفورم والقايمات والحفظ بيتبعتوا كمدخلات. البوباب
 * مالوش حالة خاصة بيه غير اللي يخصّه هو.
 */
import React from 'react';
import {
  Button, Col, DatePicker, Form, Input, Row, Segmented, Select, Space, message,
} from 'antd';
import dayjs from 'dayjs';
import type { FormInstance } from 'antd';
import { InputNumber } from '../../components/NumberInput';
import { TabModal } from '../../components/TabModal';
import PartyField from '../../components/PartyField';
import CostCenterField from '../../components/CostCenterField';
import CostCenterSplit from '../../components/CostCenterSplit';
import { TreasuryField, ExpenseAccountField } from '../../components/VoucherFields';
import { api } from '../../api/client';
import { Party, UserRecord, money } from './types';

export default function ExpenseModal({
  open, onCancel, form, posting, submit, expenseAccounts, expenseGroups,
  loadExpenseAccounts, treasuries,
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: (url: string, values: any, form: FormInstance, ok: string) => void;
  expenseAccounts: any[];
  expenseGroups: any[];
  loadExpenseAccounts: () => void;
  treasuries: any[];
}) {
  return (
      <TabModal
        open={open}
        title="سند مصروف"
        okText="تسجيل السند" cancelText="إلغاء"
        confirmLoading={posting}
        onCancel={onCancel}
        onOk={() => form.submit()}
        destroyOnHidden width={560}
      >
      <Form
                  form={form}
                  layout="vertical"
                  onFinish={(v) =>
                    submit('/api/v1/vouchers/expenses', v, form, 'تم تسجيل سند المصروف ✔')
                  }
                >
                  <ExpenseAccountField accounts={expenseAccounts} groups={expenseGroups}
                    onCreated={loadExpenseAccounts} />
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <TreasuryField treasuries={treasuries} />
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  {/* المصروف هو سند الوحيد اللي بيلمس حساب نتيجة، فهو الوحيد اللي
                      التوزيع بيفرق فيه — إيجار بيتقسّم على فرعين مثلاً. */}
                  <Form.Item label="مركز التكلفة">
                    <Space align="start">
                      <Form.Item name="cost_center_id" noStyle>
                        <CostCenterField style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item name="cost_center_distribution" noStyle>
                        <CostCenterSplit size="middle" />
                      </Form.Item>
                    </Space>
                  </Form.Item>
                  <Form.Item name="description" label="البيان">
                    <Input placeholder="اختياري" style={{ width: 180 }} />
                  </Form.Item>
                  {/* «بيان السند» كلام الورقة، مش وصف الحركة في القيد اللي فوق. */}
                  <Form.Item name="statement1" label="بيان السند">
                    <Input placeholder="الكلام المكتوب على ورقة السند" style={{ width: 220 }} />
                  </Form.Item>
                  {/* رقم الإيصال الورقي اللي إحنا خدناه — جنب رقم السند عندنا مش بداله. */}
                  <Form.Item name="external_document_number" label="رقم المستند">
                    <Input placeholder="رقم السند الورقي" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل المصروف
                    </Button>
                  </Form.Item>
                </Form>
      </TabModal>
  );
}
