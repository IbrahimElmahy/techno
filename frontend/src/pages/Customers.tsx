import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Button, Checkbox, Col, Divider, Form, Input, Modal, Row, Segmented, Select, Space, Tag, Tooltip,
  message,
} from 'antd';
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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import ListPage, { type ListTab } from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { money, numeralsLocale } from '../utils/money';
import { useLiveRefresh } from '../utils/live';
import { repOptions } from '../utils/reps';
import { activeOptions } from '../utils/active';
interface CustomerRecord {
  id: number;
  code: string;
  name: string;
  customer_type: string;
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
  balance?: string | null;
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

type CellStatus = 'idle' | 'saving' | 'saved';

const CellStatusIcon = ({ status }: { status: CellStatus }) => (
  <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center', flex: 'none' }}>
    {status === 'saving' && <LoadingOutlined style={{ fontSize: 14 }} />}
    {status === 'saved' && <CheckCircleFilled style={{ fontSize: 14, color: '#52c41a' }} />}
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
        suffix={<CellStatusIcon status={status} />}
      />
    </div>
  );
};

const InlineSelectCell = <V extends number | string>({
  value, options, onCommit,
}: {
  value: V | null;
  options: { value: V; label: string }[];
  onCommit: (v: V) => Promise<void>;
}) => {
  const [current, setCurrent] = useState<V | null>(value);
  const { status, run } = useCellStatus();
  useEffect(() => {
    if (status !== 'saving') setCurrent(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = async (v: V) => {
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

const CustomerBalance = ({ value }: { value?: string | null }) => {
  const n = Number(value || 0);
  const color = n > 0 ? '#cf1322' : n < 0 ? '#1677ff' : undefined;
  return <span style={{ fontWeight: 'bold', color }}>{money(n)}</span>;
};

export default function Customers() {
  const { options: typeOptions } = useLookup('customer_type');
  const typeLabels = labelMap(typeOptions);
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
  const [listTab, setListTab] = useQueryTab('active');
  const [urlParams, setUrlParams] = useSearchParams();
  const partyGroup = (['employees', 'branches'].includes(urlParams.get('group') || '')
    ? urlParams.get('group') : 'customers') as 'customers' | 'employees' | 'branches';
  const setPartyGroup = (g: string) => {
    const next = new URLSearchParams(urlParams);
    if (g === 'customers') next.delete('group'); else next.set('group', g);
    setUrlParams(next, { replace: true });
  };
  const [filters, setFilters] = useState<Filters>(() => ({
    active: listTab === 'all' ? undefined : listTab !== 'inactive',
  }));
  const [search, setSearch] = useState('');
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

  const canEditCustomers = can('customer.write');
  const canEditTerritory = can('customer.reassign');
  const [editModeRaw, setEditMode] = useState(false);
  const editMode = editModeRaw && canEditCustomers;
  const leaveEditMode = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setEditMode(false);
  };
  const mergeRow = (id: number, data: Partial<CustomerRecord>) =>
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...data } : c)));
  const saveField = async (r: CustomerRecord, body: Partial<CustomerRecord>) => {
    const res = await api.patch(`/api/v1/customers/${r.id}`, body);
    mergeRow(r.id, {
      name: res.data.name, customer_type: res.data.customer_type, address: res.data.address,
      phone: res.data.phone, governorate_id: res.data.governorate_id, markaz: res.data.markaz,
    });
  };
  const saveTerritory = async (r: CustomerRecord, territoryId: number) => {
    const res = await api.post(`/api/v1/customers/${r.id}/reassign`, {
      new_territory_id: territoryId,
    });
    mergeRow(r.id, { territory_id: res.data.territory_id, rep_id: res.data.rep_id });
  };

  const saveRep = async (r: CustomerRecord, repId: number) => {
    const res = await api.post(`/api/v1/customers/${r.id}/reassign`, {
      new_rep_id: repId, new_territory_id: r.territory_id,
    });
    mergeRow(r.id, { territory_id: res.data.territory_id, rep_id: res.data.rep_id });
  };

  const loadSummary = async (activeFilters = filters) => {
    try {
      const params: any = { party_group: partyGroup };
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

  const fetchCustomers = async (
    override?: Filters, targetPage = page, targetPageSize = pageSize, opts?: { silent?: boolean },
  ) => {
    const active = override ?? filters;
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const params: any = {
        limit: targetPageSize,
        offset: (targetPage - 1) * targetPageSize,
        party_group: partyGroup,
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

  const applySearch = () => {
    const q = search.trim() || undefined;
    if (q !== filters.q) setFilter('q', q);
  };

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

  const fetchLookups = async () => {
    try {
      const [usersRes, territoriesRes, governoratesRes, branchesRes] = await Promise.all([
        api.get('/api/v1/users'),
        api.get('/api/v1/territories'),
        api.get('/api/v1/governorates'),
        api.get('/api/v1/branches'),
      ]);
      const byName = (r: any) => r.full_name || r.name;
      setReps(sortByName(usersRes.data.filter((u: any) => u.role === 'sales_rep'), byName));
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

  const firstGroup = useRef(true);
  useEffect(() => {
    if (firstGroup.current) { firstGroup.current = false; return; }
    setPage(1);
    fetchCustomers(undefined, 1);
    loadSummary();
  }, [partyGroup]); // eslint-disable-line react-hooks/exhaustive-deps

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
        discount_pct: values.discount_pct ?? null,
        vat_pct: values.vat_pct ?? null,
        is_cash: !!values.is_cash,
        phones: cleanPhones(values.phones),
      });
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

  const onDelete = async (record: CustomerRecord) => {
    try {
      await api.delete(`/api/v1/customers/${record.id}?hard=true`);
      message.success('تم حذف العميل');
      fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };

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
      render: (name: string, record: CustomerRecord) => (editMode
        ? <InlineTextCell gridCol="name" value={name}
            validate={(v) => (v ? null : 'الاسم مايبقاش فاضي')}
            onCommit={(v) => saveField(record, { name: v })} />
        : (
          <Space size={4}>
            <span style={{ fontWeight: 600 }}>{name}</span>
            {!record.active && <Tag color="red">مخفي</Tag>}
          </Space>
        )),
    },
    {
      title: 'النوع',
      dataIndex: 'customer_type',
      key: 'customer_type',
      width: 90,
      sorter: (a: CustomerRecord, b: CustomerRecord) =>
        String(a.customer_type || '').localeCompare(String(b.customer_type || '')),
      render: (t: string, r: CustomerRecord) => {
        if (editMode) {
          return (
            <InlineSelectCell<string> value={t}
              options={customerTypeOptions.map((o) => ({ value: String(o.value), label: o.label }))}
              onCommit={(v) => saveField(r, { customer_type: v })} />
          );
        }
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
      render: (repId: number | null, row: CustomerRecord) => {
        if (editMode && canEditTerritory) {
          return (
            <InlineSelectCell<number> value={repId}
              options={repOptions(reps, repId)}
              onCommit={(v) => saveRep(row, v)} />
          );
        }
        if (!repId) return '—';
        const rep = reps.find((r) => r.id === repId);
        return rep ? rep.full_name : `مندوب #${repId}`;
      },
    },
    {
      title: 'مورد كمان',
      dataIndex: 'supplier_name',
      key: 'supplier_name',
      ellipsis: true,
      render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : '—'),
    },
    {
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

  const tableCols = useTableColumns('customers', columns, {
    export: { name: 'العملاء', rows: customers },
  });

  const territoryColumn = {
    title: 'المنطقة',
    dataIndex: 'territory_id',
    key: 'territory_id',
    width: 150,
    render: (tId: number, r: CustomerRecord) => (canEditTerritory
      ? <InlineSelectCell value={tId} options={activeOptions(territories, tId)}
          onCommit={(v) => saveTerritory(r, v)} />
      : territories.find((t) => t.id === tId)?.name || '-'),
  };
  const addressColumn = {
    title: 'العنوان',
    dataIndex: 'address',
    key: 'address',
    width: 220,
    render: (v: string | null, r: CustomerRecord) => (
      <InlineTextCell gridCol="address" value={v}
        onCommit={(val) => saveField(r, { address: val })} />
    ),
  };
  let tableColumns: any[] = tableCols.columns;
  if (editMode) {
    const authored: any[] = [...columns];
    authored.splice(authored.findIndex((c) => c.key === 'markaz') + 1, 0, territoryColumn, addressColumn);
    const out: any[] = [...tableCols.columns];
    for (const key of ['name', 'customer_type', 'phone', 'rep_id', 'governorate_id', 'markaz',
      'territory_id', 'address']) {
      if (out.some((c) => c.key === key)) continue;
      const idx = authored.findIndex((c) => c.key === key);
      let at = 0;
      for (let i = idx - 1; i >= 0; i -= 1) {
        const pos = out.findIndex((c) => c.key === authored[i].key);
        if (pos !== -1) { at = pos + 1; break; }
      }
      out.splice(at, 0, authored[idx]);
    }
    tableColumns = out;
  }

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

  type StatusTab = 'active' | 'inactive' | 'all';
  const statusTab: StatusTab = filters.active === true ? 'active'
    : filters.active === false ? 'inactive' : 'all';
  const lastTab = useRef(statusTab);
  useEffect(() => {
    if (lastTab.current === statusTab) return;
    lastTab.current = statusTab;
    if (statusTab !== listTab) setListTab(statusTab);
  }, [statusTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const countIf = (k: StatusTab) => (k === statusTab ? summaryData.total_count : undefined);
  const statusTabs: ListTab<StatusTab>[] = [
    { key: 'active', label: 'نشط', dot: '#52c41a', count: countIf('active') },
    { key: 'inactive', label: 'معطل', dot: '#cf1322', count: countIf('inactive') },
    { key: 'all', label: 'الكل', count: countIf('all') },
  ];

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
        title={partyGroup === 'employees' ? 'الموظفين' : partyGroup === 'branches' ? 'الفروع والشركات التابعة' : 'العملاء'}
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
          <Segmented
            value={partyGroup}
            onChange={(v) => { leaveEditMode(); setPartyGroup(String(v)); }}
            options={[
              { value: 'customers', label: 'العملاء' },
              { value: 'employees', label: 'الموظفين' },
              { value: 'branches', label: 'الفروع' },
            ]}
          />
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
            options={repOptions(reps, filters.rep_id)} />
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
          onRow={(record) => (editMode ? {} : {
            onClick: () => navigate(`/customers/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </ListPage>

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
                  options={activeOptions(branches)}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rep_id" label="مندوب"
                rules={[{ required: true, message: 'يرجى تحديد المندوب!' }]}>
                <Select showSearch placeholder="اختر المندوب"
                  options={repOptions(reps)}
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

          <Row gutter={12}>
            <Col span={4}>
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

          <Divider orientation="right" style={{ margin: '8px 0' }}>إضافات تكنو ثيرم</Divider>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="territory_id" label="المنطقة الجغرافية"
                rules={[{ required: true, message: 'يرجى تحديد المنطقة!' }]}>
                <Select showSearch placeholder="اختر المنطقة"
                  options={activeOptions(territories)}
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
