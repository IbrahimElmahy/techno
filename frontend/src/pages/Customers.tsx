import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Button, Checkbox, Col, Divider, Form, Input, Modal, Row, Select, Space, Tag, Tooltip, message,
} from 'antd';
// فلتر على كل عمود — شوف `FilterTable`.
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import {
  UserAddOutlined, PlusOutlined, MinusCircleOutlined, EyeOutlined, StopOutlined,
  SearchOutlined, ClearOutlined, DeleteOutlined, TeamOutlined, EditOutlined,
  LoadingOutlined, CheckCircleFilled,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import { useNavigate } from 'react-router-dom';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import ListPage, { type ListTab } from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { money, numeralsLocale } from '../utils/money';
import { useLiveRefresh } from '../utils/live';
interface CustomerRecord {
  id: number;
  code: string;
  name: string;
  customer_type: string; // admin-configurable via Settings (013)
  phone: string | null;
  phones: string[] | null;
  governorate_id: number | null;
  markaz: string | null;
  address: string | null;
  rep_id: number | null;
  service_rep_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  territory_id: number;
  default_price_tier: string | null;
  active: boolean;
  balance?: string | null;   // receivable balance, sent with the list (one grouped query)
  // Card fields read off their العملاء form (031).
  branch_id: number | null;
  email: string | null;
  tax_number: string | null;
  commercial_register: string | null;
  discount_pct: string | null;
  vat_pct: string | null;
  is_cash: boolean;
}

interface Filters {
  q?: string;
  customer_type?: string;
  rep_id?: number;
  service_rep_id?: number;
  territory_id?: number;
  governorate_id?: number;
  active?: boolean;
  balance_filter?: string;
}

interface Governorate {
  id: number;
  name: string;
}

const TYPE_LABELS: Record<string, string> = {
  trader: 'تاجر / موزع',
  plumber: 'فني سباكة',
  other: 'آخر',
};

const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري',
  semi_commercial: 'نصف تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نصف جملة',
  consumer: 'مستهلك',
};

// Dynamic list of EXTRA phone numbers (the primary `phone` field stays separate).
const ExtraPhonesList = () => (
  <Form.List name="phones">
    {(fields, { add, remove }) => (
      <>
        <div style={{ marginBottom: 8 }}>أرقام هاتف إضافية</div>
        {fields.map((field) => (
          <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
            <Form.Item {...field} style={{ marginBottom: 0, flex: 1 }}>
              <Input placeholder="مثال: 01000000000" style={{ width: 330 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(field.name)} />
          </Space>
        ))}
        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
            إضافة رقم
          </Button>
        </Form.Item>
      </>
    )}
  </Form.List>
);

// ---- تعديل بيانات العملاء من الجدول (نفس فكرة «تعديل الأسعار والخصم» في الأصناف) ----
// كل خانة بتحفظ لوحدها لما تسيبها؛ لو السيرفر رفض الرسالة بتطلع من `api/client.ts`
// والخانة بترجع لقيمتها. معرّفين برّه الصفحة عشان المؤشر مايطيرش مع كل رندر.
type CellStatus = 'idle' | 'saving' | 'saved';

const CellStatusIcon = ({ status }: { status: CellStatus }) => (
  <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center', flex: 'none' }}>
    {status === 'saving' && <LoadingOutlined style={{ fontSize: 11 }} />}
    {status === 'saved' && <CheckCircleFilled style={{ fontSize: 11, color: '#52c41a' }} />}
  </span>
);

const useCellStatus = () => {
  const [status, setStatus] = useState<CellStatus>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = async (save: () => Promise<void>) => {
    setStatus('saving');
    try {
      await save();
      setStatus('saved');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setStatus('idle'), 1800);
    } catch (err) {
      setStatus('idle');
      throw err;
    }
  };
  return { status, run };
};

// تليفون مصري بشكل متساهل: أرقام بس (و+ في الأول)، والموبايل اللي بيبدأ بـ01 لازم ١١ رقم.
const phoneError = (digits: string): string | null => {
  if (!digits) return null;
  if (!/^\+?\d{6,15}$/.test(digits)) return 'رقم التليفون أرقام بس (من ٦ لـ١٥ رقم)';
  if (/^01/.test(digits) && digits.length !== 11) return 'رقم الموبايل لازم ١١ رقم ويبدأ بـ01';
  return null;
};

const InlineTextCell = ({
  value, gridCol, placeholder, normalize, validate, onCommit,
}: {
  value: string | null;
  gridCol: string;
  placeholder?: string;
  normalize?: (v: string) => string;
  validate?: (v: string) => string | null;
  onCommit: (v: string) => Promise<void>;
}) => {
  const [draft, setDraft] = useState(value ?? '');
  const { status, run } = useCellStatus();
  // آخر قيمة اتبعتت — Enter وبعده blur على نفس الخانة مايبعتوش مرتين.
  const committed = useRef(value ?? '');

  useEffect(() => {
    if (status === 'saving') return;
    committed.current = value ?? '';
    setDraft(value ?? '');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    const v = normalize ? normalize(draft) : draft.trim();
    if (v === committed.current) { setDraft(committed.current); return; }
    const err = validate?.(v);
    if (err) {
      message.warning(err);
      setDraft(committed.current);
      return;
    }
    const previous = committed.current;
    committed.current = v;
    setDraft(v);
    try {
      await run(() => onCommit(v));
    } catch {
      committed.current = previous;
      setDraft(previous);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Input
        data-grid-col={gridCol}
        size="small"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(committed.current);
        }}
        // الأيقونة دايماً موجودة: تغيير `suffix` من لا حاجة لحاجة بيعيد بناء الخانة.
        suffix={<CellStatusIcon status={status} />}
      />
    </div>
  );
};

// القايمة بتحفظ أول ما تختار — مافيش «سيب الخانة».
const InlineSelectCell = ({
  value, options, onCommit,
}: {
  value: number | null;
  options: { value: number; label: string }[];
  onCommit: (v: number) => Promise<void>;
}) => {
  const [current, setCurrent] = useState<number | null>(value);
  const { status, run } = useCellStatus();
  useEffect(() => {
    if (status !== 'saving') setCurrent(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = async (v: number) => {
    if (v === current) return;
    const previous = current;
    setCurrent(v);
    try {
      await run(() => onCommit(v));
    } catch {
      setCurrent(previous);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Select
        size="small"
        showSearch
        style={{ flex: 1, minWidth: 0 }}
        popupMatchSelectWidth={false}
        value={current ?? undefined}
        placeholder="—"
        disabled={status === 'saving'}
        filterOption={searchFilter} filterSort={searchRank}
        options={options}
        onChange={onChange}
      />
      <CellStatusIcon status={status} />
    </div>
  );
};

// The list endpoint now carries each customer's balance (one grouped query on the server),
// so the grid no longer fires a request per row.
const CustomerBalance = ({ value }: { value?: string | null }) => {
  const n = Number(value || 0);
  const color = n > 0 ? '#cf1322' : n < 0 ? '#1677ff' : undefined;
  return <span style={{ fontWeight: 'bold', color }}>{money(n)}</span>;
};

export default function Customers() {
  const { options: typeOptions } = useLookup('customer_type');
  const typeLabels = labelMap(typeOptions);
  // الملّاك ليهم شاشتهم («الملّاك» في ما بعد البيع) — التصنيف ده مايظهرش هنا
  // لا في الفلتر ولا في فورم الإنشاء/التعديل.
  const customerTypeOptions = useMemo(
    () => typeOptions.filter((o) => o.value !== 'owner'),
    [typeOptions],
  );
  interface CustomersSummary {
    total_count: number;
    debtors_count: number;
    total_debt: number;
  }

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [serviceReps, setServiceReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [governorates, setGovernorates] = useState<Governorate[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  // بيفتح على «نشط»: الكشف فيه ٦٢٣ كارت معطّل — خط بولي مدموج وأطراف ما بعد البيع
  // اللي مالهاش ولا حركة — وعرضهم افتراضياً بيدّي نفس الراجل مرتين ويغرّق الكشف.
  // الفلتر فوق لسه فيه «معطل» و«الكل» لمن يحتاجهم.
  // شريحة الحالة في الرابط (`?tab=`): الفلتر بيبدأ منها عند الفتح عشان الريفرش يرجع عليها.
  const [listTab, setListTab] = useQueryTab('active');
  const [filters, setFilters] = useState<Filters>(() => ({
    active: listTab === 'all' ? undefined : listTab !== 'inactive',
  }));
  const [search, setSearch] = useState('');           // typed text, applied on Enter/button
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [summaryData, setSummaryData] = useState<CustomersSummary>({
    total_count: 0,
    debtors_count: 0,
    total_debt: 0,
  });
  const navigate = useNavigate();

  const [form] = Form.useForm();
  const { user: currentUser, can } = useAuth();

  // «تعديل بيانات العملاء» — نفس صلاحية فورم التعديل. المنطقة بتتغيّر من مسار النقل
  // (`/reassign`) فليها صلاحيتها.
  const canEditCustomers = can('customer.write');
  const canEditTerritory = can('customer.reassign');
  const [editModeRaw, setEditMode] = useState(false);
  const editMode = editModeRaw && canEditCustomers;
  // الـblur الأول بيحفظ اللي اتكتب قبل ما الخانات تختفي.
  const leaveEditMode = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setEditMode(false);
  };
  const mergeRow = (id: number, data: Partial<CustomerRecord>) =>
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...data } : c)));
  // PATCH جزئي: اللي مااتبعتش مابيتلمسش (الأرقام الإضافية والخصم والمندوب…).
  const saveField = async (r: CustomerRecord, body: Partial<CustomerRecord>) => {
    const res = await api.patch(`/api/v1/customers/${r.id}`, body);
    mergeRow(r.id, {
      phone: res.data.phone, governorate_id: res.data.governorate_id, markaz: res.data.markaz,
    });
  };
  // المنطقة من غير مندوب جديد — السيرفر بيسيب المندوب زي ما هو.
  const saveTerritory = async (r: CustomerRecord, territoryId: number) => {
    const res = await api.post(`/api/v1/customers/${r.id}/reassign`, {
      new_territory_id: territoryId,
    });
    mergeRow(r.id, { territory_id: res.data.territory_id, rep_id: res.data.rep_id });
  };

  const loadSummary = async (activeFilters = filters) => {
    try {
      const params: any = {};
      Object.entries(activeFilters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      const res = await api.get<CustomersSummary>('/api/v1/customers/summary', { params });
      setSummaryData({
        total_count: Number(res.data.total_count || 0),
        debtors_count: Number(res.data.debtors_count || 0),
        total_debt: Number(res.data.total_debt || 0),
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Filtering happens on the server so it covers ALL customers, not just the loaded page.
  const fetchCustomers = async (
    override?: Filters, targetPage = page, targetPageSize = pageSize, opts?: { silent?: boolean },
  ) => {
    const active = override ?? filters;
    // الهادي (التحديث الحي): نفس الفلاتر ونفس الصفحة، من غير سبينر.
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const params: any = {
        limit: targetPageSize,
        offset: (targetPage - 1) * targetPageSize,
      };
      Object.entries(active).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      const res = await api.get('/api/v1/customers', { params });
      if (Array.isArray(res.data)) {
        setCustomers(res.data);
        const headerTotal = res.headers['x-total-count'];
        setTotalCount(headerTotal ? Number(headerTotal) : res.data.length);
      } else {
        setCustomers(res.data.rows || []);
        setTotalCount(Number(res.data.total || 0));
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  };
  // عميل اتضاف من التطبيق، أو فاتورة/سند غيّر مديونيته ⇒ الصفحة الحالية والإجماليات
  // يتحدّثوا. مودال التعديل فورمه لوحده فمابيتلمسش.
  useLiveRefresh(['customers', 'sales', 'vouchers', 'cheques'], () => {
    fetchCustomers(undefined, page, pageSize, { silent: true });
    loadSummary();
  });

  const setFilter = (key: keyof Filters, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
    fetchCustomers(next, 1, pageSize);
    loadSummary(next);
  };

  // الخروج من الخانة من غير تعديل كان بيعيد الكشف والإجماليات كل مرة.
  const applySearch = () => {
    const q = search.trim() || undefined;
    if (q !== filters.q) setFilter('q', q);
  };

  // المسح بيرجّع الشاشة زي ما بتفتح (على «نشط») — كان بيفضّي كل حاجة فبيطلع المعطلين
  // الـ٦٢٣ اللي الفتح الافتراضي قاصد يخبيهم، وفلتر «الحالة» فوق فاضي كأنه مش مفلتر.
  const resetFilters = () => {
    const initial: Filters = { active: true };
    setSearch('');
    setFilters(initial);
    setPage(1);
    fetchCustomers(initial, 1, pageSize);
    loadSummary(initial);
  };

  const handlePageChange = (newPage: number, newPageSize: number) => {
    setPage(newPage);
    setPageSize(newPageSize);
    fetchCustomers(filters, newPage, newPageSize);
  };

  const governorateOptions = useMemo(
    () => governorates.map((g) => ({ value: g.id, label: g.name })), [governorates]);
  const territoryOptions = useMemo(
    () => territories.map((t) => ({ value: t.id, label: t.name })), [territories]);

  const fetchLookups = async () => {
    try {
      const [usersRes, territoriesRes, governoratesRes, branchesRes] = await Promise.all([
        api.get('/api/v1/users'),
        api.get('/api/v1/territories'),
        api.get('/api/v1/governorates'),
        api.get('/api/v1/branches'),
      ]);
      // القوايم مرتّبة أبجدي من الأول — القايمة المقفولة بتعرض بترتيبها قبل ما حد يكتب.
      const byName = (r: any) => r.full_name || r.name;
      setReps(sortByName(usersRes.data.filter((u: any) => u.role === 'sales_rep'), byName));
      // مندوب الخدمة دوره `after_sales_staff` مش `sales_rep` — قايمة تانية خالص.
      setServiceReps(sortByName(
        usersRes.data.filter((u: any) => u.role === 'after_sales_staff'), byName));
      setTerritories(sortByName(territoriesRes.data || [], byName));
      setGovernorates(sortByName(governoratesRes.data || [], byName));
      setBranches(sortByName(branchesRes.data || [], byName));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCustomers();
    loadSummary();
    fetchLookups();
  }, []);

  // Form.List rows can be blank/undefined; only send real numbers.
  const cleanPhones = (phones: any): string[] =>
    (phones || []).map((p: any) => (p || '').trim()).filter(Boolean);

  const onCreateCustomer = async (values: any) => {
    try {
      const { hidden, ...rest } = values;
      const created = await api.post('/api/v1/customers', {
        ...rest,
        governorate_id: values.governorate_id ?? null,
        markaz: values.markaz ?? null,
        address: values.address ?? null,
        // Left blank stays blank, not zero: «مفيش اتفاق» and «الاتفاق صفر» are different facts,
        // and the server keeps them apart only if the screen does too.
        discount_pct: values.discount_pct ?? null,
        vat_pct: values.vat_pct ?? null,
        is_cash: !!values.is_cash,
        phones: cleanPhones(values.phones),
      });
      // «مخفي» is a state a customer is put into, not one he is born in, so it is a separate edit.
      if (hidden && created.data?.id) {
        await api.patch(`/api/v1/customers/${created.data.id}`, { active: false });
      }
      message.success('تم تسجيل العميل بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };



  const onDeactivate = (record: CustomerRecord) => {
    showDeactivationConfirm({
      title: 'إلغاء تفعيل العميل',
      content: `هل أنت متأكد من إلغاء تفعيل العميل "${record.name}"؟`,
      onOk: async () => {
        try {
          await api.delete(`/api/v1/customers/${record.id}`);
          message.success('تم إلغاء تفعيل العميل');
          fetchCustomers();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Permanent delete. The server refuses when the customer has any movement (invoices,
  // receipts, ledger lines…) and tells the user to deactivate instead.
  const onDelete = async (record: CustomerRecord) => {
    // بينفّذ من غير سؤال — التأكيدات اتشالت بطلب صاحب النظام. السيرفر لسه بيرفض
    // حذف العميل اللي عليه حركة وبيقول استعمل «إلغاء التفعيل»، فالحارس مكانه
    // وهو شغّال؛ اللي اتشال هو السؤال.
    try {
      await api.delete(`/api/v1/customers/${record.id}?hard=true`);
      message.success('تم حذف العميل');
      fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };

  // Their seven columns, in their order — `رقم · الفرع · الاسم · الهاتف · مندوب · محافظه ·
  // مدينة` — plus the balance, and that is the whole table. It fits the screen, which is the
  // point: a list you have to drag sideways to read is one where the number you came for is
  // never on screen beside the name you looked it up by.
  //
  // What we have and they do not has NOT been dropped — تصنيف، المنطقة and الفئة السعرية moved
  // into the expanded row, «مخفي» is a tag on the name, and the actions became the three icons
  // their own rows use. Nothing left the screen; it stopped costing a column.
  const columns = [
    {
      title: 'رقم',
      dataIndex: 'code',
      key: 'code',
      width: 110,
      render: (code: string) => <Tag color="blue">{code}</Tag>,
    },
    {
      title: 'الفرع',
      dataIndex: 'branch_id',
      key: 'branch_id',
      ellipsis: true,
      render: (bId: number | null) => {
        const branch = branches.find((b) => b.id === bId);
        return branch ? branch.name : '-';
      },
    },
    {
      title: 'الاسم',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: CustomerRecord) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {!record.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      // «النوع» كان مدفون في السطر المتوسّع. النوع بيحدد الشغل نفسه — مين بيشتري
      // ومين الكوبون بيرجع منه — فمكانه عمود. (المالك خرج من الكشف خالص:
      // شاشة «الملّاك» في ما بعد البيع.)
      title: 'النوع',
      dataIndex: 'customer_type',
      key: 'customer_type',
      width: 90,
      sorter: (a: CustomerRecord, b: CustomerRecord) =>
        String(a.customer_type || '').localeCompare(String(b.customer_type || '')),
      render: (t: string) => {
        const label = typeLabels[t] || TYPE_LABELS[t] || t;
        if (!label) return '-';
        const color = t === 'plumber' ? 'blue' : t === 'owner' ? 'gold' : 'default';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: 'الهاتف',
      dataIndex: 'phone',
      key: 'phone',
      width: 125,
      render: (phone: string | null, r: CustomerRecord) => (editMode
        ? <InlineTextCell gridCol="phone" value={phone} placeholder="01000000000"
            normalize={(v) => v.replace(/[\s-]/g, '')} validate={phoneError}
            onCommit={(v) => saveField(r, { phone: v })} />
        : phone || '-'),
    },
    {
      title: 'مندوب البيع',
      dataIndex: 'rep_id',
      key: 'rep_id',
      ellipsis: true,
      // فاضي مقصود: السباك والمالك مالهمش مندوب بيع — إحنا بنبيع للتجار بس.
      // شرطة بتقول «مافيش»؛ «مندوب #null» كانت بتقول إن فيه مندوب واحنا مش لاقينه.
      render: (repId: number | null) => {
        if (!repId) return '—';
        const rep = reps.find((r) => r.id === repId);
        return rep ? rep.full_name : `مندوب #${repId}`;
      },
    },
    {
      /**
       * **الطرف ده مورد كمان.**
       *
       * الراجل اللي بنشتري منه وبنبيع له كارتين عندنا وكارت واحد عند a5 — والنتيجة إن
       * «هو عليه كام؟» ليها إجابتين مالهمش طريق يتجمعوا. العمود ده بيقول الحقيقة على
       * السطر: الكارت ده مربوط بكارت مورد، وده اسمه.
       *
       * مخفي افتراضياً زي أي عمود مالوش قيمة لأغلب الصفوف — بيتفتح من «الأعمدة» لما
       * اللي بيراجع يبقى بيدوّر عليه.
       */
      title: 'مورد كمان',
      dataIndex: 'supplier_name',
      key: 'supplier_name',
      ellipsis: true,
      render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : '—'),
    },
    {
      // عمود تاني مش نفس العمود: الاتنين بيزوروا نفس العميل ومش نفس الراجل —
      // واحد بيبيع له والتاني بيعاين عنده وياخد منه الكوبونات. جمعهم في خانة
      // واحدة بيخلّي تقرير المناديب يحسب الاتنين على نفس الشغل.
      title: 'مندوب الخدمة',
      dataIndex: 'service_rep_id',
      key: 'service_rep_id',
      ellipsis: true,
      render: (id: number | null) => {
        if (!id) return '—';
        const rep = serviceReps.find((r) => r.id === id) || reps.find((r) => r.id === id);
        return rep ? rep.full_name : `مندوب #${id}`;
      },
    },
    {
      title: 'محافظه',
      dataIndex: 'governorate_id',
      key: 'governorate_id',
      ellipsis: true,
      render: (gId: number | null, r: CustomerRecord) => {
        // مافيش «مسح» للمحافظة: الـPATCH بيعتبر الفاضي «من غير تغيير».
        if (editMode) {
          return (
            <InlineSelectCell value={gId} options={governorateOptions}
              onCommit={(v) => saveField(r, { governorate_id: v })} />
          );
        }
        const gov = governorates.find((g) => g.id === gId);
        return gov ? gov.name : '-';
      },
    },
    {
      title: 'مدينة',
      dataIndex: 'markaz',
      key: 'markaz',
      ellipsis: true,
      render: (v: string | null, r: CustomerRecord) => (editMode
        ? <InlineTextCell gridCol="markaz" value={v}
            onCommit={(val) => saveField(r, { markaz: val })} />
        : v || '-'),
    },
    {
      title: 'الرصيد',
      key: 'balance',
      width: 130,
      align: 'left' as const,
      render: (_: any, record: CustomerRecord) => <CustomerBalance value={record.balance} />,
      sorter: (a: CustomerRecord, b: CustomerRecord) =>
        Number(a.balance || 0) - Number(b.balance || 0),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      // Icons, like their rows use — three of them in the width two words used to take. Row
      // clicks open the customer file, so the buttons must not bubble up to it.
      render: (_: any, record: CustomerRecord) => (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض الملف">
            <Button type="text" icon={<EyeOutlined />}
              onClick={() => navigate(`/customers/${record.id}`)} />
          </Tooltip>
          {record.active && (
            <Tooltip title="إخفاء">
              <Button type="text" icon={<StopOutlined />} onClick={() => onDeactivate(record)} />
            </Tooltip>
          )}
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => onDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('customers', columns, {
    export: { name: 'العملاء', rows: customers },
  });

  // المنطقة مكانها السطر المتوسّع؛ بتبقى عمود في وضع التعديل بس (بعد المدينة).
  const territoryColumn = {
    title: 'المنطقة',
    dataIndex: 'territory_id',
    key: 'territory_id',
    width: 150,
    render: (tId: number, r: CustomerRecord) => (canEditTerritory
      ? <InlineSelectCell value={tId} options={territoryOptions}
          onCommit={(v) => saveTerritory(r, v)} />
      : territories.find((t) => t.id === tId)?.name || '-'),
  };
  // في وضع التعديل الخانات اللي بتتعدّل لازم تبان حتى لو مخفية من «الأعمدة» —
  // من غير ما نلمس الإعداد المحفوظ، فبترجع زي ما كانت لما التعديل يخلص.
  let tableColumns: any[] = tableCols.columns;
  if (editMode) {
    const authored: any[] = [...columns];
    authored.splice(authored.findIndex((c) => c.key === 'markaz') + 1, 0, territoryColumn);
    const out: any[] = [...tableCols.columns];
    for (const key of ['phone', 'governorate_id', 'markaz', 'territory_id']) {
      if (out.some((c) => c.key === key)) continue;
      const idx = authored.findIndex((c) => c.key === key);
      // جنب أقرب عمود ظاهر قبله في الترتيب الأصلي.
      let at = 0;
      for (let i = idx - 1; i >= 0; i -= 1) {
        const pos = out.findIndex((c) => c.key === authored[i].key);
        if (pos !== -1) { at = pos + 1; break; }
      }
      out.splice(at, 0, authored[idx]);
    }
    tableColumns = out;
  }

  // The three of ours that used to be columns. Opening a row costs one click and gives them back
  // in full, rather than making every row narrower for everyone who never looks at them.
  const expandedRow = (record: CustomerRecord) => (
    <Space size={32} wrap style={{ paddingInlineStart: 8 }}>
      <span>
        <span style={{ color: '#888' }}>تصنيف: </span>
        {typeLabels[record.customer_type] || TYPE_LABELS[record.customer_type]
          || record.customer_type}
      </span>
      <span>
        <span style={{ color: '#888' }}>المنطقة: </span>
        {territories.find((t) => t.id === record.territory_id)?.name
          || `منطقة #${record.territory_id}`}
      </span>
      <span>
        <span style={{ color: '#888' }}>الفئة السعرية: </span>
        {record.default_price_tier
          ? <Tag color="geekblue">{TIER_LABELS[record.default_price_tier]
              || record.default_price_tier}</Tag>
          : <Tag>مستهلك (افتراضي)</Tag>}
      </span>
      {record.address && (
        <span><span style={{ color: '#888' }}>العنوان: </span>{record.address}</span>
      )}
    </Space>
  );

  // «الحالة» بقت شرايح — نفس فلتر `active` اللي بيروح للسيرفر.
  type StatusTab = 'active' | 'inactive' | 'all';
  const statusTab: StatusTab = filters.active === true ? 'active'
    : filters.active === false ? 'inactive' : 'all';
  // الفلتر ← الرابط (الشرايح و«مسح») — بس لما الشريحة تتغيّر فعلاً، عشان أول رندر مايكتبش فوق اللي في الرابط.
  const lastTab = useRef(statusTab);
  useEffect(() => {
    if (lastTab.current === statusTab) return;
    lastTab.current = statusTab;
    if (statusTab !== listTab) setListTab(statusTab);
  }, [statusTab]); // eslint-disable-line react-hooks/exhaustive-deps
  // العدد من الملخّص — بيتحسب على الفلاتر الحالية، فبيتكتب على الشريحة المفتوحة بس.
  const countIf = (k: StatusTab) => (k === statusTab ? summaryData.total_count : undefined);
  const statusTabs: ListTab<StatusTab>[] = [
    { key: 'active', label: 'نشط', dot: '#52c41a', count: countIf('active') },
    { key: 'inactive', label: 'معطل', dot: '#cf1322', count: countIf('inactive') },
    { key: 'all', label: 'الكل', count: countIf('all') },
  ];

  // كروت الإجماليات اللي كانت فوق بقت سطر تحت الجدول.
  const footer = (
    <span className="sl-foot">
      <span>عدد العملاء: <b>{summaryData.total_count.toLocaleString(numeralsLocale())}</b></span>
      <span>عليهم مديونية: <b>{summaryData.debtors_count.toLocaleString(numeralsLocale())}</b></span>
      <span>
        إجمالي المديونية:{' '}
        <b className={summaryData.total_debt > 0 ? 'is-neg' : undefined}>{money(summaryData.total_debt)}</b>
      </span>
    </span>
  );

  return (
    <>
      <ListPage<StatusTab>
        icon={<TeamOutlined />}
        title="العملاء"
        subtitle="بطاقات العملاء وأرصدتهم ومناديبهم — الضغط على السطر يفتح ملف العميل"
        tabs={statusTabs}
        activeTab={statusTab}
        onTabChange={(k) => {
          leaveEditMode();
          setFilter('active', k === 'active' ? true : k === 'inactive' ? false : undefined);
        }}
        actions={(<>
          {canEditCustomers && (
            <Button icon={<EditOutlined />} type={editMode ? 'primary' : 'default'}
              onClick={() => (editMode ? leaveEditMode() : setEditMode(true))}>
              {editMode ? 'إنهاء التعديل' : 'تعديل بيانات العملاء'}
            </Button>
          )}
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<UserAddOutlined />}
            onClick={() => setDrawerVisible(true)}>
            إضافة عميل
          </Button>
          {tableCols.control}
        </>)}
        filters={(<>
          {/* الفلاتر على السيرفر، فبتغطّي كل العملاء مش الصفحة المحمّلة بس. */}
          <Input
            className="sl-f-search"
            allowClear
            value={search}
            placeholder="بحث بالاسم أو الكود أو الهاتف أو العنوان"
            prefix={<SearchOutlined />}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={applySearch}
            onBlur={applySearch}
          />
          <Select allowClear placeholder="التصنيف"
            value={filters.customer_type}
            onChange={(v) => setFilter('customer_type', v)}
            options={customerTypeOptions.map((o) => ({ value: o.value, label: o.label }))} />
          <Select allowClear showSearch placeholder="مندوب البيع"
            value={filters.rep_id}
            onChange={(v) => setFilter('rep_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
          <Select allowClear showSearch placeholder="مندوب الخدمة"
            value={filters.service_rep_id}
            onChange={(v) => setFilter('service_rep_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={serviceReps.map((r) => ({ value: r.id, label: r.full_name }))} />
          <Select allowClear showSearch placeholder="المحافظة"
            value={filters.governorate_id}
            onChange={(v) => setFilter('governorate_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={governorates.map((g) => ({ value: g.id, label: g.name }))} />
          <Select allowClear showSearch placeholder="المنطقة"
            value={filters.territory_id}
            onChange={(v) => setFilter('territory_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={territories.map((t) => ({ value: t.id, label: t.name }))} />
          <Select allowClear placeholder="حالة الذمة"
            value={filters.balance_filter}
            onChange={(v) => setFilter('balance_filter', v)}
            options={[
              { value: 'debtors', label: 'عليه مديونية' },
              { value: 'settled', label: 'مسدّد بالكامل' },
              { value: 'credit', label: 'له رصيد (دائن)' },
            ]} />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetFilters}>مسح</Button>
        </>)}
      >
        <Table
          className="sl-table"
          dataSource={customers}
          columns={tableColumns}
          rowKey="id"
          loading={loading}
          size="small"
          tableLayout="fixed"
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{
            current: page,
            pageSize,
            total: totalCount,
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            locale: { items_per_page: '' },
            onChange: handlePageChange,
            showTotal: () => footer,
          }}
          // The whole row opens the customer file — إلا وإحنا بنعدّل.
          onRow={(record) => (editMode ? {} : {
            onClick: () => navigate(`/customers/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </ListPage>

      {/* عميل جديد — laid out field for field against their العملاء form: the same groups, three
          to a row, in their order. Whoever registers customers off a paper application reads down
          it in that order, and a form that asks in a different one turns typing into searching. */}
      <TabModal footer={null} centered
        title="عميل جديد"
        width={860}
        onCancel={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateCustomer} requiredMark={false}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="branch_id" label="الفرع">
                <Select allowClear showSearch placeholder="اختر الفرع"
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rep_id" label="مندوب"
                rules={[{ required: true, message: 'يرجى تحديد المندوب!' }]}>
                <Select showSearch placeholder="اختر المندوب"
                  options={reps.map((r) => ({ value: r.id, label: r.full_name }))}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="default_price_tier" label="السعر الافتراضي"
                extra="تُستخدم تلقائياً على فواتيره (الافتراضي: مستهلك)">
                <Select allowClear placeholder="مستهلك (افتراضي)"
                  options={Object.entries(TIER_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="name" label="الاسم"
                rules={[{ required: true, message: 'يرجى إدخال اسم العميل!' }]}>
                <Input placeholder="مثال: شركة النور للسباكة" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="email" label="البريد الالكترونى"
                rules={[{ type: 'email', message: 'بريد غير صحيح' }]}>
                <Input placeholder="nour@example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tax_number" label="رقم الضريبي">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="commercial_register" label="السجل التجاري">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="address" label="العنوان">
                <Input placeholder="مثال: 22 شارع سعد زغلول، بجوار مسجد النور" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label="الهاتف">
                <Input placeholder="مثال: 01000000000" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="customer_type" label="تصنيف"
                rules={[{ required: true, message: 'يرجى تحديد نوع العميل!' }]}>
                <Select placeholder="اختر التصنيف"
                  options={customerTypeOptions.map((o) => ({ value: o.value, label: o.label }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="governorate_id" label="محافظات">
                <Select allowClear showSearch placeholder="اختر المحافظة"
                  options={governorates.map((g) => ({ value: g.id, label: g.name }))}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="markaz" label="مدن">
                <Input placeholder="مثال: دمنهور" />
              </Form.Item>
            </Col>
          </Row>

          {/* خصم and ض.م are left EMPTY by default, not zero: empty means nothing was agreed and
              the item's own rate applies, zero means an agreed rate of nothing. Pre-filling them
              with 0 would silently turn every customer into one who negotiated a zero rate. */}
          <Row gutter={12}>
            <Col span={4}>
              {/* His rate REPLACES the item's rather than adding to it: a dealer on 20% against
                  an item that gives 10% is on twenty, not twenty-eight. Empty is what makes that
                  readable — «مفيش اتفاق» and «اتفقنا على صفر» are different instructions. */}
              <Form.Item name="discount_pct" label="خصم %"
                tooltip="إن حُدِّد فإنه يحل محل خصم الصنف ولا يُضاف إليه. اتركه فارغاً ليأخذ الصنف خصمه."
                extra="فارغ = لا يوجد اتفاق">
                <InputNumber min={0} max={100} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="vat_pct" label="ض.م">
                <InputNumber min={0} max={100} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Space size={24} style={{ marginTop: 30 }}>
                <Form.Item name="is_cash" valuePropName="checked" noStyle>
                  <Checkbox>نقدي</Checkbox>
                </Form.Item>
                <Form.Item name="hidden" valuePropName="checked" noStyle>
                  <Checkbox>مخفي</Checkbox>
                </Form.Item>
              </Space>
            </Col>
          </Row>

          {/* Ours, kept after theirs: their form has no territory and no room for a second
              number, and dropping either would lose data we already hold. */}
          <Divider orientation="right" style={{ margin: '8px 0' }}>إضافات تكنو ثيرم</Divider>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="territory_id" label="المنطقة الجغرافية"
                rules={[{ required: true, message: 'يرجى تحديد المنطقة!' }]}>
                <Select showSearch placeholder="اختر المنطقة"
                  options={territories.map((t) => ({ value: t.id, label: t.name }))}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <ExtraPhonesList />
            </Col>
          </Row>

          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setDrawerVisible(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>
    </>
  );
}
