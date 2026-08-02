import React, { useEffect, useState } from 'react';
import {
  Button, Card, Descriptions, Dropdown, Form, Input, Modal, Popconfirm, Space, Table, Tooltip,
  message,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, PrinterOutlined,
  EyeOutlined, DownOutlined, CloseCircleOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
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
  const [viewing, setViewing] = useState<Category | null>(null);

  /**
   * «المزيد» — the same four entries their screen offers.
   *
   * Export and the two templates are produced here, from what is already on screen: a CSV with a
   * BOM so Excel opens Arabic correctly rather than as mojibake, which is the whole difference
   * between a file somebody uses and a file somebody reports as broken.
   *
   * Import is not offered yet. It needs an endpoint that validates a whole sheet and refuses it as
   * a unit — a half-applied import of two hundred categories is worse than no import, because
   * nobody can tell which half landed.
   */
  const csv = (name: string, rows: (string | number)[][]) => {
    const body = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
    // The BOM matters: without it Excel opens Arabic as mojibake, which is the whole difference
    // between a file someone uses and a file someone reports as broken.
    const blob = new Blob(['﻿' + body.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const moreMenu = [
    {
      key: 'export',
      label: 'تصدير',
      onClick: () => csv('categories.csv', [
        ['رقم', 'الاسم', 'مخفي', 'وصف'],
        ...rows.map((r) => [r.id, r.label, r.active ? '' : 'نعم', r.description || '']),
      ]),
    },
    {
      key: 'tpl-create',
      label: 'تنزيل قالب الإنشاء',
      onClick: () => csv('categories-create-template.csv', [['الاسم', 'وصف']]),
    },
    {
      key: 'tpl-update',
      label: 'تنزيل قالب التحديث',
      onClick: () => csv('categories-update-template.csv', [
        ['رقم', 'الاسم', 'وصف'],
        ...rows.map((r) => [r.id, r.label, r.description || '']),
      ]),
    },
  ];

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
      // Their page is titled «الفئات» while the menu entry reads «فئات الاصناف». Both are kept as
      // they are: the menu is how you find it, the title is what it calls itself, and changing
      // either to match the other would be us tidying up someone else's vocabulary.
      title="الفئات"
      extra={(
        <Space>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={openCreate} />
          <Button type="primary" onClick={load}>اعادة تحميل</Button>
          <Dropdown menu={{ items: moreMenu }}>
            <Button>المزيد <DownOutlined /></Button>
          </Dropdown>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()} />
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
        // Their column order exactly: رقم · الاسم · مخفي · وصف, then the row's three icons.
        columns={[
          { title: 'رقم', dataIndex: 'id', width: 70, align: 'center' as const },
          { title: 'الاسم', dataIndex: 'label' },
          // They show hidden-ness rather than active-ness, as an icon. Same fact, their way round —
          // and worth matching, because a column that means the opposite of what someone expects is
          // read wrong at a glance long before anyone notices the label changed.
          { title: 'مخفي', dataIndex: 'active', width: 90, align: 'center' as const,
            render: (a: boolean) => (a
              ? <CloseCircleOutlined style={{ color: '#cf1322' }} />
              : <CheckCircleOutlined style={{ color: '#6AB42D' }} />) },
          { title: 'وصف', dataIndex: 'description', render: (v: string) => v || '' },
          { title: '', key: 'act', width: 110, align: 'center' as const,
            render: (_: unknown, row: Category) => (
              <Space size={4}>
                <Popconfirm title="تشيل الفئة دي؟" okText="أيوه" cancelText="لأ"
                  onConfirm={() => remove(row)}>
                  <Tooltip title="حذف">
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                  </Tooltip>
                </Popconfirm>
                <Tooltip title="تعديل">
                  <Button type="text" size="small" icon={<EditOutlined />}
                    onClick={() => openEdit(row)} />
                </Tooltip>
                <Tooltip title="عرض">
                  <Button type="text" size="small" icon={<EyeOutlined />}
                    onClick={() => setViewing(row)} />
                </Tooltip>
              </Space>
            ) },
        ]}
      />

      <Modal
        open={!!viewing} onCancel={() => setViewing(null)} footer={null} destroyOnHidden
        title="بيانات الفئة" width={420}
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="رقم">{viewing?.id}</Descriptions.Item>
          <Descriptions.Item label="الاسم">{viewing?.label}</Descriptions.Item>
          <Descriptions.Item label="مخفي">{viewing?.active ? 'لا' : 'نعم'}</Descriptions.Item>
          <Descriptions.Item label="وصف">{viewing?.description || '—'}</Descriptions.Item>
        </Descriptions>
      </Modal>

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
