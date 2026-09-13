/**
 * سند قبض — اتفصل عن `Vouchers.tsx`.
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

export default function ReceiptModal({
  open, onCancel, form, posting, submit, customers, treasuries,
  methodOptions, families, setFamilies, target, setTarget,
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: (url: string, values: any, form: FormInstance, ok: string) => void;
  customers: Party[];
  treasuries: any[];
  methodOptions: { value: string; label: string }[];
  families: Record<number, any[]>;
  setFamilies: React.Dispatch<React.SetStateAction<Record<number, any[]>>>;
  target: string;
  setTarget: (v: string) => void;
}) {
  return (
      <TabModal
        open={open}
        title="سند قبض — تحصيل من عميل"
        okText="تسجيل السند" cancelText="إلغاء"
        confirmLoading={posting}
        onCancel={onCancel}
        onOk={() => form.submit()}
        destroyOnHidden width={560}
      >
      <Form
                  form={form}
                  layout="vertical"
                  onFinish={(v) => {
                    const lines = families[v.customer_id] || [];
                    if (lines.length >= 2 && !target) {
                      message.error('حدد أنهي مديونية — أو اختر «على الإجمالي»');
                      return;
                    }
                    submit('/api/v1/vouchers/receipts', {
                      ...v,
                      family: target && target !== '__total__'
                        ? target : undefined,
                      on_total: target === '__total__',
                    }, form, 'تم تسجيل سند القبض ✔');
                  }}
                >
                  <Form.Item name="customer_id" label="العميل" rules={[{ required: true, message: 'اختر العميل' }]}>
                    <PartyField
                      kind="customer"
                      options={customers.map((c) => ({ value: c.id, label: c.name }))}
                      onChange={(id: number) => {
                        form.setFieldValue('customer_id', id);
                        setTarget('');
                        if (families[id]) return;
                        api.get(`/api/v1/customers/${id}/accounts`)
                          .then((r) => setFamilies((prev) => ({
                            ...prev,
                            [id]: (r.data?.accounts || []).filter((a: any) => a.family),
                          })))
                          .catch(() => setFamilies((prev) => ({ ...prev, [id]: [] })));
                      }}
                    />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(a, b) => a.customer_id !== b.customer_id}>
                    {({ getFieldValue }) => {
                      const lines = families[getFieldValue('customer_id')] || [];
                      if (lines.length < 2) return null;
                      return (
                        <Form.Item label="على أنهي مديونية؟" required
                          tooltip="الإجمالي بيتوزّع على الخطين بنسبة مديونية كل واحد">
                          <Segmented
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
                      );
                    }}
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  <TreasuryField treasuries={treasuries} />
                  <Form.Item name="payment_method" label="طريقة الدفع">
                    <Select
                      allowClear
                      style={{ width: 130 }}
                      options={methodOptions.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </Form.Item>
                  <Form.Item name="reference" label="المرجع">
                    <Input placeholder="رقم الإيصال" style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="cost_center_id" label="مركز التكلفة">
                    <CostCenterField />
                  </Form.Item>
                  <Form.Item name="description" label="البيان">
                    <Input placeholder="اختياري" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل السند
                    </Button>
                  </Form.Item>
                </Form>
      </TabModal>
  );
}
