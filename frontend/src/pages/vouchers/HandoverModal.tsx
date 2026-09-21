/**
 * سند توريد مندوب — اتفصل عن `Vouchers.tsx`.
 *
 * الشاشة كانت مكوّن واحد ١٤٧٨ سطر فيه ستة بوبابات فوق بعض. كل بوباب بقى ملف
 * بمدخلاته مكتوبة: اللي بيعدّل سند المصروف مابيفتحش سند القبض قدامه، واللي بيقرا
 * بيشوف الفورم ده محتاج إيه بالظبط بدل ما يدوّر في حالة الشاشة كلها.
 *
 * الحالة بتفضل في الشاشة الأم — الفورم والقايمات والحفظ بيتبعتوا كمدخلات. البوباب
 * مالوش حالة خاصة بيه غير اللي يخصّه هو.
 */
import React from 'react';
import { searchFilter, searchRank } from '../../utils/arabicSort';
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

export default function HandoverModal({
  open, onCancel, form, posting, submit, reps,
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: (url: string, values: any, form: FormInstance, ok: string) => void;
  reps: UserRecord[];
}) {
  return (
      <TabModal
        open={open}
        title="سند توريد مندوب"
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
                    submit('/api/v1/vouchers/handovers', v, form, 'تم تسجيل التوريد ✔')
                  }
                >
                  <Form.Item name="rep_user_id" label="المندوب" rules={[{ required: true, message: 'اختر المندوب' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      style={{ width: 240 }}
                      placeholder="اختر المندوب"
                      options={reps.map((r) => ({ value: r.id, label: r.full_name || r.username }))} filterOption={searchFilter} filterSort={searchRank}/>
                  </Form.Item>
                  {/* (009) المندوب بقى له صندوق لكل خط، والتوريد بيسحب من واحد محدد.
                      فاضي = العهدة القديمة اللي من غير خط — اللي شايلة حركة ما قبل التقسيم. */}
                  <Form.Item name="family" label="من صندوق خط"
                    extra="سيبها فاضية للعهدة القديمة اللي قبل تقسيم الصناديق">
                    <Select
                      allowClear
                      style={{ width: 240 }}
                      placeholder="أبيض / بولي"
                      options={[
                        { value: 'أبيض', label: 'أبيض' },
                        { value: 'بولي', label: 'بولي' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
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
                  {/* «بيان السند» كلام الورقة، مش وصف الحركة في القيد اللي فوق. */}
                  <Form.Item name="statement1" label="بيان السند">
                    <Input placeholder="الكلام المكتوب على ورقة السند" style={{ width: 220 }} />
                  </Form.Item>
                  {/* رقم الورقة اللي في إيد المندوب — جنب رقم السند عندنا مش بداله. */}
                  <Form.Item name="external_document_number" label="رقم المستند">
                    <Input placeholder="رقم السند الورقي" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل التوريد
                    </Button>
                  </Form.Item>
                </Form>
      </TabModal>
  );
}
