import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Form, Input, Row, Select, Space, Switch, Tag, Tooltip, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SettingOutlined,
  ThunderboltOutlined, SearchOutlined, SwapOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { TabModal } from '../components/TabModal';
import VoucherKeyRunner, {
  KIND_COLORS, KIND_LABELS, VoucherKey, useRunnerWorld,
} from '../components/VoucherKeyRunner';

/**
 * المفاتيح الخاصة — ربط بين حسابين رئيسيين، والسند بيتعمل بضغطة.
 *
 * Their system carries «مفاتيح خاصة» beside «قيد حر», and that placement is the whole idea: a free
 * entry asks for both accounts every single time; a key is the same entry with the accounts already
 * answered. Writing «تحصيل نقدي» forty times a week is forty times choosing the same safe out of a
 * list and the same heading out of the chart — none of that is a decision, it is the same answer
 * retyped, and every retyping is a chance to pick the wrong one.
 *
 * **The direction decides what the key is.** مدين الخزينة / دائن العملاء is money coming in, so it
 * posts as a سند قبض and inherits the أبيض/بولي split and the safe's balance guard. Turn the pair
 * around and it is something else. The screen never works that out for itself — it asks the server,
 * which resolves it with the same table it will post by, so the preview here cannot drift from what
 * actually happens.
 *
 * This screen replaced «السندات السريعة», which was the same idea narrowed to expense accounts
 * only. One mechanism, not two: the keys page is where they are set up, and `VoucherKeyStrip` puts
 * the same runner above the vouchers screen where they are used.
 */

interface Account {
  id: number;
  code: string | null;
  name: string | null;
  parent_id: number | null;
  /** نوع الحساب — بيه بنعرف حسابات العملاء والموردين والخزن من غير ما نلفّ الشجرة. */
  account_type?: string | null;
  is_postable: boolean;
  active: boolean;
  owner_name?: string | null;
  main_level?: string | null;
}

const accLabel = (a: Account) =>
  `${a.code ? `${a.code} — ` : ''}${a.owner_name || a.name || `#${a.id}`}`;

/**
 * المجموعات الرئيسية — دي مش سطور في الشجرة.
 *
 * «العملاء» is 233 accounts sharing an account type and no parent between them; the heading every
 * screen shows is derived, not stored. A picker offering only real rows could therefore never
 * express «تحصيل نقدي», so the groups sit at the top of the list as first-class choices.
 */
/**
 * الأنواع اللي حساباتها ورقة تحت مجموعة، مش عناوين بذاتها: حساب لكل عميل، ولكل مورد،
 * ولكل مندوب، ولكل خزينة. دول مايبانوش في «الحسابات الرئيسية» مهما كان `parent_id` فاضي.
 */
const OWNED_TYPES = ['customer_receivable', 'supplier_payable', 'custody', 'treasury'];

const GROUPS: { value: string; label: string }[] = [
  { value: 'customer_receivable', label: 'العملاء' },
  { value: 'supplier_payable', label: 'الموردين' },
  { value: 'treasury', label: 'الخزينة والبنوك' },
  { value: 'custody', label: 'عهد المناديب' },
];

/**
 * الطرف بيتحدّد على خطوتين: **حساب رئيسي**، وبعده **حساب فرعي جوّاه — اختياري**.
 *
 * كانت قايمة واحدة مسطّحة فيها كل حسابات الشجرة: المجموعات الأربعة فوق، وتحتهم كل حساب
 * في النظام واحد ورا التاني — يعني ٢٣٣ حساب عميل في نفس القايمة اللي فيها «الخزينة».
 * الاختيار من قايمة بالطول ده مش اختيار، ده تفتيش.
 *
 * والخطوتين مش شكل: هما نفس السؤال اللي في دماغ اللي بيعمل المفتاح — «الربط ده على
 * الذمم المدينة كلها، ولا على عميل بعينه جوّاها؟». **ولو مااختارش فرعي، الربط بيبقى على
 * الرئيسي نفسه** — وساعتها السيرفر هو اللي بيسأل عن الحساب وقت عمل السند، لأن الطرف
 * اللي مش حساب واحد مستقر بيفضل سؤال مفتوح لحد ما السند يتكتب.
 *
 * الترميز اللي بيتبعت للسيرفر ما اتغيّرش: `g:` مجموعة و`a:` حساب — الفرق إن اللي بيتبعت
 * بقى الفرعي لو اتحدّد، والرئيسي لو لأ.
 */

/** الاختيار الواحد بيحمل نوعه معاه: `g:customer_receivable` مجموعة، `a:12` حساب. */
const encodeSide = (k: Partial<VoucherKey>, side: 'debit' | 'credit'): string | undefined => {
  const group = side === 'debit' ? k.debit_group : k.credit_group;
  const acc = side === 'debit' ? k.debit_account_id : k.credit_account_id;
  if (group) return `g:${group}`;
  if (acc) return `a:${acc}`;
  return undefined;
};

const decodeSide = (v: string | undefined, side: 'debit' | 'credit') => {
  if (!v) return { [`${side}_account_id`]: null, [`${side}_group`]: null };
  return v.startsWith('g:')
    ? { [`${side}_account_id`]: null, [`${side}_group`]: v.slice(2) }
    : { [`${side}_account_id`]: Number(v.slice(2)), [`${side}_group`]: null };
};

/**
 * طرف واحد — رئيسي وتحته فرعي اختياري.
 *
 * الفرعي بيتقفل لما الرئيسي مايكونش مختار، ولما يكون مجموعة (المجموعة مالهاش شجرة تحتها
 * هنا)، ولما الرئيسي مالوش حسابات جوّاه. وفي الحالات دي السطر اللي تحته بيقول السبب —
 * خانة مقفولة من غير سبب بتخلّي الواحد يفضل يجرّب فيها.
 */
function SideFields({
  side, title, hint, mainOptions, subsOf, form, onChange,
}: {
  side: 'debit' | 'credit';
  title: string;
  hint: string;
  mainOptions: { label: string; options: { value: string; label: string }[] }[];
  subsOf: (main?: string) => { value: number; label: string }[];
  form: any;
  onChange: () => void;
}) {
  return (
    <Form.Item shouldUpdate noStyle>
      {() => {
        const main: string | undefined = form.getFieldValue(`${side}_main`);
        const subs = subsOf(main);
        // المجموعة بقى ليها فرعي كمان — العملاء اللي تحتها. فالقفل بقى على حاجة واحدة
        // بس: مافيش حاجة جوّه الرئيسي أصلاً.
        const why = !main ? 'اختار الحساب الرئيسي الأول'
          : subs.length === 0 ? 'الحساب ده مافيهوش حسابات فرعية' : null;
        return (
          <>
            <Form.Item name={`${side}_main`} label={title}
              style={{ marginBottom: 6 }}
              rules={[{ required: true, message: `اختار ${title}` }]}>
              <Select showSearch optionFilterProp="label" options={mainOptions}
                placeholder={`${hint} — الحساب الرئيسي`}
                onChange={() => {
                  // الفرعي بتاع رئيسي تاني مالوش معنى تحت الرئيسي الجديد.
                  form.setFieldValue(`${side}_sub`, undefined);
                  onChange();
                }} />
            </Form.Item>
            <Form.Item name={`${side}_sub`} style={{ marginBottom: 14 }}>
              <Select showSearch allowClear optionFilterProp="label" options={subs}
                disabled={!!why}
                placeholder={why || 'حساب فرعي (اختياري) — سيبه فاضي للربط على الرئيسي'}
                onChange={onChange} />
            </Form.Item>
          </>
        );
      }}
    </Form.Item>
  );
}

export default function VoucherKeys() {
  const [keys, setKeys] = useState<VoucherKey[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [manage, setManage] = useState(false);

  const [world] = useRunnerWorld();
  const [running, setRunning] = useState<VoucherKey | null>(null);

  /** المفتاح اللي بنعدّله دلوقتي — أو `{}` لمفتاح جديد. */
  const [editing, setEditing] = useState<Partial<VoucherKey> | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ voucher_kind: string; asks: string[] } | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, a] = await Promise.all([
        api.get<VoucherKey[]>('/api/v1/voucher-keys'),
        api.get<Account[]>('/api/v1/accounts'),
      ]);
      setKeys(k.data || []);
      setAccounts((a.data || []).filter((x) => x.active !== false));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim();
    return keys
      .filter((k) => manage || k.active)
      .filter((k) => !q || `${k.name} ${k.debit_account_name ?? ''} ${
        k.credit_account_name ?? ''}`.includes(q));
  }, [keys, query, manage]);

  const openEditor = (k?: VoucherKey) => {
    setEditing(k ?? {});
    setPreview(k ? { voucher_kind: k.voucher_kind, asks: k.asks } : null);
    form.resetFields();
    /** مفتاح متسجّل على حساب واحد بيتفتح على خطوتيه: رئيسيه فوق، وهو نفسه تحت لو فرعي. */
    const asSteps = (side: 'debit' | 'credit') => {
      const enc = k ? encodeSide(k, side) : undefined;
      if (!enc) return { main: undefined, sub: undefined };
      if (enc.startsWith('g:')) return { main: enc, sub: undefined };
      const id = Number(enc.slice(2));
      const root = rootOf(id);
      return root === id
        ? { main: `a:${id}`, sub: undefined }
        : { main: `a:${root}`, sub: id };
    };
    const d = asSteps('debit');
    const c = asSteps('credit');
    form.setFieldsValue(k ? {
      name: k.name,
      debit_main: d.main, debit_sub: d.sub,
      credit_main: c.main, credit_sub: c.sub,
      payment_method: k.payment_method || undefined,
      family: k.family || undefined,
      description: k.description || undefined,
      sort_order: k.sort_order,
      active: k.active,
    } : { sort_order: keys.length, active: true });
  };

  /**
   * الرئيسي + الفرعي ← الترميز اللي السيرفر بيفهمه.
   *
   * الفرعي بيكسب لو اتحدّد، والرئيسي بيبقى هو الربط لو مااتحددش — ودي القاعدة اللي
   * الشاشة كلها قايمة عليها.
   */
  const sideOf = useCallback((side: 'debit' | 'credit'): string | undefined => {
    const sub = form.getFieldValue(`${side}_sub`);
    if (sub) return `a:${sub}`;
    return form.getFieldValue(`${side}_main`) || undefined;
  }, [form]);

  /** بنسأل السيرفر السند ده هيبقى إيه — نفس الجدول اللي هيترحّل بيه، مش نسخة تانية هنا. */
  const refreshPreview = useCallback(async () => {
    const debit = sideOf('debit');
    const credit = sideOf('credit');
    if (!debit || !credit || debit === credit) { setPreview(null); return; }
    try {
      const r = await api.get('/api/v1/voucher-keys/resolve', {
        params: {
          ...decodeSide(debit, 'debit'), ...decodeSide(credit, 'credit'),
        },
      });
      setPreview(r.data);
    } catch {
      setPreview(null);
    }
  }, [sideOf]);

  /** بيبدّل الطرفين بخطوتيهم — الرئيسي والفرعي مع بعض، مش الترميز الناتج بس. */
  const swapSides = () => {
    const d = { main: form.getFieldValue('debit_main'), sub: form.getFieldValue('debit_sub') };
    const c = { main: form.getFieldValue('credit_main'), sub: form.getFieldValue('credit_sub') };
    form.setFieldsValue({
      debit_main: c.main, debit_sub: c.sub,
      credit_main: d.main, credit_sub: d.sub,
    });
    refreshPreview();
  };

  const save = async (v: any) => {
    setSaving(true);
    try {
      const body = {
        name: v.name,
        // الفرعي لو اتحدّد، وإلا الرئيسي — وده كل الفرق.
        ...decodeSide(sideOf('debit'), 'debit'),
        ...decodeSide(sideOf('credit'), 'credit'),
        payment_method: v.payment_method || null,
        family: v.family || null,
        cost_center_id: null,
        description: v.description || null,
        sort_order: v.sort_order ?? 0,
        active: v.active !== false,
      };
      if (editing?.id) await api.put(`/api/v1/voucher-keys/${editing.id}`, body);
      else await api.post('/api/v1/voucher-keys', body);
      message.success(editing?.id ? 'المفتاح اتعدّل' : 'المفتاح اتعمل');
      setEditing(null);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذّر حفظ المفتاح');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (k: VoucherKey) => {
    try {
      await api.delete(`/api/v1/voucher-keys/${k.id}`);
      message.success('المفتاح اتشال');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذّر شيل المفتاح');
    }
  };

  /** الأب ← ولاده. اتبنت مرة واحدة عشان مانلفّش على القايمة كلها لكل حساب. */
  const childrenBy = useMemo(() => {
    const m = new Map<number, Account[]>();
    accounts.forEach((a) => {
      if (a.parent_id == null) return;
      m.set(a.parent_id, [...(m.get(a.parent_id) ?? []), a]);
    });
    return m;
  }, [accounts]);

  /**
   * الحسابات الرئيسية.
   *
   * **حساب العميل مش حساب رئيسي، حتى لو مالوش أب.** أول ما عميل يتعمل بيتفتحله حساب
   * و`parent_id` بتاعه بيفضل فاضي؛ مابياخدش أب إلا لما تسوية الشجرة تشتغل وتحطّه تحت
   * «الذمم المدينة». يعني أي عميل اتعمل بعد آخر مرة اتسوّت فيها الشجرة بيبقى بلا أب —
   * ولو قسّمنا على `parent_id` بس، ٢٣٣ عميل بيطلعوا في قايمة الحسابات الرئيسية.
   *
   * والسيرفر عارف كده وبيتعامل معاه (`chart_service.effective_parent_id`)، بس اللي
   * بيتبعت في الـAPI هو العمود الخام. فبنستنّى من الرئيسية أي حساب نوعه بيقول إنه ورقة
   * تحت مجموعة — عميل أو مورد أو عهدة أو خزينة — ونسيب المجموعة نفسها هي اللي في القايمة.
   */
  const mainOptions = useMemo(() => {
    const roots = accounts.filter((a) => a.parent_id == null
      && !OWNED_TYPES.includes(a.account_type || ''));
    return [
      { label: 'حسابات رئيسية', options: roots.map((a) => ({
        value: `a:${a.id}`, label: accLabel(a) })) },
      { label: 'مجموعات', options: GROUPS.map((g) => ({
        value: `g:${g.value}`, label: g.label })) },
    ];
  }, [accounts]);

  /**
   * كل اللي تحت الحساب الرئيسي، على أي عمق.
   *
   * مش الولاد المباشرين بس: الشجرة عندها ممكن تبقى «الذمم المدينة ← فرع ← عميل»، واللي
   * بيدوّر على عميل بعينه عايزه في القايمة مش عايز ينزل درجة درجة.
   */
  const subsOf = useCallback((mainValue?: string) => {
    if (!mainValue) return [];
    // المجموعة حسابها الفرعي هو حسابات نوعها — العملاء تحت «العملاء»، والخزن تحت
    // «الخزينة والبنوك». دي اللي بتخلّي المجموعة تتفتح على اللي جوّاها فعلاً بدل ما
    // تبقى اختيار مقفول.
    if (mainValue.startsWith('g:')) {
      const t = mainValue.slice(2);
      return accounts.filter((a) => (a.account_type || '') === t)
        .map((a) => ({ value: a.id, label: accLabel(a) }));
    }
    if (!mainValue.startsWith('a:')) return [];
    const out: Account[] = [];
    const walk = (id: number) => (childrenBy.get(id) ?? []).forEach((c) => {
      out.push(c);
      walk(c.id);
    });
    walk(Number(mainValue.slice(2)));
    return out.map((a) => ({ value: a.id, label: accLabel(a) }));
  }, [childrenBy, accounts]);

  /** الرئيسي اللي الحساب ده واقع تحته — عشان مفتاح قديم يتفتح على نفس الخطوتين. */
  const rootOf = useCallback((accountId: number): number => {
    let cur = accounts.find((a) => a.id === accountId);
    while (cur && cur.parent_id != null) {
      const up = accounts.find((a) => a.id === cur!.parent_id);
      if (!up) break;
      cur = up;
    }
    return cur?.id ?? accountId;
  }, [accounts]);

  return (
    <Card
      title={<Space><ThunderboltOutlined /> المفاتيح الخاصة</Space>}
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
          <Button icon={<SettingOutlined />} type={manage ? 'primary' : 'default'}
            onClick={() => setManage(!manage)}>
            {manage ? 'خلصت إعداد' : 'إعداد المفاتيح'}
          </Button>
          {/* «مفتاح جديد» بياخد نفس اختصار «جديد» في كل الشاشات — اختصار واحد في النظام كله. */}
          {manage && (
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
              onClick={() => openEditor()}>
              مفتاح جديد
            </Button>
          )}
        </Space>
      )}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="كل مفتاح ربط بين حسابين رئيسيين — دوس عليه واكتب المبلغ بس."
        description="اتجاه الربط هو اللي بيحدد نوع السند: مدين الخزينة ودائن العملاء يبقى سند قبض، والعكس حاجة تانية. السند بيترحّل زي أي سند اتكتب بالإيد."
      />

      <Row style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Input allowClear value={query} prefix={<SearchOutlined />}
            placeholder="بحث بالاسم أو الحساب"
            onChange={(e) => setQuery(e.target.value)} />
        </Col>
      </Row>

      {!loading && !shown.length && (
        <Empty description={keys.length
          ? 'مفيش مفتاح مطابق للبحث'
          : 'مفيش مفاتيح لسه — دوس «إعداد المفاتيح» وابدأ بواحد'} />
      )}

      <Row gutter={[12, 12]}>
        {shown.map((k) => (
          <Col xs={24} sm={12} md={8} lg={6} key={k.id}>
            <Card
              size="small"
              hoverable={!manage}
              onClick={() => (manage ? openEditor(k) : setRunning(k))}
              style={{ height: '100%', cursor: 'pointer',
                opacity: k.active ? 1 : 0.55 }}
            >
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                <div style={{ fontWeight: 600 }}>{k.name}</div>
                <Tag color={KIND_COLORS[k.voucher_kind]}>
                  {KIND_LABELS[k.voucher_kind] || k.voucher_kind}
                </Tag>
              </Space>
              <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                <div>مدين: {k.debit_account_name || '—'}</div>
                <div>دائن: {k.credit_account_name || '—'}</div>
              </div>
              {!k.active && <Tag style={{ marginTop: 6 }}>موقوف</Tag>}
              {manage && (
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" icon={<EditOutlined />}
                    onClick={(e) => { e.stopPropagation(); openEditor(k); }}>تعديل</Button>
                  <Popconfirm
                    title="تشيل المفتاح؟"
                    description="السندات اللي اتعملت منه مش بتتأثر — كل سند مستند لوحده."
                    okText="شيله" cancelText="سيبه"
                    onConfirm={() => remove(k)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                </Space>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <VoucherKeyRunner keyDef={running} world={world}
        onClose={() => setRunning(null)} onPosted={load} />

      <TabModal
        open={editing !== null}
        title={editing?.id ? `تعديل «${editing.name}»` : 'مفتاح جديد'}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="حفظ" cancelText="إلغاء"
        destroyOnHidden width={560}
      >
        <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
          <Form.Item name="name" label="اسم المفتاح"
            rules={[{ required: true, message: 'اكتب اسم المفتاح' }]}>
            <Input placeholder="زي «تحصيل نقدي» أو «إيجار المقر»" />
          </Form.Item>

          {/* الطرفين، كل واحد على خطوتين. الفرعي اختياري — وسطر تحته بيقول كده بالنص
              بدل ما الواحد يجرّب ويشوف. */}
          <SideFields
            side="debit" title="الطرف المدين" hint="اللي بياخد"
            mainOptions={mainOptions} subsOf={subsOf} form={form} onChange={refreshPreview} />

          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <Tooltip title="بدّل المدين بالدائن — الاتجاه بيغيّر نوع السند">
              <Button size="small" icon={<SwapOutlined />} onClick={swapSides}>عكس الاتجاه</Button>
            </Tooltip>
          </div>

          <SideFields
            side="credit" title="الطرف الدائن" hint="اللي بيدي"
            mainOptions={mainOptions} subsOf={subsOf} form={form} onChange={refreshPreview} />

          {/* اللي المفتاح ده هيعمله — جاي من السيرفر عشان ميختلفش عن اللي هيترحّل فعلاً. */}
          {preview && (
            <Alert
              type="success" showIcon style={{ marginBottom: 12 }}
              message={(
                <Space>
                  المفتاح ده هيعمل
                  <Tag color={KIND_COLORS[preview.voucher_kind]}>
                    {KIND_LABELS[preview.voucher_kind] || preview.voucher_kind}
                  </Tag>
                </Space>
              )}
              description={preview.asks.length
                ? `هيسأل عن: ${preview.asks.map((a) => ({
                  customer: 'العميل', supplier: 'المورد', rep: 'المندوب',
                  debit_account: 'الحساب المدين تحت المجموعة',
                  credit_account: 'الحساب الدائن تحت المجموعة',
                } as Record<string, string>)[a] || a).join('، ')} — والمبلغ`
                : 'مش هيسأل غير عن المبلغ.'}
            />
          )}

          <Form.Item name="payment_method" label="طريقة الدفع (اختياري)">
            <Select allowClear placeholder="سيبها فاضية عشان يسأل كل مرة" options={[
              { value: 'cash', label: 'نقدي' },
              { value: 'bank', label: 'تحويل بنكي' },
              { value: 'cheque', label: 'شيك' },
            ]} />
          </Form.Item>
          <Form.Item name="family" label="العيلة (اختياري)"
            tooltip="لو المفتاح ده لخط منتجات بعينه — سيبها فاضية عشان السند يمشي على كل المديونية">
            <Input placeholder="أبيض / بولي" />
          </Form.Item>
          <Form.Item name="description" label="البيان الجاهز (اختياري)">
            <Input placeholder="بيتكتب في السند وينفع يتعدّل وقت الترحيل" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="sort_order" label="الترتيب">
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="active" label="شغّال" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </TabModal>
    </Card>
  );
}
