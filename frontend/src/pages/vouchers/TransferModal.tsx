import React, { useEffect, useState } from 'react';
import { Button, Col, DatePicker, Form, Input, Row, Select, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import type { FormInstance } from 'antd';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import { InputNumber } from '../../components/NumberInput';
import { TabModal } from '../../components/TabModal';
import { api } from '../../api/client';
import { money } from './types';

export interface CashBox {
  key: string; kind: 'cash' | 'bank' | 'safe'; name: string; branch_id: number | null;
  rep_name: string | null; family: string | null; active: boolean; balance: string;
}

export const BOX_KIND: Record<string, { label: string; color: string }> = {
  cash: { label: 'خزينة', color: 'default' },
  bank: { label: 'بنك', color: 'blue' },
  safe: { label: 'صندوق مندوب', color: 'purple' },
};

const boxOptions = (boxes: CashBox[], exclude?: string) => (['cash', 'bank', 'safe'] as const)
  .map((k) => ({
    label: k === 'safe' ? 'صناديق المناديب' : k === 'bank' ? 'البنوك' : 'الخزائن',
    options: boxes.filter((b) => b.kind === k && b.key !== exclude).map((b) => ({
      value: b.key,
      label: `${b.name}${b.family ? ` — ${b.family}` : ''} (${money(b.balance)})`,
    })),
  }))
  .filter((g) => g.options.length);

export default function TransferModal({
  open, onCancel, form, posting, submit, presetFrom,
}: {
  open: boolean;
  onCancel: () => void;
  form: FormInstance;
  posting: boolean;
  submit: (url: string, values: any, form: FormInstance, ok: string) => void;
  treasuries?: any[];
  presetFrom?: string;
}) {
  const [boxes, setBoxes] = useState<CashBox[]>([]);
  const fromKey = Form.useWatch('from_key', form);
  const toKey = Form.useWatch('to_key', form);

  useEffect(() => {
    if (!open) return;
    api.get<CashBox[]>('/api/v1/cash-boxes').then((r) => {
      setBoxes(r.data || []);
      if (presetFrom) {
        const b = (r.data || []).find((x) => x.key === presetFrom);
        form.setFieldsValue({ from_key: presetFrom, amount: b && Number(b.balance) > 0 ? Number(b.balance) : undefined });
      }
    }).catch(() => setBoxes([]));
  }, [open, presetFrom]);

  const from = boxes.find((b) => b.key === fromKey);
  const to = boxes.find((b) => b.key === toKey);
  const active = boxes.filter((b) => b.active);

  return (
    <TabModal
      open={open}
      title="تحويل نقدي"
      okText="تسجيل التحويل" cancelText="إلغاء"
      confirmLoading={posting}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden width={640}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => submit('/api/v1/vouchers/transfers', v, form, 'تم تسجيل التحويل')}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="from_key" label="من" rules={[{ required: true, message: 'اختر الخزينة أو الصندوق' }]}>
              <Select showSearch filterOption={searchFilter} filterSort={searchRank}
                options={boxOptions(boxes.filter((b) => b.active || Number(b.balance) !== 0), toKey)}
                onChange={(k) => {
                  const b = boxes.find((x) => x.key === k);
                  if (b && b.kind === 'safe' && Number(b.balance) > 0) form.setFieldsValue({ amount: Number(b.balance) });
                }} />
            </Form.Item>
            {from ? (
              <Space size={6} style={{ marginTop: -16, marginBottom: 12 }}>
                <Tag color={BOX_KIND[from.kind].color}>{BOX_KIND[from.kind].label}</Tag>
                <span>الرصيد: <b>{money(from.balance)}</b></span>
              </Space>
            ) : null}
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="to_key" label="إلى" rules={[{ required: true, message: 'اختر الخزينة أو الصندوق' }]}>
              <Select showSearch filterOption={searchFilter} filterSort={searchRank}
                options={boxOptions(active, fromKey)} />
            </Form.Item>
            {to ? (
              <Space size={6} style={{ marginTop: -16, marginBottom: 12 }}>
                <Tag color={BOX_KIND[to.kind].color}>{BOX_KIND[to.kind].label}</Tag>
                <span>الرصيد: <b>{money(to.balance)}</b></span>
              </Space>
            ) : null}
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="المبلغ" required>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="amount" noStyle rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                  <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
                <Button disabled={!from || Number(from.balance) <= 0}
                  onClick={() => from && form.setFieldsValue({ amount: Number(from.balance) })}>
                  الرصيد كله
                </Button>
              </Space.Compact>
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="statement1" label="بيان السند">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="external_document_number" label="رقم المستند">
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </TabModal>
  );
}
