import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Form, Input, Select, Space, Table, Tag, message } from 'antd';
import { AppstoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api/client';
import ListPage from '../components/ListPage';
import { TabModal } from '../components/TabModal';
import { InputNumber } from '../components/NumberInput';
import {
  type Category, METHOD_LABELS, METHOD_OPTIONS, USAGE_LABELS, USAGE_OPTIONS, errMsg, needsLife,
} from '../components/fixedAssets/shared';

export default function FixedAssetCategories() {
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Category | null | 'new'>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const method = Form.useWatch('method', form);

  const load = async () => {
    setLoading(true);
    try { setRows((await api.get('/api/v1/fixed-assets/categories')).data || []); }
    catch (err) { message.error(errMsg(err, 'تعذر تحميل الفئات')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!editing) return;
    form.setFieldsValue(editing === 'new'
      ? { name: '', method: 'straight_line', usage: 'admin', annual_rate: undefined,
        useful_life_months: undefined, prorata: false, auto_confirm: true, active: true }
      : { ...editing, annual_rate: editing.annual_rate != null ? Number(editing.annual_rate) : undefined });
  }, [editing]);

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    const body = { ...v, annual_rate: v.annual_rate != null ? String(v.annual_rate) : null,
      useful_life_months: v.useful_life_months || null };
    try {
      if (editing && editing !== 'new') await api.put(`/api/v1/fixed-assets/categories/${editing.id}`, body);
      else await api.post('/api/v1/fixed-assets/categories', body);
      message.success('تم حفظ الفئة');
      setEditing(null);
      load();
    } catch (err) { message.error(errMsg(err, 'تعذر حفظ الفئة')); } finally { setSaving(false); }
  };

  const columns: ColumnsType<Category> = [
    { title: 'الفئة', dataIndex: 'name', render: (v: string, r) => (
      <Space><b>{v}</b>{!r.active && <Tag>موقوفة</Tag>}</Space>) },
    { title: 'الاستخدام', dataIndex: 'usage', width: 110, render: (v: string) => USAGE_LABELS[v] || v },
    { title: 'طريقة الإهلاك', dataIndex: 'method', width: 170, render: (v: string) => METHOD_LABELS[v] || v },
    { title: 'النسبة السنوية', dataIndex: 'annual_rate', width: 120,
      render: (v: string | null) => (v != null ? `${Number(v)}%` : '-') },
    { title: 'العمر', dataIndex: 'useful_life_months', width: 100, render: (v) => (v ? `${v} شهر` : '-') },
    { title: 'جزء الشهر الأول', dataIndex: 'prorata', width: 120, render: (v: boolean) => (v ? 'بالأيام' : 'شهر كامل') },
    { title: 'من المستندات', dataIndex: 'auto_confirm', width: 130,
      render: (v: boolean) => (v ? <Tag color="green">تأكيد تلقائي</Tag> : <Tag>مسودة</Tag>) },
    { title: 'عدد الأصول', dataIndex: 'asset_count', width: 100, align: 'center' },
  ];

  return (
    <ListPage
      icon={<AppstoreOutlined />}
      title="فئات الأصول"
      actions={(<>
        <Button type="primary" className="sl-create" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          فئة جديدة
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
    >
      <Table<Category> className="sl-table" rowKey="id" size="small" loading={loading}
        dataSource={rows} columns={columns} pagination={false} summary={() => null}
        onRow={(r) => ({ onClick: () => setEditing(r), style: { cursor: 'pointer' } })} />

      <TabModal open={!!editing} onCancel={() => setEditing(null)} onOk={save} confirmLoading={saving}
        title={editing === 'new' ? 'فئة جديدة' : `فئة: ${(editing as Category | null)?.name ?? ''}`}
        okText="حفظ" cancelText="إلغاء" destroyOnHidden width={560}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="اسم الفئة" rules={[{ required: true, message: 'اكتب الاسم' }]}>
            <Input />
          </Form.Item>
          <Space wrap align="start">
            <Form.Item name="usage" label="الاستخدام">
              <Select style={{ width: 230 }} options={USAGE_OPTIONS} />
            </Form.Item>
            <Form.Item name="method" label="طريقة الإهلاك">
              <Select style={{ width: 230 }} options={METHOD_OPTIONS} />
            </Form.Item>
          </Space>
          {method !== 'none' && (
            <Space wrap align="start">
              <Form.Item name="annual_rate" label="النسبة السنوية %">
                <InputNumber min={0} max={100} style={{ width: 150 }} />
              </Form.Item>
              <Form.Item name="useful_life_months" label="العمر الإنتاجي (شهور)"
                rules={[{ required: needsLife(method) && method !== 'straight_line', message: 'حدد العمر' }]}>
                <InputNumber min={1} style={{ width: 150 }} />
              </Form.Item>
            </Space>
          )}
          <Form.Item name="prorata" valuePropName="checked">
            <Checkbox>احتساب جزء الشهر الأول بالأيام</Checkbox>
          </Form.Item>
          <Form.Item name="auto_confirm" valuePropName="checked">
            <Checkbox>تأكيد الأصل تلقائيًا عند شرائه من فاتورة أو سند</Checkbox>
          </Form.Item>
          <Form.Item name="active" valuePropName="checked">
            <Checkbox>فعالة</Checkbox>
          </Form.Item>
        </Form>
      </TabModal>
    </ListPage>
  );
}
