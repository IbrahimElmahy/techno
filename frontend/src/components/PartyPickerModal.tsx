import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Col, DatePicker, Empty, Form, Input, Row, Select, Space, Spin, Tag, message,
} from 'antd';
import { InputNumber } from './NumberInput';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { normalizeAr } from './ListToolbar';
import { useLookup } from '../hooks/useLookup';
import { TabModal } from './TabModal';
import { keepInView } from '../utils/keepInView';

/**
 * اختيار الطرف — the first step of every sale/purchase document.
 *
 * Two things this solves that a plain dropdown could not: the list is long enough to need real
 * search and a branch filter, and a party that does not exist yet can be created **without
 * leaving the half-filled document** — walking away to the customers screen used to lose the
 * lines already entered.
 *
 * It also carries the document DATE when asked to (`date` + `onDateChange`), because that is how
 * the system this client is migrating from opens a document: one step that asks who it is for and
 * when, and then the invoice is on screen. We used to ask the date in a modal of its own and the
 * party in another — two dialogs to answer two questions that are the same decision, and two
 * things to dismiss before typing the first line.
 */

export type PartyKind = 'customer' | 'supplier';

export interface Party {
  id: number;
  name: string;
  phone?: string | null;
  address?: string | null;
  branch_id?: number | null;
  balance?: string | null;
}

const KIND_LABEL: Record<PartyKind, string> = { customer: 'العميل', supplier: 'المورد' };

/** شرايح السعر — نفس القايمة اللي في `useLookup` عشان الأسماء ما تتفرّقش. */
const PRICE_TIERS = [
  { value: 'commercial', label: 'تجاري' },
  { value: 'semi_commercial', label: 'نصف تجاري' },
  { value: 'wholesale', label: 'جملة' },
  { value: 'semi_wholesale', label: 'نصف جملة' },
  { value: 'consumer', label: 'مستهلك' },
];
const KIND_ENDPOINT: Record<PartyKind, string> = {
  customer: '/api/v1/customers',
  supplier: '/api/v1/suppliers',
};

export default function PartyPickerModal({
  open, kind, onPick, onCancel, date, onDateChange, kinds, title,
}: {
  open: boolean;
  /** التصنيف اللي البوباب بيفتح عليه. */
  kind: PartyKind;
  onPick: (party: Party) => void;
  onCancel: () => void;
  /** Pass both to show the document date here. Omit them and the picker is just a picker — which
   *  is what it still is when a document that already has a date changes its party. */
  date?: Dayjs;
  onDateChange?: (d: Dayjs) => void;
  /**
   * التصنيفات اللي ينفع تتنقّل بينها جوّه البوباب — «العملاء» و«الموردين».
   *
   * The system this client is migrating from opens a document with one dialog carrying a تصنيف
   * list, so the person can look in the other book without closing what they started. Omit it and
   * the picker stays fixed on `kind`, which is right for a screen that only ever has one answer.
   */
  kinds?: PartyKind[];
  title?: string;
}) {
  // التصنيف الحالي — بيبدأ من اللي الشاشة فتحت بيه وبيرجعله كل مرة تتفتح.
  const [activeKind, setActiveKind] = useState<PartyKind>(kind);
  useEffect(() => { if (open) setActiveKind(kind); }, [open, kind]);
  const [parties, setParties] = useState<Party[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  // A customer must be assigned to a rep and a territory — they are asked for inline so the
  // quick-create stays a genuine shortcut rather than a form that fails on submit.
  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  /** تصنيفات العملاء من قايمة الإعدادات — كانت حالة معرّفة ومفيش حاجة بتملاها، فالقايمة
   *  كانت بتفضل فاضية والفورم بيقع على قايمة مكتوبة في الكود. */
  const { options: customerTypes } = useLookup('customer_type');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState<number | undefined>();
  // The highlighted row. The list opens with the first one lit so Enter has something to answer
  // and the arrows have somewhere to move from — the same as «اختر الصنف» a step later.
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, bRes, uRes, tRes] = await Promise.all([
        api.get(KIND_ENDPOINT[activeKind]),
        api.get('/api/v1/branches').catch(() => ({ data: [] })),
        activeKind === 'customer' ? api.get('/api/v1/users').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        activeKind === 'customer' ? api.get('/api/v1/territories').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);
      setParties(pRes.data);
      setBranches(bRes.data || []);
      setReps((uRes.data || []).filter((u: any) => u.role === 'sales_rep'));
      setTerritories(tRes.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { if (open) { load(); setQuery(''); setCreating(false); } }, [open, activeKind]);

  const visible = useMemo(() => {
    const needle = normalizeAr(query);
    return parties.filter((p) => {
      if (branchId && p.branch_id !== branchId) return false;
      if (!needle) return true;
      return normalizeAr(p.name).includes(needle) || normalizeAr(p.phone).includes(needle);
    });
  }, [parties, query, branchId]);

  // Back to the top when the list changes, and never past its end.
  useEffect(() => { setCursor(0); }, [query, branchId, open]);
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(visible.length - 1, 0)));
  }, [visible.length]);
  // القايمة بس هي اللي بتتحرك — شوف `keepInView`.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    keepInView(rowRefs.current[cursor], listRef.current);
  }, [cursor, visible.length]);

  /** ↑↓ to move, Enter to take the highlighted one — the same keys as «اختر الصنف», so the two
   *  steps of opening a document are driven identically. */
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setCursor((c) => Math.min(c + 1, visible.length - 1));
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && visible[cursor]) { e.preventDefault(); onPick(visible[cursor]); }
  };

  /** Create the party inline and hand it straight back — the document keeps everything it had. */
  const handleCreate = async (values: any) => {
    setSaving(true);
    try {
      // كل الحقول اللي في الفورم بتتبعت. الفاضي بيتبعت `undefined` مش `''` — الفرق إن
      // «مااتكتبش» بيفضل NULL في الداتا بدل نص فاضي، وده اللي بيخلّي التقارير تعرف تفرّق.
      const payload: any = {
        name: values.name,
        phone: values.phone || undefined,
        branch_id: values.branch_id ?? undefined,
        email: values.email || undefined,
        tax_number: values.tax_number || undefined,
        commercial_register: values.commercial_register || undefined,
        address: values.address || undefined,
      };
      if (activeKind === 'customer') {
        payload.customer_type = values.customer_type || 'تاجر';
        payload.rep_id = values.rep_id;
        payload.territory_id = values.territory_id;
        payload.default_price_tier = values.default_price_tier || undefined;
        // فاضي معناه «مافيش اتفاق»، وصفر معناه «فيه اتفاق وهو صفر». التفرقة دي هي سبب إن
        // العمودين دول بيقبلوا NULL أصلاً.
        payload.discount_pct = values.discount_pct ?? undefined;
        payload.vat_pct = values.vat_pct ?? undefined;
      }
      const res = await api.post(KIND_ENDPOINT[activeKind], payload);
      message.success(`تم إنشاء ${KIND_LABEL[activeKind]} بنجاح`);
      onPick({ id: res.data.id, name: res.data.name, phone: res.data.phone ?? null,
               address: res.data.address ?? null, balance: '0' });
      createForm.resetFields();
      setCreating(false);
    } catch (err) {
      console.error(err);
    } finally { setSaving(false); }
  };

  return (
    <>
    <TabModal
      open={open} onCancel={onCancel} width={780} centered destroyOnHidden
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{title ?? 'انشاء'}</span>
          {/* زرار إنشاء لكل تصنيف — في الترويسة زي الشاشة اللي العميل شغّال عليها، مش في
              الفوتر. الضغط بيفتح الفورم على التصنيف بتاعه على طول. */}
          {!creating && (kinds ?? [kind]).map((k) => (
            <Button key={k} size="small" icon={<PlusOutlined />}
              onClick={() => { setActiveKind(k); setCreating(true); }}>
              {k === 'customer' ? 'عميل جديد' : 'مورد جديد'}
            </Button>
          ))}
        </div>
      )}
      footer={<Button onClick={onCancel}>إغلاق</Button>}
    >
      <Row gutter={12}>
        {/*
          * عمود الفلاتر يمين والنتايج شمال — نفس تقسيم الشاشة اللي العميل شغّال عليها.
          *
          * كان الفلاتر شريط فوق والقايمة تحته، فالقايمة بتاخد عرض الشاشة كله وارتفاع أقل.
          * القايمة هنا هي الشغل، فبتاخد المساحة الطولية، والفلاتر بتقعد جنبها ثابتة بدل ما
          * تاكل من ارتفاعها.
          */}
        <Col xs={24} md={8}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 2 }}>الفرع</div>
              <Select allowClear style={{ width: '100%' }} placeholder="كل الفروع"
                value={branchId} onChange={(v) => setBranchId(v)}
                options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
            </div>

            {date && onDateChange && (
              <div>
                <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 2 }}>التاريخ</div>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  value={date} onChange={(v) => v && onDateChange(v)} />
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 2 }}>البحث</div>
              <Input allowClear autoFocus prefix={<SearchOutlined />}
                placeholder="بالاسم أو الهاتف"
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey} />
            </div>

            {/* تصنيف — بيتنقّل بين دفتر العملاء ودفتر الموردين من غير ما البوباب يتقفل. */}
            {(kinds?.length ?? 0) > 1 && (
              <div>
                <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 2 }}>تصنيف</div>
                <div style={{ border: '1px solid #f0f0f0', borderRadius: 8,
                              overflow: 'hidden' }}>
                  {(kinds ?? []).map((k) => (
                    <div key={k} onClick={() => setActiveKind(k)}
                      style={{
                        padding: '8px 12px', cursor: 'pointer', textAlign: 'center',
                        borderTop: '1px solid #f5f5f5',
                        background: k === activeKind ? '#eaf5e2' : '#fff',
                        fontWeight: k === activeKind ? 700 : 400,
                      }}>
                      {k === 'customer' ? 'العملاء' : 'الموردين'}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {date && (
              <div style={{ color: '#6b6b6b', fontSize: 12 }}>
                التاريخ ده بيتسجّل على الفاتورة وعلى قيدها المحاسبي — يعني الفاتورة والدفاتر
                بيقعوا في نفس اليوم.
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} md={16}>
          <div ref={listRef} style={{ height: 420, overflowY: 'auto', border: '1px solid #f0f0f0',
                        borderRadius: 8 }} onKeyDown={onListKey}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
            ) : visible.length === 0 ? (
              <Empty description="لا توجد نتائج — استخدم زر الإنشاء بالأعلى"
                style={{ margin: '32px 0' }} />
            ) : visible.map((party, i) => (
              <div key={party.id} onClick={() => onPick(party)}
                ref={(el) => { rowRefs.current[i] = el; }}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 8, padding: '10px 14px', cursor: 'pointer',
                  borderTop: '1px solid #f5f5f5',
                  background: i === cursor ? '#eaf5e2' : undefined,
                  boxShadow: i === cursor ? 'inset 2px 0 0 #6AB42D' : undefined,
                }}>
                <Space size={12}>
                  {party.phone && (
                    <span style={{ color: '#6b6b6b', fontSize: 12 }}>{party.phone}</span>)}
                  {party.balance != null && Number(party.balance) !== 0 && (
                    <Tag color={Number(party.balance) > 0 ? 'red' : 'green'}>
                      {Number(Math.abs(Number(party.balance))).toLocaleString('ar-EG',
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م
                    </Tag>
                  )}
                </Space>
                <b>{party.name}</b>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, color: '#6b6b6b', fontSize: 12 }}>
            {visible.length} من {parties.length} · ↑↓ للتنقل · Enter للاختيار
          </div>
        </Col>
      </Row>
    </TabModal>

    {/*
      * «عميل جديد» بوباب فوق البوباب — مش بديل عنه.
      *
      * كان بيحل محل القايمة جوّه نفس النافذة: تدوس «عميل جديد» فالقايمة تختفي، وترجع تلاقي
      * البحث اللي كنت كاتبه اتمسح. النافذة اللي فوق بتسيب اللي تحتها زي ما هو، فالرجوع بيرجّعك
      * لنفس المكان بالظبط.
      *
      * والفوتر فيه «حفظ واختيار»: الطرف الجديد بيتحفظ وبيترد على المستند على طول، من غير ما
      * تدوّر عليه في القايمة بعد ما تحفظه.
      */}
    <TabModal
      open={creating} onCancel={() => setCreating(false)} width={860} centered destroyOnHidden
      title={activeKind === 'customer' ? 'عميل جديد' : 'مورد جديد'}
      footer={(
        <Space>
          <Button type="primary" loading={saving}
            onClick={() => createForm.submit()}>حفظ واختيار</Button>
          <Button onClick={() => setCreating(false)}>تراجع</Button>
        </Space>
      )}
    >
      <Form form={createForm} layout="vertical" onFinish={handleCreate}
        requiredMark={false}>
        {/*
          * فورم الإنشاء بنفس حقول وترتيب الشاشة اللي العميل شغّال عليها.
          *
          * كان فيه الاسم والهاتف والمندوب وبس. وباقي الحقول — الفرع، الإيميل، الرقم الضريبي،
          * السجل التجاري، العنوان، السعر الافتراضي، الخصم، ض.م — كانت **موجودة في السيرفر من
          * زمان** ومفيش طريق يوصلها من هنا: تعمل العميل من جوّه الفاتورة، وبعدين تسيب شغلك
          * وتفتح شاشة العملاء عشان تكمّل بياناته.
          *
          * العميل تلات حقول في الصف والمورد تلاتة كمان — نفس التقسيم اللي في شاشته.
          */}
        <Row gutter={12}>
          {activeKind === 'customer' ? (
            <>
              <Col xs={24} md={8}>
                <Form.Item name="branch_id" label="الفرع" style={{ marginBottom: 10 }}>
                  <Select allowClear placeholder="الفرع"
                    options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="rep_id" label="مندوب"
                  rules={[{ required: true, message: 'المندوب مطلوب' }]}
                  style={{ marginBottom: 10 }}>
                  <Select showSearch optionFilterProp="label" placeholder="اختر المندوب"
                    options={reps.map((r: any) => ({
                      value: r.id, label: r.full_name || r.username }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="default_price_tier" label="السعر الافتراضي"
                  style={{ marginBottom: 10 }}>
                  <Select allowClear placeholder="مستهلك" options={PRICE_TIERS} />
                </Form.Item>
              </Col>
            </>
          ) : (
            <Col xs={24} md={8}>
              <Form.Item name="branch_id" label="الفرع" style={{ marginBottom: 10 }}>
                <Select allowClear placeholder="الفرع"
                  options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
          )}

          <Col xs={24} md={8}>
            <Form.Item name="name" label="الاسم"
              rules={[{ required: true, message: 'الاسم مطلوب' }]}
              style={{ marginBottom: 10 }}>
              <Input autoFocus placeholder={`اسم ${KIND_LABEL[activeKind]}`} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="email" label="البريد الالكترونى" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="tax_number" label="الرقم الضريبي" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="commercial_register" label="السجل التجاري"
              style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="address" label="العنوان" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="phone" label="الهاتف" style={{ marginBottom: 10 }}>
              <Input placeholder="اختياري" />
            </Form.Item>
          </Col>

          {activeKind === 'customer' && (
            <>
              <Col xs={24} md={8}>
                {/* فاضي = مافيش اتفاق؛ صفر = فيه اتفاق وهو صفر. */}
                <Form.Item name="discount_pct" label="خصم %" style={{ marginBottom: 10 }}>
                  <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.5}
                    placeholder="—" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="vat_pct" label="ض.م %" style={{ marginBottom: 10 }}>
                  <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.5}
                    placeholder="—" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                {/* المنطقة مش في شاشته، بس السيرفر عندنا بيطلبها على العميل — من غيرها
                    الحفظ بيترفض، فبتتسأل هنا بدل ما الفورم يقع عند الحفظ. */}
                <Form.Item name="territory_id" label="المنطقة"
                  rules={[{ required: true, message: 'المنطقة مطلوبة' }]}
                  style={{ marginBottom: 10 }}>
                  <Select showSearch optionFilterProp="label" placeholder="اختر المنطقة"
                    options={territories.map((t: any) => ({ value: t.id, label: t.name }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="customer_type" label="التصنيف" style={{ marginBottom: 10 }}>
                  <Select allowClear placeholder="تاجر"
                    options={customerTypes} />
                </Form.Item>
              </Col>
            </>
          )}
        </Row>
      </Form>
    </TabModal>
    </>
  );
}
