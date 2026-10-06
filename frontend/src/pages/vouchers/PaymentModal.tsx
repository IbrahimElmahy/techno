/**
 * سند صرف — اتفصل عن `Vouchers.tsx`.
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
import { PartyKind, PartyKindField, PartyKindSwitch, isCustomerKind } from './PartyKind';

export default function PaymentModal({
  open, onCancel, form, posting, submit, suppliers, treasuries, methodOptions, editing = false,
  customers = [],
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: (url: string, values: any, form: FormInstance, ok: string) => void;
  suppliers: Party[];
  treasuries: any[];
  methodOptions: { value: string; label: string }[];
  /** بيعدّل سند موجود — العنوان والزرار بيقولوا كده. */
  editing?: boolean;
  /** العملاء (ومعاهم الموظفين والفروع) — صرف لعميل/سلفة موظف/تحويل لفرع. */
  customers?: Party[];
}) {
  // الطرف (المرحلة ١): مورد افتراضياً زي الأول، والباقي اختيار.
  const [kind, setKind] = React.useState<PartyKind>('supplier');
  // خطوط العميل (أبيض/بولي) — لو عنده الاتنين لازم يتحدد الصرف على أنهي واحد.
  const [lines, setLines] = React.useState<any[]>([]);
  const [family, setFamily] = React.useState<string>('');
  React.useEffect(() => { if (open) { setKind('supplier'); setLines([]); setFamily(''); } }, [open]);
  const switchKind = (k: PartyKind) => {
    setKind(k);
    setLines([]);
    setFamily('');
    form.setFieldsValue({ customer_id: undefined, supplier_id: undefined, account_id: undefined });
  };
  return (
      <TabModal
        open={open}
        title={editing ? 'تعديل سند صرف' : 'سند صرف'}
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
                    if (isCustomerKind(kind) && lines.length >= 2 && !family) {
                      message.error('حدد الصرف على أنهي حساب — أبيض ولا بولي');
                      return;
                    }
                    submit('/api/v1/vouchers/payments', {
                      ...v,
                      supplier_id: kind === 'supplier' ? v.supplier_id : undefined,
                      customer_id: isCustomerKind(kind) ? v.customer_id : undefined,
                      account_id: kind === 'account' ? v.account_id : undefined,
                      family: isCustomerKind(kind) && family ? family : undefined,
                    }, form, 'تم تسجيل سند الصرف ✔');
                  }}
                >
                  <PartyKindSwitch value={kind} onChange={switchKind} />
                  <PartyKindField
                    kind={kind} customers={customers} suppliers={suppliers}
                    onCustomerChange={(id: number) => {
                      form.setFieldValue('customer_id', id);
                      setFamily('');
                      api.get(`/api/v1/customers/${id}/accounts`)
                        .then((r) => setLines((r.data?.accounts || []).filter((a: any) => a.family)))
                        .catch(() => setLines([]));
                    }}
                  />
                  {isCustomerKind(kind) && lines.length >= 2 && (
                    <Form.Item label="الصرف على أنهي حساب؟" required>
                      <Segmented
                        value={family}
                        onChange={(x: string | number) => setFamily(String(x))}
                        options={lines.map((l: any) => ({
                          value: l.family as string,
                          label: `${l.family} (${money(Number(l.balance || 0))})`,
                        }))}
                      />
                    </Form.Item>
                  )}
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
                    <Input placeholder="رقم الشيك/الإيصال" style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item name="cost_center_id" label="مركز التكلفة">
                    <CostCenterField />
                  </Form.Item>
                  <Form.Item name="description" label="البيان">
                    <Input placeholder="اختياري" style={{ width: 180 }} />
                  </Form.Item>
                  {/* «بيان السند» كلام الورقة، مش وصف الحركة في القيد اللي فوق. */}
                  <Form.Item name="statement1" label="بيان السند">
                    <Input placeholder="الكلام المكتوب على ورقة السند" style={{ width: 220 }} />
                  </Form.Item>
                  {/* رقم الورقة اللي في إيد المورد — جنب رقم السند عندنا مش بداله. */}
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
