import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Collapse, Table, Button, Input, Switch, Space, Tag, message, Form, Tooltip, Select,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import { PlusOutlined, DeleteOutlined, LockOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useSectionParam } from '../components/useQueryTab';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { TabModal } from '../components/TabModal';

interface CategoryMeta { category: string; label: string; system: boolean; }
interface PageGroup { page: string; page_label: string; categories: CategoryMeta[]; }
interface Option {
  id: number; category: string; value: string; label: string;
  sort_order: number; active: boolean; is_system: boolean;
  description?: string | null;
}

export default function Settings() {
  // «أدوات خاصة» in their menu is فحص سلامة البيانات here, a card down this page.
  useSectionParam();
  const [pages, setPages] = useState<PageGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  // نوع التكلفة (B5) — how a unit of stock is valued when a NEW cost is derived. Costs already
  // frozen onto past documents are untouched by it, which is why they were frozen.
  const [costingMethod, setCostingMethod] = useState<string>('average');
  const [savingCosting, setSavingCosting] = useState(false);

  const saveCostingMethod = async (method: string) => {
    setSavingCosting(true);
    try {
      await api.put('/api/v1/settings/stock', { costing_method: method });
      setCostingMethod(method);
      message.success('اتحفظت طريقة التكلفة');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ طريقة التكلفة');
    } finally {
      setSavingCosting(false);
    }
  };

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

  useEffect(() => {
    loadCategories();
    api.get('/api/v1/settings/stock')
      .then((r) => setCostingMethod(r.data?.costing_method || 'average'))
      .catch(console.error);
  }, []);

  // Search runs over the flattened categories, then they are regrouped under their page.
  const allCategories = useMemo(
    () => pages.flatMap((pg) =>
      pg.categories.map((c) => ({ ...c, page: pg.page, page_label: pg.page_label }))),
    [pages],
  );

  const catFilter = useListFilter(allCategories, {
    search: (c) => [c.label, c.category, c.page_label],
    filters: {
      page: (c, v) => c.page === v,
      system: (c, v) => c.system === (v === 'system'),
    },
  });

  const visiblePages = pages
    .map((pg) => ({ ...pg, categories: catFilter.filtered.filter((c) => c.page === pg.page) }))
    .filter((pg) => pg.categories.length > 0);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Card title="إعدادات المخزون" size="small">
        <Space wrap align="center">
          <span>نوع التكلفة:</span>
          <Select
            style={{ minWidth: 220 }} value={costingMethod} loading={savingCosting}
            onChange={saveCostingMethod}
            options={[
              { value: 'average', label: 'المتوسط المرجح' },
              { value: 'last_purchase', label: 'آخر سعر شراء' },
            ]}
          />
          <span style={{ color: '#888' }}>
            بتتحكم في تقييم أي تكلفة جديدة (الجرد، أذونات الصرف). التكاليف المتجمّدة على
            المستندات القديمة ما بتتغيّرش.
          </span>
        </Space>
      </Card>

      <div id="section-integrity"><IntegrityCard /></div>

      <CustomerMergeCard />

      <DocumentPolicyCard />

      <AccountRoutingCard />

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
      <ListToolbar
        searchPlaceholder="بحث باسم القائمة أو الصفحة"
        query={catFilter.query} onQueryChange={catFilter.setQuery}
        values={catFilter.values} onValueChange={catFilter.setValue}
        onReset={catFilter.reset}
        total={allCategories.length} shown={catFilter.filtered.length}
        filters={[
          { key: 'page', placeholder: 'الصفحة',
            options: pages.map((pg) => ({ value: pg.page, label: pg.page_label })) },
          { key: 'system', placeholder: 'نوع القائمة',
            options: [{ value: 'system', label: 'مقيّدة (نظام)' }, { value: 'custom', label: 'حرة (مخصصة)' }] },
        ]}
      />
      <Collapse
        accordion
        items={visiblePages.map((pg) => ({
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

  const filter = useListFilter(options, {
    search: (o) => [o.value, o.label],
    filters: {
      is_system: (o, v) => o.is_system === (v === 'system'),
      active: (o, v) => o.active === (v === 'visible'),
    },
  });

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
        description: values.description || null,
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
      // The note lives beside the name because that is where it is read: "which category is
      // this again" is answered by the description, not by opening something.
      title: 'الوصف', dataIndex: 'description',
      render: (_: string, r: Option) => (
        <EditableLabel value={r.description || ''} placeholder="اكتب وصفاً (اختياري)"
          onSave={(description) => saveOption(r, { description })} />
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

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('settings-lookups', columns);

  return (
    <Card
      size="small"
      title={<span>{meta.label} {meta.system && <Tag icon={<LockOutlined />} color="gold">مقيّدة</Tag>}</span>}
      extra={(
        <Space>
        {tableCols.control}
        {!meta.system && (
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            إضافة خيار
          </Button>
        )}
        </Space>
      )}
    >
      <ListToolbar
        searchPlaceholder="بحث في الخيارات"
        searchSpan={7}
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={options.length} shown={filter.filtered.length}
        filters={[
          { key: 'is_system', placeholder: 'المصدر',
            options: [{ value: 'system', label: 'خيار نظام' }, { value: 'custom', label: 'خيار مخصص' }] },
          { key: 'active', placeholder: 'الظهور',
            options: [{ value: 'visible', label: 'ظاهر' }, { value: 'hidden', label: 'مخفي' }] },
        ]}
      />
      <Table size="small" rowKey="id" loading={loading} dataSource={filter.filtered} columns={tableCols.columns}
        pagination={false} />

      <TabModal title={`إضافة خيار إلى: ${meta.label}`} open={addOpen} onCancel={() => setAddOpen(false)}
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
      </TabModal>
    </Card>
  );
}

function EditableLabel({ value, onSave, placeholder }:
  { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);
  const dirty = val !== value;
  return (
    <Space.Compact style={{ width: '100%', maxWidth: 320 }}>
      <Input value={val} placeholder={placeholder} onChange={(e) => setVal(e.target.value)}
        onPressEnter={() => dirty && onSave(val)} />
      <Button icon={<SaveOutlined />} type={dirty ? 'primary' : 'default'} disabled={!dirty}
        onClick={() => onSave(val)} />
    </Space.Compact>
  );
}


// ---------------------------------------------------------------------------
// التوجيه المحاسبي
// ---------------------------------------------------------------------------
interface RoutingRow {
  role: string;
  label: string;
  account_id: number;
  account_code: string;
  account_name: string;
  source: 'default' | 'configured';
  nature_warning?: string | null;
}

/**
 * Points each posting role at an account from the client's own chart.
 *
 * Every posting in the system names a role, not an account, and the default is an account this
 * system seeded. That default is safe but presumptuous: an accountant who already has a chart
 * wants revenue on *their* revenue account, where their auditor looks for it.
 *
 * Two things this screen is careful about. It shows whether each row is a default or something
 * somebody configured — the two are indistinguishable once posted, and that distinction is the
 * first question when a statement reads wrong. And every row can be put back, because the fastest
 * fix for a role pointed somewhere wrong is the safe behaviour, immediately.
 */
function AccountRoutingCard() {
  const [rows, setRows] = useState<RoutingRow[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, a] = await Promise.all([
        api.get('/api/v1/account-routing'),
        api.get('/api/v1/accounts', { params: { postable_only: true, active: true } }),
      ]);
      setRows(r.data || []);
      setAccounts(a.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (role: string, accountId: number | null) => {
    setSaving(role);
    try {
      const res = await api.put('/api/v1/account-routing', { role, account_id: accountId });
      setRows(res.data || []);
      message.success(accountId ? 'اتحفظ التوجيه' : 'رجع للحساب الافتراضي');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ التوجيه');
    } finally { setSaving(null); }
  };

  return (
    <Card title="التوجيه المحاسبي" size="small" loading={loading}
      extra={<Button icon={<ReloadOutlined />} onClick={load} />}>
      <p style={{ color: '#888', marginTop: 0 }}>
        كل دور محاسبي بيترحّل على أنهي حساب. سيبه فاضي والنظام يستخدم حسابه الافتراضي —
        مش لازم تظبط حاجة عشان الترحيل يشتغل صح.
      </p>
      <Table<RoutingRow>
        rowKey="role" size="small" dataSource={rows} pagination={false}
        columns={[
          { title: 'الدور', dataIndex: 'label', width: 200,
            render: (l: string, r) => (
              <>
                <b>{l}</b>
                {r.source === 'default'
                  ? <Tag style={{ marginInlineStart: 8 }}>افتراضي</Tag>
                  : <Tag color="blue" style={{ marginInlineStart: 8 }}>مظبوط</Tag>}
              </>
            ) },
          { title: 'الحساب', key: 'acc',
            render: (_: unknown, r) => (
              <Select
                style={{ minWidth: 320 }} showSearch optionFilterProp="label" allowClear
                value={r.account_id} loading={saving === r.role}
                placeholder="الحساب الافتراضي"
                onChange={(v) => save(r.role, v ?? null)}
                onClear={() => save(r.role, null)}
                options={accounts.map((a) => ({
                  value: a.id, label: `${a.code} — ${a.name}`,
                }))}
              />
            ) },
          { title: '', key: 'warn',
            render: (_: unknown, r) => (r.nature_warning
              ? <span style={{ color: '#d46b08' }}>{r.nature_warning}</span>
              : null) },
        ]}
      />
    </Card>
  );
}


// ---------------------------------------------------------------------------
// قفل تعديل المستندات (أيام)
// ---------------------------------------------------------------------------
/**
 * A rolling window: past N days from a document's date, only an admin may reverse it.
 *
 * Sits beside the hard period lock rather than replacing it. The lock is a deliberate act on a date
 * the accountant picks, and it only ever protects a month somebody remembered to close; this closes
 * the ordinary user's window on its own, so last month's invoice cannot be quietly reversed on a
 * busy Tuesday and move a figure that has already been reported.
 */
function DocumentPolicyCard() {
  const [days, setDays] = useState<number | null>(null);
  const [fixedPct, setFixedPct] = useState<string>('0');
  const [vatPct, setVatPct] = useState<string>('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/v1/settings/sales')
      .then((r) => {
        setDays(r.data?.edit_lock_days ?? null);
        setFixedPct(String(r.data?.fixed_discount_pct ?? '0'));
        setVatPct(String(r.data?.vat_rate_pct ?? '0'));
      })
      .catch(console.error);
  }, []);

  const save = async (value: number | null) => {
    setSaving(true);
    try {
      // The other two are sent back unchanged: this endpoint replaces the whole settings row, so
      // omitting them would silently reset the fixed discount and the VAT rate.
      await api.put('/api/v1/settings/sales', {
        fixed_discount_pct: fixedPct, vat_rate_pct: vatPct, edit_lock_days: value,
      });
      setDays(value || null);
      message.success(value ? `التعديل مقفول بعد ${value} يوم` : 'قفل التعديل متوقّف');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الإعداد');
    } finally { setSaving(false); }
  };

  return (
    <Card title="إعدادات المستندات" size="small">
      <Space wrap align="center">
        <span>قفل تعديل المستندات بعد (أيام):</span>
        <InputNumber
          min={0} value={days ?? 0} disabled={saving} style={{ width: 120 }}
          onBlur={(e) => {
            const v = Number((e.target as HTMLInputElement).value || 0);
            if ((v || null) !== days) save(v || null);
          }}
          onChange={(v) => setDays(v as number | null)}
        />
        <span style={{ color: '#888' }}>
          بعد المدة دي من تاريخ المستند، العكس أو التعديل للمسؤول بس. صفر = متوقّف.
          ده غير إقفال الفترة — الإقفال قرار بتاخده بتاريخ معيّن، وده بيقفل شبّاك المستخدم لوحده.
        </span>
      </Space>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// فحص سلامة البيانات
// ---------------------------------------------------------------------------
interface IntegrityFinding {
  check: string;
  subject: string;
  expected: string;
  found: string;
  detail: string;
}

/**
 * Reports whether the stored data still agrees with itself. It does not repair anything.
 *
 * That is the deliberate part. Their equivalent screen recomputes and fixes balances, which it has
 * to because it caches them; ours are always summed from the movements, so there is nothing to
 * recompute. The two things that *are* stored beside the movements — expiry lots and serial numbers
 * — can drift, and if they have, the cause is a code path that wrote one side without the other.
 * Quietly correcting the numbers would hide that defect and guarantee it happens again unnoticed.
 */
/**
 * دمج العملاء المكرّرين — الخطة الأول، والتنفيذ قرار تاني.
 *
 * The old system could give a customer only one receivable account, so selling him two product
 * lines meant opening him twice: «محمد عامر» for أبيض and «تكنو محمد عامر» for بولي. The merge puts
 * them back together — one customer, two family accounts, and a total.
 *
 * It lives here rather than in a script because a script can only ever run against the database on
 * somebody's own machine. That is how production came to keep its duplicates while every local copy
 * had them joined: a deploy carries code and does not touch data, which from outside is
 * indistinguishable from the work never having been done.
 *
 * **Nothing is deleted and no money moves.** The duplicate's LEDGER account carries his whole
 * history and simply becomes the بولي account of the surviving customer; the duplicate row is
 * deactivated, not removed. The server totals every customer balance before and after and refuses
 * the whole thing if the two disagree by a piastre.
 */
function CustomerMergeCard() {
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const [progress, setProgress] = useState<string | null>(null);

  /**
   * التنفيذ بيمشي على دفعات.
   *
   * Merging all 86 in one request kept returning 503: the platform caps how long a request may
   * run, and that cap is not something this code can see or should have to guess. In batches it
   * stops mattering — each call is short, and this repeats until nothing is left.
   *
   * Safe to interrupt at any point. A merge is per-customer and independent, so «twenty done,
   * sixty left» is not a half-finished state; it is sixty people who have not been merged yet.
   */
  const BATCH = 15;

  const run = async (apply: boolean) => {
    setBusy(true);
    setProgress(null);
    try {
      if (!apply) {
        const res = await api.post('/api/v1/admin/merge-customers?apply=false');
        setPlan(res.data);
        const n = res.data?.pairs?.length ?? 0;
        if (n) message.info(`${n} عميل متكرّر — راجع الخطة قبل التنفيذ`);
        else message.success('مفيش عملاء مكرّرين — مافيش حاجة تتدمج');
        return;
      }

      let done = 0;
      let last: any = null;
      // Bounded rather than `while (true)`: a server that always reports work left would otherwise
      // spin forever, and a loop that cannot end is worse than one that stops and says so.
      for (let round = 0; round < 40; round += 1) {
        const res = await api.post(
          `/api/v1/admin/merge-customers?apply=true&limit=${BATCH}`);
        last = res.data;
        done += res.data?.merged_now ?? 0;
        setProgress(`اتدمج ${done} — فاضل ${res.data?.remaining ?? 0}`);
        if (!res.data?.merged_now || !res.data?.remaining) break;
      }
      setPlan({ ...last, pairs: [], applied: true });
      setProgress(null);
      message.success(`اتنفّذ الدمج — ${done} عميل، والأرصدة زي ما هي`);
    } catch (err: any) {
      setProgress(null);
      message.error(err?.response?.data?.detail?.message || 'تعذر تشغيل الدمج');
    } finally { setBusy(false); }
  };

  const pairs = plan?.pairs ?? [];
  const balancesMatch = plan && plan.balance_before === plan.balance_after;

  return (
    <Card title="دمج العملاء المكرّرين (أبيض / بولي)" size="small"
      extra={<Button loading={busy} onClick={() => run(false)}>وريني الخطة</Button>}>
      <p style={{ color: '#888', marginTop: 0 }}>
        العميل اللي اتفتح مرتين — «فلان» و«تكنو فلان» — بيرجع عميل واحد بحسابين: أبيض وبولي،
        وإجمالي. <b>مافيش حاجة بتتحذف ومافيش فلوس بتتحرك:</b> حساب الأستاذ بتاع المكرّر بيفضل
        بكل حركاته وبيبقى حساب البولي. السيرفر بيجمع أرصدة العملاء قبل وبعد، ولو اختلفت بمليم
        بيرفض الدمج كله.
      </p>

      {plan && (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color={pairs.length ? 'blue' : 'green'}>{pairs.length} عميل متكرّر</Tag>
            <Tag>{plan.techno_only?.length ?? 0} «تكنو» من غير أصل</Tag>
            {plan.skipped?.length ? <Tag color="orange">{plan.skipped.length} اتخطّى</Tag> : null}
            {/* الرقم اللي بيقول إن الدمج أمان. لو اتغيّر، السيرفر أصلاً رفض. */}
            <Tag color={balancesMatch ? 'green' : 'red'}>
              الأرصدة: {plan.balance_before} {balancesMatch ? '— زي ما هي' : `← ${plan.balance_after}`}
            </Tag>
            {plan.applied && <Tag color="green">اتنفّذ</Tag>}
            {progress && <Tag color="processing">{progress}</Tag>}
          </Space>

          {pairs.length > 0 && (
            <Table
              size="small" rowKey={(r: any) => r.merge?.id} dataSource={pairs}
              pagination={{ defaultPageSize: 10, showTotal: (t) => `إجمالي ${t}` }}
              columns={[
                { title: 'الاسم', dataIndex: 'base_name' },
                // `keep` and `merge` come back NESTED — {id, name} — and these read them flat, so
                // both columns were blank: the plan showed how many would merge and never which
                // account survives. That is the one thing it exists to show before an irreversible
                // merge, so the id goes beside the name; two customers can share one.
                { title: 'الحساب اللي هيفضل', key: 'keep',
                  render: (_: any, r: any) => (r.keep
                    ? <span>{r.keep.name} <span style={{ color: '#6b6b6b' }}>#{r.keep.id}</span></span>
                    : '-') },
                { title: 'اللي هيندمج فيه', key: 'merge',
                  render: (_: any, r: any) => (r.merge
                    ? <span>{r.merge.name} <span style={{ color: '#6b6b6b' }}>#{r.merge.id}</span></span>
                    : '-') },
                { title: 'المندوب', dataIndex: 'same_rep', width: 130,
                  render: (v: boolean) => (v
                    ? <Tag color="green">نفس المندوب</Tag>
                    : <Tag color="orange">مندوب مختلف</Tag>) },
              ]}
            />
          )}

          {plan.skipped?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {plan.skipped.map(([name, why]: [string, string]) => (
                <div key={name} style={{ color: '#d46b08', fontSize: 12 }}>{name}: {why}</div>
              ))}
            </div>
          )}

          {!plan.applied && pairs.length > 0 && (
            <Popconfirm
              title="تنفيذ الدمج؟"
              description="العملاء المكرّرين هيتدمجوا. الأرصدة هتتراجع قبل وبعد، ولو اختلفت هيترفض كله."
              okText="نفّذ" cancelText="رجوع" okButtonProps={{ danger: true }}
              onConfirm={() => run(true)}
            >
              <Button danger type="primary" loading={busy} style={{ marginTop: 10 }}>
                نفّذ الدمج
              </Button>
            </Popconfirm>
          )}
        </>
      )}
    </Card>
  );
}

function IntegrityCard() {
  const [result, setResult] = useState<
    { clean: boolean; checked: Record<string, number>; findings: IntegrityFinding[] } | null
  >(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.get('/api/v1/admin/integrity');
      setResult(res.data);
      if (res.data?.clean) message.success('كل الأرصدة متطابقة');
      else message.warning(`فيه ${res.data.findings.length} تعارض محتاج مراجعة`);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تشغيل الفحص');
    } finally { setRunning(false); }
  };

  return (
    <Card title="فحص سلامة البيانات" size="small"
      extra={<Button type="primary" loading={running} onClick={run}>شغّل الفحص</Button>}>
      <p style={{ color: '#888', marginTop: 0 }}>
        بيتأكد إن دفعات الصلاحية والأرقام التسلسلية متطابقة مع أرصدة الحركات، وإن مافيش رصيد
        سالب، وإن كل قيد متوازن. <b>بيقرأ ويقول بس — ما بيصلّحش.</b> لو طلع تعارض، ده باج
        في كود لازم يتتبّع؛ تصليح الأرقام كان هيخفيه.
      </p>
      {result && (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            {result.clean
              ? <Tag color="green">كل حاجة متطابقة</Tag>
              : <Tag color="red">{result.findings.length} تعارض</Tag>}
            {Object.entries(result.checked).map(([k, v]) => (
              <Tag key={k}>{k}: {v}</Tag>
            ))}
          </Space>
          {!result.clean && (
            <Table<IntegrityFinding>
              rowKey={(f) => `${f.check}-${f.subject}`}
              size="small" pagination={false} dataSource={result.findings}
              columns={[
                { title: 'الفحص', dataIndex: 'check', width: 220 },
                { title: 'المحل', dataIndex: 'subject', width: 220 },
                { title: 'المتوقّع', dataIndex: 'expected', width: 110 },
                { title: 'الموجود', dataIndex: 'found', width: 110 },
                { title: 'التفصيل', dataIndex: 'detail' },
              ]}
            />
          )}
        </>
      )}
    </Card>
  );
}
