import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Button, Space, Input, Form, Tag, Switch, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import { PlusOutlined, EditOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { TabModal } from '../components/TabModal';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';

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

  const filter = useListFilter(visible, {
    search: (r) => [r.name, r.points],
    filters: {
      active: (r, v) => r.active === (v === 'active'),
      has_points: (r, v) => (Number(r.points) > 0) === (v === 'yes'),
    },
  });

  // السطر يفتح التعديل — البيانات الأساسية مافيهاش «عرض» غير الفورم بتاعها نفسه.
  const kb = useTableKeyboard<ItemType>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  const columns: ColumnsType<ItemType> = [
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
              description="سيختفي من التطبيق، وتبقى المعاينات القديمة كما هي."
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
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('inspection-items', columns);

  return (
    <div>
      <Card
        title="أصناف المعاينة وقيمة النقاط"
        extra={
          <Space>
            {tableCols.control}
            <Space size={4}>
              <Switch checked={showInactive} onChange={setShowInactive} size="small" />
              <span>عرض الموقوفة</span>
            </Space>
            <Button icon={<ReloadOutlined />} onClick={load}>
              تحديث
            </Button>
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={openNew}>
              إضافة صنف
            </Button>
          </Space>
        }
      >
        <p style={{ color: '#8a9aa6', marginTop: -8 }}>
          دي الأصناف اللي بتظهر في تطبيق المعاينات — أي تعديل هنا بيوصل للمناديب مع أول
          «تحديث الأصناف والقوائم» من التطبيق.
        </p>
        <ListToolbar
          searchPlaceholder="بحث باسم الصنف"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          onReset={filter.reset}
          total={visible.length} shown={filter.filtered.length}
          filters={[
            { key: 'active', placeholder: 'الحالة',
              options: [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'موقوف' }] },
            { key: 'has_points', placeholder: 'قيمة النقاط',
              options: [{ value: 'yes', label: 'له نقاط' }, { value: 'no', label: 'بدون نقاط' }] },
          ]}
        />
        <Table<ItemType>
          {...kb.tableProps}
          rowKey="id"
          loading={loading}
          dataSource={filter.filtered}
          pagination={{ defaultPageSize: 50, showTotal: (t) => `إجمالي ${t}` }}
          columns={tableCols.columns}
        />
      </Card>

      <TabModal
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
      </TabModal>
    </div>
  );
};

export default InspectionItems;
