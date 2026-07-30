import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts } from '../components/keyboard';

/**
 * فئات الاصناف — the item categories, on a screen of their own.
 *
 * They were already editable, buried in the settings screen among every other dropdown list in the
 * system. That is where they belong technically — a category is a lookup value like any other — and
 * it is the wrong place for the person who needs them: in the system this client is migrating from,
 * فئات الاصناف is the first entry of the first menu section, because it is the thing you set up
 * before you can enter a single item.
 *
 * So the same lookup gets its own door. Nothing is duplicated: this reads and writes the very same
 * `item_category` list the settings screen shows, and a change made in either place is the same
 * change. What differs is only that someone looking for categories finds them where they expect.
 */

interface Category {
  id: number;
  value: string;
  label: string;
  description: string | null;
  active: boolean;
  sort_order: number;
}

export default function Categories() {
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const searchRef = React.useRef<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/settings/lookups', {
        params: { category: 'item_category' },
      });
      setRows(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filter = useListFilter(rows, {
    search: (c) => [c.label, c.value, c.description || ''],
    filters: { active: (c, v) => c.active === (v === 'active') },
  });

  const openCreate = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const openEdit = (row: Category) => {
    setEditing(row);
    form.setFieldsValue({ label: row.label, description: row.description });
    setOpen(true);
  };

  const submit = async (values: any) => {
    try {
      if (editing) {
        await api.patch(`/api/v1/settings/lookups/${editing.id}`, {
          label: values.label, description: values.description || null,
        });
        message.success('اتحفظت الفئة');
      } else {
        await api.post('/api/v1/settings/lookups', {
          category: 'item_category',
          // The stored value is what documents point at; it is derived from the name so nobody has
          // to invent a code, and it never changes afterwards even if the name is corrected.
          value: values.label.trim().replace(/\s+/g, '_').slice(0, 40),
          label: values.label,
          description: values.description || null,
        });
        message.success('اتضافت الفئة');
      }
      setOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    }
  };

  const remove = async (row: Category) => {
    try {
      await api.delete(`/api/v1/settings/lookups/${row.id}`);
      message.success('اتشالت الفئة');
      load();
    } catch (err: any) {
      // A category in use cannot be removed — the items pointing at it would lose their name.
      message.error(err?.response?.data?.detail?.message || 'تعذر الحذف');
    }
  };

  // F2 adds, F3 finds, F9 saves, Esc closes — the same four everywhere, so the hand learns them
  // once instead of per screen.
  useScreenShortcuts({
    onNew: openCreate,
    onSearch: () => searchRef.current?.focus(),
    onSave: open ? () => form.submit() : undefined,
    onClose: open ? () => setOpen(false) : undefined,
  });

  return (
    <Card
      title="فئات الاصناف"
      extra={(
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>فئة جديدة</Button>
          <Button icon={<ReloadOutlined />} onClick={load} />
        </Space>
      )}
    >
      <ListToolbar
        searchPlaceholder="بحث باسم الفئة"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={rows.length} shown={filter.filtered.length}
        filters={[{ key: 'active', placeholder: 'الحالة', options: [
          { value: 'active', label: 'ظاهرة' }, { value: 'inactive', label: 'مخفية' },
        ] }]}
      />

      <Table<Category>
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        locale={{ emptyText: 'لا توجد فئات' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'رقم', dataIndex: 'id', width: 80, render: (v: number) => <Tag>{v}</Tag> },
          { title: 'الاسم', dataIndex: 'label' },
          { title: 'وصف', dataIndex: 'description', render: (v: string) => v || '-' },
          { title: 'الحالة', dataIndex: 'active', width: 110,
            render: (a: boolean) => (a ? <Tag color="green">ظاهرة</Tag> : <Tag>مخفية</Tag>) },
          { title: 'إجراء', key: 'act', width: 160,
            render: (_: unknown, row: Category) => (
              <Space>
                <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>تعديل</Button>
                <Popconfirm title="تشيل الفئة دي؟" okText="أيوه" cancelText="لأ"
                  onConfirm={() => remove(row)}>
                  <Button type="link" danger icon={<DeleteOutlined />}>حذف</Button>
                </Popconfirm>
              </Space>
            ) },
        ]}
      />

      <Modal
        open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden
        title={editing ? 'تعديل فئة' : 'فئة جديدة'} width={420}
      >
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item name="label" label="اسم الفئة" rules={[{ required: true, message: 'اكتب الاسم' }]}>
            <Input placeholder="مثال: مواسير PVC" />
          </Form.Item>
          <Form.Item name="description" label="وصف">
            <Input.TextArea rows={2} maxLength={240} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>حفظ</Button>
        </Form>
      </Modal>
    </Card>
  );
}
