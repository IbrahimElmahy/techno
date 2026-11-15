import React, { useEffect, useState } from 'react';
import {
  Alert, Button, DatePicker, Descriptions, Form, Input, Radio, Select, Space, Table, Tag, message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../../api/client';
import { InputNumber } from '../NumberInput';
import { TabModal } from '../TabModal';
import { money } from '../../utils/money';
import { searchFilter } from '../../utils/arabicSort';
import {
  type Asset, METHOD_OPTIONS, USAGE_LABELS, errMsg, needsLife,
} from './shared';

export function RunDepreciationModal({ open, onClose, onDone, branchName }: {
  open: boolean; onClose: () => void; onDone: () => void;
  branchName: (id: number | null) => string;
}) {
  const [period, setPeriod] = useState<Dayjs>(dayjs());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [mode, setMode] = useState<'run' | 'reverse'>('run');

  useEffect(() => {
    if (!open || mode !== 'run') return;
    setLoading(true);
    api.get('/api/v1/fixed-assets/depreciation/preview', {
      params: { year: period.year(), month: period.month() + 1 },
    }).then((r) => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [open, period, mode]);

  const run = async () => {
    setPosting(true);
    try {
      if (mode === 'run') {
        const r = await api.post('/api/v1/fixed-assets/depreciation/run', {
          year: period.year(), month: period.month() + 1,
        });
        message.success(`تم ترحيل ${r.data.lines} قسط بإجمالي ${money(r.data.total)}`);
      } else {
        await api.post('/api/v1/fixed-assets/depreciation/reverse', {
          year: period.year(), month: period.month() + 1,
        });
        message.success('تم عكس إهلاك الشهر');
      }
      onDone();
      onClose();
    } catch (err) {
      message.error(errMsg(err, 'تعذر تنفيذ العملية'));
    } finally { setPosting(false); }
  };

  return (
    <TabModal open={open} onCancel={onClose} width={880} destroyOnHidden
      title="ترحيل الإهلاك"
      footer={(
        <Space>
          <Button onClick={onClose}>إلغاء</Button>
          <Button type="primary" danger={mode === 'reverse'} loading={posting}
            disabled={mode === 'run' && !(data?.rows?.length)} onClick={run}>
            {mode === 'run' ? 'ترحيل' : 'عكس إهلاك الشهر'}
          </Button>
        </Space>
      )}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" buttonStyle="solid" value={mode}
          onChange={(e) => setMode(e.target.value)}
          options={[{ value: 'run', label: 'ترحيل حتى شهر' }, { value: 'reverse', label: 'عكس شهر' }]} />
        <DatePicker picker="month" value={period} allowClear={false}
          onChange={(v) => v && setPeriod(v)} />
      </Space>
      {mode === 'run' ? (
        <>
          <Table size="small" rowKey="id" loading={loading} dataSource={data?.rows || []}
            pagination={false} scroll={{ y: 360 }}
            locale={{ emptyText: 'لا يوجد إهلاك مستحق حتى هذا الشهر' }}
            columns={[
              { title: 'الأصل', render: (_: any, r: any) => <span><Tag>{r.code}</Tag>{r.name}</span> },
              { title: 'الفئة', dataIndex: 'category', width: 130 },
              { title: 'الاستخدام', dataIndex: 'usage', width: 90, render: (v: string) => USAGE_LABELS[v] || v },
              { title: 'الفرع', dataIndex: 'branch_id', width: 100, render: (v: number | null) => branchName(v) },
              { title: 'الشهور', key: 'm', width: 150,
                render: (_: any, r: any) => (r.months > 1 ? `${r.months} (${r.first} ← ${r.last})` : r.first) },
              { title: 'القيمة', dataIndex: 'amount', width: 120, align: 'left' as const,
                render: (v: string) => <b>{money(v)}</b> },
            ]}
            summary={() => (data?.rows?.length ? (
              <Table.Summary.Row style={{ fontWeight: 700 }}>
                <Table.Summary.Cell index={0} colSpan={5}>
                  الإجمالي ({data.assets} أصل · {data.months} قسط)
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="left">{money(data.total)}</Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null)} />
        </>
      ) : (
        <Alert type="warning" showIcon
          message={`سيتم عكس قيود إهلاك شهر ${period.format('YYYY-MM')} لكل الأصول، ويعود الشهر متاحًا للترحيل.`} />
      )}
    </TabModal>
  );
}

export function ModifyModal({ asset, open, onClose, onDone, remaining }: {
  asset: Asset; open: boolean; onClose: () => void; onDone: (a: Asset) => void;
  remaining: number | null;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const method = Form.useWatch('method', form);
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        method: asset.method, remaining_months: remaining || undefined,
        annual_rate: asset.annual_rate != null ? Number(asset.annual_rate) : undefined,
        salvage_value: Number(asset.salvage_value) || 0, reason: '',
      });
    }
  }, [open]);
  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const r = await api.post(`/api/v1/fixed-assets/${asset.id}/modify`, {
        ...v, annual_rate: v.annual_rate != null ? String(v.annual_rate) : null,
        salvage_value: String(v.salvage_value || 0),
      });
      message.success('تم تعديل الإهلاك');
      onDone(r.data);
      onClose();
    } catch (err) { message.error(errMsg(err, 'تعذر تعديل الإهلاك')); } finally { setSaving(false); }
  };
  return (
    <TabModal open={open} onCancel={onClose} onOk={save} confirmLoading={saving} destroyOnHidden
      title={`تعديل الإهلاك — ${asset.name}`} okText="تطبيق" cancelText="إلغاء" width={560}>
      <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="القيمة الدفترية">{money(asset.book_value)}</Descriptions.Item>
        <Descriptions.Item label="الشهور الباقية">{remaining ?? '-'}</Descriptions.Item>
      </Descriptions>
      <Form form={form} layout="vertical">
        <Form.Item name="method" label="طريقة الإهلاك" rules={[{ required: true }]}>
          <Select options={METHOD_OPTIONS} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="remaining_months" label="الشهور الباقية"
            rules={[{ required: needsLife(method), message: 'حدد الشهور الباقية' }]}>
            <InputNumber min={1} style={{ width: 150 }} />
          </Form.Item>
          {(method === 'declining_balance' || method === 'declining_then_linear') && (
            <Form.Item name="annual_rate" label="النسبة السنوية %">
              <InputNumber min={0} max={100} style={{ width: 150 }} />
            </Form.Item>
          )}
          <Form.Item name="salvage_value" label="القيمة التخريدية">
            <InputNumber min={0} style={{ width: 150 }} />
          </Form.Item>
        </Space>
        <Form.Item name="reason" label="سبب التعديل" rules={[{ required: true, message: 'اكتب السبب' }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </TabModal>
  );
}

export function RevalueModal({ asset, open, onClose, onDone }: {
  asset: Asset; open: boolean; onClose: () => void; onDone: (a: Asset) => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const kind = Form.useWatch('kind', form);
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ kind: 'increase', event_date: dayjs(), amount: undefined, reason: '' });
    if (!accounts.length) {
      api.get('/api/v1/accounts', { params: { postable_only: true, active: true } })
        .then((r) => setAccounts(r.data || [])).catch(() => {});
    }
  }, [open]);
  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const r = await api.post(`/api/v1/fixed-assets/${asset.id}/revalue`, {
        ...v, amount: String(v.amount), event_date: v.event_date.format('YYYY-MM-DD'),
      });
      message.success('تم تسجيل إعادة التقييم');
      onDone(r.data);
      onClose();
    } catch (err) { message.error(errMsg(err, 'تعذر إعادة التقييم')); } finally { setSaving(false); }
  };
  return (
    <TabModal open={open} onCancel={onClose} onOk={save} confirmLoading={saving} destroyOnHidden
      title={`إعادة تقييم — ${asset.name}`} okText="ترحيل" cancelText="إلغاء" width={560}>
      <Form form={form} layout="vertical">
        <Form.Item name="kind">
          <Radio.Group optionType="button" buttonStyle="solid" options={[
            { value: 'increase', label: 'زيادة القيمة (تحسينات)' },
            { value: 'decrease', label: 'تخفيض القيمة (هبوط)' }]} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'اكتب المبلغ' }]}>
            <InputNumber min={0} style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="event_date" label="التاريخ" rules={[{ required: true }]}>
            <DatePicker allowClear={false} />
          </Form.Item>
        </Space>
        {kind === 'increase' && (
          <Form.Item name="counter_account_id" label="الحساب الدائن (المورد أو الخزينة أو غيرهما)"
            rules={[{ required: true, message: 'اختر الحساب' }]}>
            <Select showSearch filterOption={searchFilter} placeholder="اختر الحساب"
              options={accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))} />
          </Form.Item>
        )}
        <Form.Item name="reason" label="السبب" rules={[{ required: true, message: 'اكتب السبب' }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </TabModal>
  );
}

export function DisposeModal({ asset, open, onClose, onDone, dueCount }: {
  asset: Asset; open: boolean; onClose: () => void; onDone: (a: Asset) => void; dueCount: number;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const action = Form.useWatch('action', form);
  const proceeds = Number(Form.useWatch('proceeds', form) || 0);
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ action: 'sell', disposal_date: dayjs(), proceeds: undefined, reason: '' });
    if (!treasuries.length) {
      api.get('/api/v1/treasuries').then((r) => setTreasuries(r.data || [])).catch(() => {});
    }
  }, [open]);
  const book = Number(asset.book_value) || 0;
  const result = (action === 'sell' ? proceeds : 0) - book;
  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const r = await api.post(`/api/v1/fixed-assets/${asset.id}/dispose`, {
        disposal_date: v.disposal_date.format('YYYY-MM-DD'),
        proceeds: v.action === 'sell' ? String(v.proceeds || 0) : '0',
        cash_account_id: v.action === 'sell' ? v.cash_account_id : null,
        reason: v.reason || null,
      });
      message.success('تم ترحيل قيد البيع أو الاستبعاد');
      onDone(r.data);
      onClose();
    } catch (err) { message.error(errMsg(err, 'تعذر استبعاد الأصل')); } finally { setSaving(false); }
  };
  return (
    <TabModal open={open} onCancel={onClose} onOk={save} confirmLoading={saving} destroyOnHidden
      title={`بيع أو استبعاد — ${asset.name}`} okText="ترحيل" okButtonProps={{ danger: true }}
      cancelText="إلغاء" width={560}>
      {dueCount > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message={`يوجد ${dueCount} قسط إهلاك مستحق لم يُرحَّل — رحّله أولاً ليكون الربح أو الخسارة صحيحًا.`} />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="action">
          <Radio.Group optionType="button" buttonStyle="solid" options={[
            { value: 'sell', label: 'بيع' }, { value: 'scrap', label: 'استبعاد (تكهين)' }]} />
        </Form.Item>
        <Form.Item name="disposal_date" label="التاريخ" rules={[{ required: true }]}>
          <DatePicker allowClear={false} />
        </Form.Item>
        {action === 'sell' && (
          <Space wrap>
            <Form.Item name="proceeds" label="ثمن البيع" rules={[{ required: true, message: 'اكتب الثمن' }]}>
              <InputNumber min={0} style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="cash_account_id" label="الخزينة" rules={[{ required: true, message: 'اختر الخزينة' }]}>
              <Select style={{ width: 220 }} placeholder="اختر الخزينة"
                options={treasuries.map((t) => ({ value: t.account_id, label: t.name }))} />
            </Form.Item>
          </Space>
        )}
        <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
          <Descriptions.Item label="التكلفة">{money(asset.cost)}</Descriptions.Item>
          <Descriptions.Item label="مجمع الإهلاك">{money(asset.accumulated_depreciation)}</Descriptions.Item>
          <Descriptions.Item label="القيمة الدفترية">{money(book)}</Descriptions.Item>
          <Descriptions.Item label={result >= 0 ? 'ربح' : 'خسارة'}>
            <b style={{ color: result >= 0 ? '#16a34a' : '#dc2626' }}>{money(Math.abs(result))}</b>
          </Descriptions.Item>
        </Descriptions>
        <Form.Item name="reason" label="ملاحظات">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </TabModal>
  );
}

export function ReasonModal({ open, title, onClose, onOk }: {
  open: boolean; title: string; onClose: () => void; onOk: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <TabModal open={open} title={title} onCancel={onClose} okText="تأكيد" cancelText="إلغاء"
      confirmLoading={saving} destroyOnHidden
      onOk={async () => { setSaving(true); try { await onOk(reason); } finally { setSaving(false); } }}>
      <Input.TextArea rows={3} placeholder="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
    </TabModal>
  );
}
