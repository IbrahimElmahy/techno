/**
 * ورقة قبض / دفع — اتفصل عن `Vouchers.tsx`.
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

export default function ChequeModal({
  open, onCancel, form, posting, setPosting, customers, suppliers, onSaved,
  defaultDirection,
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  setPosting: (v: boolean) => void;
  customers: Party[];
  suppliers: Party[];
  onSaved: () => void;
  /** الاتجاه اللي الشاشة اتفتحت عليه من القايمة (`?direction=`). */
  defaultDirection?: string;
}) {
  return (
      <TabModal
        open={open}
        title="ورقة قبض / دفع جديدة"
        okText="تسجيل الشيك" cancelText="إلغاء"
        confirmLoading={posting}
        onCancel={onCancel}
        onOk={() => form.submit()}
        destroyOnHidden
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            setPosting(true);
            try {
              await api.post('/api/v1/cheques', {
                ...v,
                amount: String(v.amount),
                due_date: v.due_date.format('YYYY-MM-DD'),
              });
              message.success('تم تسجيل الشيك ✔');
              form.resetFields();
              onCancel();
              onSaved();
            } catch {
            } finally {
              setPosting(false);
            }
          }}
        >
          <Form.Item name="direction" label="النوع"
            initialValue={defaultDirection || 'incoming'} rules={[{ required: true }]}>
            <Segmented
              block
              options={[
                { value: 'incoming', label: 'وارد من عميل' },
                { value: 'outgoing', label: 'صادر لمورد' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.direction !== b.direction}>
            {({ getFieldValue }) =>
              getFieldValue('direction') === 'outgoing' ? (
                <Form.Item name="supplier_id" label="المورد"
                  rules={[{ required: true, message: 'اختر المورد' }]}>
                  <PartyField kind="supplier" style={{ width: '100%' }}
                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
                </Form.Item>
              ) : (
                <Form.Item name="customer_id" label="العميل"
                  rules={[{ required: true, message: 'اختر العميل' }]}>
                  <PartyField kind="customer" style={{ width: '100%' }}
                    options={customers.map((c) => ({ value: c.id, label: c.name }))} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="cheque_number" label="رقم الشيك"
                rules={[{ required: true, message: 'أدخل الرقم' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank_name" label="البنك">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="amount" label="المبلغ"
                rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} addonAfter="ج.م" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="due_date" label="الاستحقاق"
                rules={[{ required: true, message: 'أدخل التاريخ' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          {/* البيان — كلام الورقة («شيك عن فاتورة ٤٥١»). بيظهر في سجل الشيكات وبيتدوّر فيه. */}
          <Form.Item name="statement1" label="البيان">
            <Input placeholder="اختياري" maxLength={200} />
          </Form.Item>
        </Form>
      </TabModal>
  );
}
