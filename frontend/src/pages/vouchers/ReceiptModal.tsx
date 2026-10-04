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
import { filterBranch } from '../../hooks/useBranchScope';
import CostCenterField from '../../components/CostCenterField';
import CostCenterSplit from '../../components/CostCenterSplit';
import { TreasuryField, ExpenseAccountField } from '../../components/VoucherFields';
import { api } from '../../api/client';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import { Party, UserRecord, money } from './types';

export default function ReceiptModal({
  open, onCancel, form, posting, submit, customers, treasuries,
  methodOptions, families, setFamilies, target, setTarget, reps = [],
  editing = false, treasuryOptional = false,
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
  /** المناديب — لخانة «المندوب» (اختيارية). */
  reps?: UserRecord[];
  /** بيعدّل سند موجود — العنوان والزرار بيقولوا كده. */
  editing?: boolean;
  /** السند اللي بيتعدّل في عهدة المندوب — فاضي = يفضل فيها. */
  treasuryOptional?: boolean;
}) {
  /** فرع العميل المختار — فاضي = مشترك/مش متحدد ⇒ مافيش فلترة. */
  const customerBranch = (id?: number | null) =>
    (id ? customers.find((c) => c.id === id)?.branch_id : null) ?? null;
  return (
      <TabModal
        open={open}
        title={editing ? 'تعديل سند قبض' : 'سند قبض — تحصيل من عميل'}
        okText={editing ? 'حفظ التعديل' : 'تسجيل السند'} cancelText="إلغاء"
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
                  <Form.Item noStyle shouldUpdate={(a, b) => a.customer_id !== b.customer_id}>
                    {({ getFieldValue }) => (
                      // (فصل الفروع) خزن فرع العميل بس — السيرفر بيرفض خزنة من فرع تاني.
                      <TreasuryField treasuries={treasuries} optional={treasuryOptional}
                        branchId={customerBranch(getFieldValue('customer_id'))}
                        placeholder={treasuryOptional ? 'عهدة المندوب (من غير تغيير)' : undefined} />
                    )}
                  </Form.Item>
                  {/* المندوب اللي حصّل — فاضي = مندوب العميل. من غيره السند كان بيتكتب من غير
                      مندوب، فكشف الحساب وفلتر المندوب مابيشوفوش التحصيل ده. */}
                  <Form.Item noStyle shouldUpdate={(a, b) => a.customer_id !== b.customer_id}>
                    {({ getFieldValue }) => (
                      <Form.Item name="rep_user_id" label="المندوب" tooltip="فاضي = مندوب العميل">
                        <Select
                          allowClear showSearch style={{ width: 220 }}
                          placeholder="مندوب العميل (تلقائي)"
                          // مناديب فرع العميل بس — نفس قاعدة الخزنة.
                          options={filterBranch(reps as any[], customerBranch(getFieldValue('customer_id')))
                            .map((r: any) => ({ value: r.id, label: r.full_name || r.username }))}
                          filterOption={searchFilter} filterSort={searchRank}
                        />
                      </Form.Item>
                    )}
                  </Form.Item>
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
                  {/* «بيان» الورقة — غير «البيان» اللي فوق: ده وصف الحركة في القيد،
                      وده الكلام المكتوب على السند نفسه. الاتنين موجودين في a5. */}
                  <Form.Item name="statement1" label="بيان السند">
                    <Input placeholder="الكلام المكتوب على ورقة السند" style={{ width: 220 }} />
                  </Form.Item>
                  {/* رقم الورقة اللي في إيد العميل — بيتحفظ جنب رقم السند عندنا. */}
                  <Form.Item name="external_document_number" label="رقم المستند">
                    <Input placeholder="رقم السند الورقي" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      {editing ? 'حفظ التعديل' : 'تسجيل السند'}
                    </Button>
                  </Form.Item>
                </Form>
      </TabModal>
  );
}
