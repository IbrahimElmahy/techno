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

export default function TransferModal({
  open, onCancel, form, posting, submit, treasuries,
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: (url: string, values: any, form: FormInstance, ok: string) => void;
  treasuries: any[];
}) {
  return (
      <TabModal
        open={open}
        title="تحويل نقدي بين خزينتين"
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
                    submit('/api/v1/vouchers/transfers', v, form, 'تم تسجيل التحويل ✔')
                  }
                >
                  <Form.Item name="from_treasury_id" label="من" rules={[{ required: true, message: 'اختر الخزينة' }]}>
                    <Select
                      style={{ width: 200 }} showSearch
                      filterOption={searchFilter} filterSort={searchRank}
                      options={treasuries
                        .filter((t) => t.active)
                        .map((t) => ({ value: t.id, label: `${t.name} (${money(t.balance)})` }))}
                    />
                  </Form.Item>
                  <Form.Item name="to_treasury_id" label="إلى" rules={[{ required: true, message: 'اختر الخزينة' }]}>
                    <Select
                      style={{ width: 200 }} showSearch
                      filterOption={searchFilter} filterSort={searchRank}
                      options={treasuries.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))}
                    />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item name="statement1" label="بيان السند">
                    <Input placeholder="النص المكتوب على ورقة السند" style={{ width: 220 }} />
                  </Form.Item>
                  <Form.Item name="external_document_number" label="رقم المستند">
                    <Input placeholder="رقم السند الورقي" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تحويل
                    </Button>
                  </Form.Item>
                </Form>
      </TabModal>
  );
}
