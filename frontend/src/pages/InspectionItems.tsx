import React, { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  InputNumber,
  Input,
  Modal,
  Form,
  Tag,
  Switch,
  Popconfirm,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';

interface ItemType {
  id: number;
  name: string;
  points: string;
  sort_order: number;
  active: boolean;
}

// Points can be fractional (1/6, 1/3 …); trim trailing zeros for display.
const fmtPoints = (v: string) => {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
};

const InspectionItems: React.FC = () => {
  const [rows, setRows] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ItemType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ItemType[]>('/api/v1/inspections/item-types', {
        params: { include_inactive: true },
      });
      setRows(data);
    } catch {
      /* interceptor */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ points: 1 });
    setModalOpen(true);
  };

  const openEdit = (row: ItemType) => {
    setEditing(row);
    form.setFieldsValue({ name: row.name, points: Number(row.points) });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/v1/inspections/item-types/${editing.id}`, {
          name: values.name,
          points: String(values.points),
        });
        message.success('تم حفظ التعديل ✔');
      } else {
        await api.post('/api/v1/inspections/item-types', {
          name: values.name,
          points: String(values.points),
        });
        message.success('تمت إضافة الصنف ✔');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      if (e?.response) message.error(e.response.data?.detail?.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: ItemType, active: boolean) => {
    try {
      await api.patch(`/api/v1/inspections/item-types/${row.id}`, { active });
      message.success(active ? 'تم التفعيل' : 'تم الإيقاف');
      load();
    } catch {
      /* interceptor */
    }
  };

  const deactivate = async (row: ItemType) => {
    try {
      await api.delete(`/api/v1/inspections/item-types/${row.id}`);
      message.success('تم إيقاف الصنف — هيختفي من التطبيق');
      load();
    } catch {
      /* interceptor */
    }
  };

  const visible = showInactive ? rows : rows.filter((r) => r.active);

  return (
    <div>
      <Card
        title="أصناف المعاينة وقيمة النقاط"
        extra={
          <Space>
            <Space size={4}>
              <Switch checked={showInactive} onChange={setShowInactive} size="small" />
              <span>عرض الموقوفة</span>
            </Space>
            <Button icon={<ReloadOutlined />} onClick={load}>
              تحديث
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
              إضافة صنف
            </Button>
          </Space>
        }
      >
        <p style={{ color: '#8a9aa6', marginTop: -8 }}>
          دي الأصناف اللي بتظهر في تطبيق المعاينات — أي تعديل هنا بيوصل للمناديب مع أول
          «تحديث الأصناف والقوائم» من التطبيق.
        </p>
        <Table<ItemType>
          rowKey="id"
          loading={loading}
          dataSource={visible}
          pagination={{ pageSize: 50, showTotal: (t) => `إجمالي ${t}` }}
          columns={[
            { title: '#', width: 60, render: (_: any, __: any, i: number) => i + 1 },
            { title: 'اسم الصنف', dataIndex: 'name' },
            {
              title: 'النقاط',
              dataIndex: 'points',
              width: 120,
              align: 'center' as const,
              render: (v: string) => <b>{fmtPoints(v)}</b>,
            },
            {
              title: 'الحالة',
              dataIndex: 'active',
              width: 110,
              align: 'center' as const,
              render: (active: boolean, row: ItemType) => (
                <Switch
                  checked={active}
                  size="small"
                  onChange={(v) => toggleActive(row, v)}
                  checkedChildren="نشط"
                  unCheckedChildren="موقوف"
                />
              ),
            },
            {
              title: '',
              width: 170,
              render: (_: any, row: ItemType) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                    تعديل
                  </Button>
                  {row.active && (
                    <Popconfirm
                      title="إيقاف الصنف؟"
                      description="هيختفي من التطبيق، والمعاينات القديمة تفضل زي ما هي."
                      okText="إيقاف"
                      cancelText="إلغاء"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => deactivate(row)}
                    >
                      <Button size="small" danger icon={<StopOutlined />}>
                        إيقاف
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? 'تعديل صنف المعاينة' : 'إضافة صنف معاينة'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText="حفظ"
        cancelText="إلغاء"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="اسم الصنف"
            rules={[{ required: true, message: 'اكتب اسم الصنف' }]}
          >
            <Input placeholder="مثال: بطاريه 50×32" />
          </Form.Item>
          <Form.Item
            name="points"
            label="قيمة النقاط للوحدة"
            rules={[{ required: true, message: 'أدخل النقاط' }]}
            extra="بتقبل الكسور (مثال 0.1667 لصنف كل 6 قطع بنقطة)"
          >
            <InputNumber min={0} step={0.0001} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default InspectionItems;
