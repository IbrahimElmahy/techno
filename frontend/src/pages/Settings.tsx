import React, { useEffect, useState } from 'react';
import {
  Card, Collapse, Table, Button, Input, InputNumber, Switch, Space, Tag, message, Popconfirm,
  Modal, Form, Tooltip,
} from 'antd';
import { PlusOutlined, DeleteOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons';
import { api } from '../api/client';

interface CategoryMeta { category: string; label: string; system: boolean; }
interface PageGroup { page: string; page_label: string; categories: CategoryMeta[]; }
interface Option {
  id: number; category: string; value: string; label: string;
  sort_order: number; active: boolean; is_system: boolean;
}

export default function Settings() {
  const [pages, setPages] = useState<PageGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await api.post('/api/v1/admin/demo-seed');
      if (res.data?.status === 'already_seeded') {
        message.info('البيانات التجريبية موجودة بالفعل');
      } else {
        message.success('تم تحميل بيانات تجريبية كاملة للاختبار');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSeeding(false);
    }
  };

  const loadCategories = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/settings/lookups/categories');
      setPages(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCategories(); }, []);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Card title="بيانات تجريبية للاختبار" size="small">
        <Space wrap>
          <span style={{ color: '#888' }}>
            تحميل داتا كاملة للشركة (خامات، منتجات، وصفات بموارد، موردين، عملاء، مشتريات،
            أوامر تصنيع، هوالك، مبيعات) لتجربة كل النظام. آمن — لا يُكرّر لو اتحمّل قبل كده.
          </span>
          <Popconfirm
            title="تحميل بيانات تجريبية كاملة؟"
            okText="تحميل" cancelText="إلغاء" onConfirm={handleSeed}
          >
            <Button type="primary" loading={seeding}>تحميل بيانات تجريبية</Button>
          </Popconfirm>
        </Space>
      </Card>

    <Card title="إعدادات القوائم المنسدلة" loading={loading}>
      <p style={{ color: '#888', marginBottom: 16 }}>
        تحكّم في خيارات القوائم المنسدلة في كل صفحة. القوائم المربوطة بمنطق النظام{' '}
        <Tag icon={<LockOutlined />} color="gold">مقيّدة</Tag>{' '}
        — تقدر تعيد تسميتها وترتيبها وإخفاءها، لكن ما تقدرش تضيف/تحذف قيمها.
      </p>
      <Collapse
        accordion
        items={pages.map((pg) => ({
          key: pg.page,
          label: <strong>{pg.page_label}</strong>,
          children: (
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              {pg.categories.map((cat) => (
                <CategoryEditor key={cat.category} meta={cat} />
              ))}
            </Space>
          ),
        }))}
      />
    </Card>
    </Space>
  );
}

function CategoryEditor({ meta }: { meta: CategoryMeta }) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/settings/lookups', { params: { category: meta.category } });
      setOptions(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [meta.category]);

  const saveOption = async (opt: Option, patch: Partial<Option>) => {
    try {
      await api.patch(`/api/v1/settings/lookups/${opt.id}`, patch);
      setOptions((prev) => prev.map((o) => (o.id === opt.id ? { ...o, ...patch } : o)));
    } catch (err) {
      console.error(err);
    }
  };

  const removeOption = async (opt: Option) => {
    try {
      await api.delete(`/api/v1/settings/lookups/${opt.id}`);
      message.success('تم حذف الخيار');
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const addOption = async (values: any) => {
    try {
      await api.post('/api/v1/settings/lookups', {
        category: meta.category, value: values.value, label: values.label,
      });
      message.success('تمت إضافة الخيار');
      setAddOpen(false);
      addForm.resetFields();
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    {
      title: 'القيمة (كود)', dataIndex: 'value', width: 160,
      render: (v: string, r: Option) =>
        r.is_system ? <Tag icon={<LockOutlined />}>{v}</Tag> : <code>{v}</code>,
    },
    {
      title: 'الاسم المعروض', dataIndex: 'label',
      render: (_: string, r: Option) => (
        <EditableLabel value={r.label} onSave={(label) => saveOption(r, { label })} />
      ),
    },
    {
      title: 'الترتيب', dataIndex: 'sort_order', width: 110,
      render: (_: number, r: Option) => (
        <InputNumber size="small" defaultValue={r.sort_order} style={{ width: 80 }}
          onBlur={(e) => {
            const val = Number((e.target as HTMLInputElement).value);
            if (val !== r.sort_order) saveOption(r, { sort_order: val });
          }} />
      ),
    },
    {
      title: 'ظاهر', dataIndex: 'active', width: 90,
      render: (_: boolean, r: Option) => (
        <Switch size="small" checked={r.active} checkedChildren="ظاهر" unCheckedChildren="مخفي"
          onChange={(active) => saveOption(r, { active })} />
      ),
    },
    {
      title: '', width: 60,
      render: (_: any, r: Option) =>
        r.is_system ? (
          <Tooltip title="خيار نظام — يُخفى ولا يُحذف"><LockOutlined style={{ color: '#ccc' }} /></Tooltip>
        ) : (
          <Popconfirm title="حذف الخيار؟" okText="نعم" cancelText="لا" onConfirm={() => removeOption(r)}>
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ),
    },
  ];

  return (
    <Card
      size="small"
      title={<span>{meta.label} {meta.system && <Tag icon={<LockOutlined />} color="gold">مقيّدة</Tag>}</span>}
      extra={!meta.system && (
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          إضافة خيار
        </Button>
      )}
    >
      <Table size="small" rowKey="id" loading={loading} dataSource={options} columns={columns}
        pagination={false} />

      <Modal title={`إضافة خيار إلى: ${meta.label}`} open={addOpen} onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()} okText="إضافة" cancelText="إلغاء" destroyOnHidden>
        <Form form={addForm} layout="vertical" onFinish={addOption}>
          <Form.Item name="label" label="الاسم المعروض"
            rules={[{ required: true, message: 'أدخل الاسم' }]}>
            <Input placeholder="مثال: نصف جملة كبار" />
          </Form.Item>
          <Form.Item name="value" label="القيمة (كود يُخزَّن)"
            rules={[{ required: true, message: 'أدخل القيمة' }]}
            tooltip="الكود اللي بيتخزن في قاعدة البيانات — إنجليزي/بدون مسافات يُفضّل">
            <Input placeholder="مثال: wholesale_vip" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function EditableLabel({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);
  const dirty = val !== value;
  return (
    <Space.Compact style={{ width: '100%', maxWidth: 320 }}>
      <Input value={val} onChange={(e) => setVal(e.target.value)}
        onPressEnter={() => dirty && onSave(val)} />
      <Button icon={<SaveOutlined />} type={dirty ? 'primary' : 'default'} disabled={!dirty}
        onClick={() => onSave(val)} />
    </Space.Compact>
  );
}
