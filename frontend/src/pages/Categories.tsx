import React, { useEffect, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Button, Descriptions, Dropdown, Form, Input, Select, Space, Table, Tooltip, message,
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
  /**
   * قيمة الفئة الأب — `null` يعني رئيسية. (031)
   *
   * الشجرة مستويين: رئيسية ← فرعية ← أصناف. والأب متخزّن على **صف الفئة** مش على
   * الصنف، فـ`Item.category` لكل صنف موجود فضل زي ما هو بالحرف والترقية كلها إضافة.
   */
  parent_value: string | null;
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
    // These sheets are already built as raw cell arrays (headings are just the first row), so this
    // one goes through `buildCsv` with positional columns rather than named ones.
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

  /**
   * الشجرة متحسوبة من الصفوف اللي على الشاشة، مش من نداء تاني. (031)
   *
   * الشاشة دي بتحمّل القايمة كلها أصلاً — الأب قيمة فيها — فأي مصدر تاني للشجرة هنا
   * كان هيبقى نسخة تانية ممكن تتأخر عن اللي قدام اللي بيعدّل بلحظة.
   */
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
  /** فيه شجرة أصلاً؟ لو لأ الشاشة بترسم المسطّح زي ما كان بالحرف — من غير عمود زيادة. */
  const hasTree = childrenOf.size > 0;

  /**
   * الترتيب: الفرع ورا أبوه على طول.
   *
   * الترتيب جاي من السيرفر بـ`sort_order`، واللي بيضيف فرعية جديدة بتنزل في آخر
   * القايمة بعيد عن أبوها — فالشجرة بتبقى مكتوبة في عمود ومش مقروءة في الجدول.
   * ولو مافيش شجرة، الترتيب بيرجع كما هو من غير أي لمس.
   */
  const ordered = React.useMemo(() => {
    if (!hasTree) return rows;
    const out: Category[] = [];
    rows.forEach((r) => {
      if (r.parent_value && byValue.has(r.parent_value)) return;  // بيتحط ورا أبوه
      out.push(r);
      (childrenOf.get(r.value) || []).forEach((k) => out.push(k));
    });
    // الفرعية اللي أبوها مش في القايمة (اتشال بطريقة ما) مابتضيعش من الشاشة.
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
      // `undefined` مش `null` عشان الـ`placeholder` يبان على الفئة الرئيسية.
      parent_value: row.parent_value || undefined,
    });
    setOpen(true);
  };

  /**
   * مين يصلح يبقى أب — الفئات الرئيسية بس، وماعدا الفئة اللي بنعدّلها.
   *
   * مستويين وبس (السيرفر بيرفض غير كده كمان): الرئيسية اللي تحتها فروع لو بقت
   * فرعية لغيرها، التقارير اللي بتجمّع على الرئيسية هتحتاج تلف — وولا واحد فيهم
   * بيلف دلوقتي، فالكشف كان هيطلع ناقص من غير ما حد ياخد باله.
   */
  const parentChoices = React.useMemo(() => rows
    .filter((r) => !r.parent_value && r.value !== editing?.value)
    .map((r) => ({ value: r.value, label: r.label })), [rows, editing]);

  /** الفئة اللي تحتها فروع مايبقاش ليها أب — مستويين. */
  const editingHasChildren = !!(editing && (childrenOf.get(editing.value) || []).length);

  const submit = async (values: any) => {
    try {
      if (editing) {
        await api.patch(`/api/v1/settings/lookups/${editing.id}`, {
          label: values.label, description: values.description || null,
          // `''` معناها «خليها رئيسية» — مش زي الحقل الغايب اللي معناه «ماتلمسش الأب».
          // من غير الفرق ده، أي حفظ من شاشة قديمة كان هيفكّ الشجرة في صمت.
          parent_value: values.parent_value || '',
        });
        message.success('تم حفظ الفئة');
      } else {
        await api.post('/api/v1/settings/lookups', {
          category: 'item_category',
          // The stored value is what documents point at; it is derived from the name so nobody has
          // to invent a code, and it never changes afterwards even if the name is corrected.
          value: values.label.trim().replace(/\s+/g, '_').slice(0, 40),
          label: values.label,
          description: values.description || null,
          parent_value: values.parent_value || null,
        });
        message.success('اتضافت الفئة');
      }
      setOpen(false);
      // المنتقي وكارت الصنف بيقروا الشجرة من كاش مشترك — من غير الرمية دي الفئة
      // الجديدة مابتظهرش عندهم غير بعد ريفرش، واللي أضافها يقول إنها ماتسجّلتش.
      invalidateCategoryTree();
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    }
  };

  const remove = async (row: Category) => {
    try {
      await api.delete(`/api/v1/settings/lookups/${row.id}`);
      message.success('اتشالت الفئة');
      invalidateCategoryTree();
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

  // السطر يفتح التعديل — البيانات الأساسية مافيهاش «عرض» غير الفورم بتاعها نفسه.
  const kb = useTableKeyboard<Category>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  const columns = [
    { title: 'رقم', dataIndex: 'id', width: 70, align: 'center' as const },
    { title: 'الاسم', dataIndex: 'label',
      // الفرعية بتتزحزح جوّه العمود بدل عمود «مستوى» تاني: العين بتقرا الشجرة من
      // الشكل من غير ما الجدول يكبر. ومن غير شجرة الزحزحة بصفر — نفس الخانة بالحرف.
      render: (label: string, row: Category) => (
        <span style={{ paddingInlineStart: row.parent_value ? 18 : 0 }}>
          {row.parent_value ? '↳ ' : ''}{label}
        </span>
      ) },
    // **العمود بيظهر لما تبقى فيه شجرة بس.** (031) الفرع اللي ما عملش شجرة كان
    // هيلاقي عمود فاضي في كل صف — والشرط إن اللي مش مستعمل الميزة يشوف نفس الشاشة.
    ...(hasTree ? [{
      title: 'الفئة الرئيسية', dataIndex: 'parent_value', width: 160,
      render: (v: string | null) => (v ? (byValue.get(v)?.label || v) : ''),
    }] : []),
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
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('categories', columns, {
    export: { name: 'الفئات', rows: filter.filtered },
  });

  const activeFilter = filter.values.active;
  return (
    <>
    {/* العنوان «الفئات» زي شاشتهم، والقايمة بتقول «فئات الاصناف» — الاتنين متسابين. */}
    <ListPage
      icon={<AppstoreOutlined />}
      title="الفئات" muted="(فئات الاصناف)"
      subtitle="الفئات الرئيسية والفرعية اللي الأصناف بتتصنّف عليها"
      actions={(<>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={openCreate}>فئة جديدة</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>اعادة تحميل</Button>
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
        // Their column order exactly: رقم · الاسم · مخفي · وصف, then the row's three icons.
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
              ? 'الفئة دي تحتها فئات فرعية، فهي رئيسية ومش ممكن تبقى فرعية لغيرها.'
              : 'سيبها فاضية لو دي فئة رئيسية.'}
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
