import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Table, Button, Space, Input, Form, Select, Switch, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, EditOutlined, StopOutlined, ReloadOutlined, AppstoreOutlined, SearchOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard, useScreenShortcuts } from '../components/keyboard';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { numeralsLocale } from '../utils/money';
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
  // الشريحة في الرابط (`?tab=active|all`) — الريفرش بيرجع عليها.
  const [listTab, setListTab] = useQueryTab('active');
  const showInactive = listTab === 'all';
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
  const tableCols = useTableColumns('inspection-items', columns, {
    export: { name: 'أصناف المعاينة', rows: filter.filtered },
  });

  // F3 للبحث — كانت جاية من `ListToolbar`، والخانة دلوقتي في سطر الفلاتر.
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const loc = numeralsLocale();
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <>
      {/* «عرض الموقوفة» كان سويتش — بقى شريحتين، ونفس الحالة `showInactive`. */}
      <ListPage<'active' | 'all'>
        icon={<AppstoreOutlined />}
        title="أصناف المعاينة" muted="(قيمة النقاط)"
        subtitle="الأصناف اللي بتظهر في تطبيق المعاينات — التعديل بيوصل للمناديب مع «تحديث الأصناف والقوائم»"
        tabs={[
          { key: 'active', label: 'النشطة', count: activeCount },
          { key: 'all', label: 'الكل مع الموقوفة', count: rows.length },
        ]}
        activeTab={showInactive ? 'all' : 'active'}
        onTabChange={setListTab}
        actions={(<>
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={openNew}>
            إضافة صنف
          </Button>
          {tableCols.control}
          <Button icon={<ReloadOutlined />} onClick={load}>
            تحديث
          </Button>
        </>)}
        filters={(<>
          <Input
            className="sl-f-search"
            ref={searchRef}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="بحث باسم الصنف"
            value={filter.query}
            onChange={(e) => filter.setQuery(e.target.value)}
          />
          {/* أكتر من قيمة = «أي واحدة منهم» — نفس سلوك قوايم `ListToolbar`. */}
          <Select
            mode="multiple" allowClear maxTagCount="responsive" placeholder="الحالة"
            value={filter.values.active}
            onChange={(v) => filter.setValue('active', v)}
            options={[{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'موقوف' }]}
          />
          <Select
            mode="multiple" allowClear maxTagCount="responsive" placeholder="قيمة النقاط"
            value={filter.values.has_points}
            onChange={(v) => filter.setValue('has_points', v)}
            options={[{ value: 'yes', label: 'له نقاط' }, { value: 'no', label: 'بدون نقاط' }]}
          />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>)}
      >
        <Table<ItemType>
          {...kb.tableProps}
          className="sl-table"
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={filter.filtered}
          pagination={{
            defaultPageSize: PAGE_SIZE,
            showTotal: (t) => (
              <span className="sl-foot">
                <span>إجمالي الأصناف: <b>{visible.length.toLocaleString(loc)}</b></span>
                {t !== visible.length && <span>المعروض: <b>{t.toLocaleString(loc)}</b></span>}
              </span>
            ),
          }}
          columns={tableCols.columns}
        />
      </ListPage>

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
    </>
  );
};

export default InspectionItems;
