import React, { useEffect, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Button, Descriptions, Dropdown, Form, Input, Select, Space, Switch, Table, Tooltip, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, PrinterOutlined,
  EyeOutlined, DownOutlined, CloseCircleOutlined, CheckCircleOutlined,
  AppstoreOutlined, SearchOutlined, ClearOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { invalidateCategoryTree } from '../hooks/useCategoryTree';
import { useTableKeyboard } from '../components/keyboard';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import { numeralsLocale } from '../utils/money';
import { useScreenShortcuts } from '../components/keyboard';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { buildCsv, downloadCsv } from '../utils/exportCsv';

interface Category {
  id: number;
  value: string;
  label: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  parent_value: string | null;
  hidden_in_price_sheet?: boolean;
}

export default function Categories() {
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const searchRef = React.useRef<any>(null);
  const [viewing, setViewing] = useState<Category | null>(null);

  const csv = (name: string, rows: (string | number)[][]) => {
    const width = Math.max(0, ...rows.map((r) => r.length));
    const cols = Array.from({ length: width }, (_, i) => ({
      title: String(rows[0]?.[i] ?? ''),
      value: (r: (string | number)[]) => r[i],
    }));
    downloadCsv(name, buildCsv(cols, rows.slice(1)));
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

  const byValue = React.useMemo(
    () => new Map(rows.map((r) => [r.value, r])), [rows]);
  const childrenOf = React.useMemo(() => {
    const m = new Map<string, Category[]>();
    rows.forEach((r) => {
      if (!r.parent_value) return;
      const list = m.get(r.parent_value) || [];
      list.push(r);
      m.set(r.parent_value, list);
    });
    return m;
  }, [rows]);
  const hasTree = childrenOf.size > 0;

  const ordered = React.useMemo(() => {
    if (!hasTree) return rows;
    const out: Category[] = [];
    rows.forEach((r) => {
      if (r.parent_value && byValue.has(r.parent_value)) return;
      out.push(r);
      (childrenOf.get(r.value) || []).forEach((k) => out.push(k));
    });
    rows.forEach((r) => { if (!out.includes(r)) out.push(r); });
    return out;
  }, [rows, hasTree, byValue, childrenOf]);

  const filter = useListFilter(ordered, {
    search: (c) => [c.label, c.value, c.description || ''],
    filters: { active: (c, v) => c.active === (v === 'active') },
  });

  const openCreate = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const openEdit = (row: Category) => {
    setEditing(row);
    form.setFieldsValue({
      label: row.label, description: row.description,
      parent_value: row.parent_value || undefined,
    });
    setOpen(true);
  };

  const parentChoices = React.useMemo(() => rows
    .filter((r) => !r.parent_value && r.value !== editing?.value)
    .map((r) => ({ value: r.value, label: r.label })), [rows, editing]);

  const editingHasChildren = !!(editing && (childrenOf.get(editing.value) || []).length);

  const submit = async (values: any) => {
    try {
      if (editing) {
        await api.patch(`/api/v1/settings/lookups/${editing.id}`, {
          label: values.label, description: values.description || null,
          parent_value: values.parent_value || '',
        });
        message.success('تم حفظ الفئة');
      } else {
        await api.post('/api/v1/settings/lookups', {
          category: 'item_category',
          value: values.label.trim().replace(/\s+/g, '_').slice(0, 40),
          label: values.label,
          description: values.description || null,
          parent_value: values.parent_value || null,
        });
        message.success('تمت إضافة الفئة');
      }
      setOpen(false);
      invalidateCategoryTree();
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    }
  };

  const toggleSheet = async (row: Category, show: boolean) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, hidden_in_price_sheet: !show } : r)));
    try {
      await api.patch(`/api/v1/settings/lookups/${row.id}`, { hidden_in_price_sheet: !show });
      message.success(show ? `«${row.label}» ظاهرة في شيت التسعير` : `«${row.label}» مخفية من شيت التسعير`);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
      load();
    }
  };

  const remove = async (row: Category) => {
    try {
      await api.delete(`/api/v1/settings/lookups/${row.id}`);
      message.success('تم حذف الفئة');
      invalidateCategoryTree();
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحذف');
    }
  };

  useScreenShortcuts({
    onNew: openCreate,
    onSearch: () => searchRef.current?.focus(),
    onSave: open ? () => form.submit() : undefined,
    onClose: open ? () => setOpen(false) : undefined,
  });

  const kb = useTableKeyboard<Category>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  const columns = [
    { title: 'رقم', dataIndex: 'id', width: 70, align: 'center' as const },
    { title: 'الاسم', dataIndex: 'label',
      render: (label: string, row: Category) => (
        <span style={{ paddingInlineStart: row.parent_value ? 18 : 0 }}>
          {row.parent_value ? '↳ ' : ''}{label}
        </span>
      ) },
    ...(hasTree ? [{
      title: 'الفئة الرئيسية', dataIndex: 'parent_value', width: 160,
      render: (v: string | null) => (v ? (byValue.get(v)?.label || v) : ''),
    }] : []),
    { title: 'مخفي', dataIndex: 'active', width: 90, align: 'center' as const,
      render: (a: boolean) => (a
        ? <CloseCircleOutlined style={{ color: '#cf1322' }} />
        : <CheckCircleOutlined style={{ color: '#6AB42D' }} />) },
    { title: 'شيت التسعير (التطبيق)', key: 'price_sheet', width: 150, align: 'center' as const,
      render: (_: unknown, row: Category) => {
        const byParent = !!(row.parent_value && byValue.get(row.parent_value)?.hidden_in_price_sheet);
        return (
          <Tooltip title={byParent ? 'مخفية لأن الفئة الرئيسية مخفية' : undefined}>
            <Switch size="small" checkedChildren="ظاهرة" unCheckedChildren="مخفية"
              checked={!row.hidden_in_price_sheet && !byParent} disabled={byParent}
              onClick={(_c, e) => e.stopPropagation()}
              onChange={(v) => toggleSheet(row, v)} />
          </Tooltip>
        );
      } },
    { title: 'وصف', dataIndex: 'description', render: (v: string) => v || '' },
    { title: '', key: 'act', width: 110, align: 'center' as const,
      render: (_: unknown, row: Category) => (
        <Space size={4}>
          <Popconfirm title="هل تريد حذف هذه الفئة؟" okText="نعم" cancelText="لا"
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
  ];

  const tableCols = useTableColumns('categories', columns, {
    export: { name: 'الفئات', rows: filter.filtered },
  });

  const activeFilter = filter.values.active;
  return (
    <>
    <ListPage
      icon={<AppstoreOutlined />}
      title="الفئات" muted="(فئات الأصناف)"
      actions={(<>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={openCreate}>فئة جديدة</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>إعادة تحميل</Button>
        <Dropdown menu={{ items: moreMenu }}>
          <Button>المزيد <DownOutlined /></Button>
        </Dropdown>
        <Button icon={<PrinterOutlined />} onClick={() => window.print()} />
        {tableCols.control}
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef}
          value={filter.query} placeholder="بحث باسم الفئة"
          prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        <Select allowClear placeholder="الحالة"
          value={activeFilter === undefined || activeFilter === null || activeFilter === ''
            ? undefined : activeFilter}
          onChange={(v) => filter.setValue('active', v)}
          options={[{ value: 'active', label: 'ظاهرة' }, { value: 'inactive', label: 'مخفية' }]} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table<Category>
          {...kb.tableProps}
        className="sl-table"
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        locale={{ emptyText: 'لا توجد فئات' }}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, locale: { items_per_page: '' },
          showTotal: () => (
            <span className="sl-foot">
              <span>إجمالي الفئات: <b>{rows.length.toLocaleString(numeralsLocale())}</b></span>
              {filter.filtered.length < rows.length && (
                <span>المعروض: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b></span>
              )}
            </span>
          ),
        }}
        columns={tableCols.columns}
      />
    </ListPage>

      <TabModal
        open={!!viewing} onCancel={() => setViewing(null)} footer={null} destroyOnHidden
        title="بيانات الفئة" width={420}
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="رقم">{viewing?.id}</Descriptions.Item>
          <Descriptions.Item label="الاسم">{viewing?.label}</Descriptions.Item>
          <Descriptions.Item label="الفئة الرئيسية">
            {viewing?.parent_value
              ? (byValue.get(viewing.parent_value)?.label || viewing.parent_value)
              : '— (فئة رئيسية)'}
          </Descriptions.Item>
          <Descriptions.Item label="مخفي">{viewing?.active ? 'لا' : 'نعم'}</Descriptions.Item>
          <Descriptions.Item label="وصف">{viewing?.description || '—'}</Descriptions.Item>
        </Descriptions>
      </TabModal>

      <TabModal
        open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden
        title={editing ? 'تعديل فئة' : 'فئة جديدة'} width={420}
      >
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item name="label" label="اسم الفئة" rules={[{ required: true, message: 'اكتب الاسم' }]}>
            <Input placeholder="مثال: مواسير PVC" />
          </Form.Item>
          <Form.Item
            name="parent_value" label="الفئة الرئيسية"
            extra={editingHasChildren
              ? 'لهذه الفئة فئات فرعية، فلا يمكن جعلها فرعية لغيرها.'
              : undefined}
          >
            <Select
              allowClear showSearch
              disabled={editingHasChildren}
              placeholder="— فئة رئيسية —"
              options={parentChoices} filterOption={searchFilter} filterSort={searchRank} />
          </Form.Item>
          <Form.Item name="description" label="وصف">
            <Input.TextArea rows={2} maxLength={240} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>حفظ</Button>
        </Form>
      </TabModal>
    </>
  );
}
