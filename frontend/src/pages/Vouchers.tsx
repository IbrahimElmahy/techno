import { allRows } from '../components/tableDefaults';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Form, Select, Input, Button, Space, Tag, message, Descriptions, Alert, Empty,
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { Popconfirm } from '../components/noConfirm';
import {
  WalletOutlined,
  FileSearchOutlined,
  DeleteOutlined,
  UndoOutlined,
  PrinterOutlined,
  SearchOutlined,
  PlusOutlined,
  ClearOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { entryTypeLabel } from '../components/labels';
import dayjs, { Dayjs } from 'dayjs';
import CostCenterField from '../components/CostCenterField';
import CostCenterSplit from '../components/CostCenterSplit';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import ExportExcelButton from '../components/ExportExcelButton';
import { useQueryTab } from '../components/useQueryTab';
import { useDocRoute } from '../components/useDocRoute';
import DocOpening from '../components/DocOpening';
import { useListFilter, normalizeAr } from '../components/ListToolbar';
import ListPage, { ListTab } from '../components/ListPage';
import { matchesStatement } from '../utils/statements';
import DateRangeFilter from '../components/DateRangeFilter';
import { printDocument } from '../print/brand';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import VoucherDocument, { VoucherDoc, VOUCHER_TITLES, voucherFooter } from '../components/VoucherDocument';
import { useLookup } from '../hooks/useLookup';
import { VoucherKeyStrip, RunnerWorld } from '../components/VoucherKeyRunner';
import { defaultTreasuryId } from '../components/VoucherFields';
import { TabModal } from '../components/TabModal';
import DocumentAttachments from '../components/DocumentAttachments';
import DocumentHistoryButton from '../components/DocumentHistory';
import { money, numeralsLocale } from '../utils/money';
import ReceiptModal from './vouchers/ReceiptModal';
import PaymentModal from './vouchers/PaymentModal';
import HandoverModal from './vouchers/HandoverModal';
import ExpenseModal from './vouchers/ExpenseModal';
import TransferModal from './vouchers/TransferModal';
import ChequeModal from './vouchers/ChequeModal';

import {
  VoucherRecord, StatementLine, StatementData, Party, UserRecord, KIND_LABEL, KIND_COLOR,
} from './vouchers/types';
import { useLiveRefresh } from '../utils/live';
import { repOptions } from '../utils/reps';

const TreasuryMovementTab: React.FC<{ treasuries: any[]; treasuryId?: number; range: any }> = ({
  treasuries, treasuryId, range,
}) => {
  const [statement, setStatement] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const selected = treasuries.find((t) => t.id === treasuryId);

  useEffect(() => {
    if (!selected?.account_id) { setStatement(null); return; }
    setLoading(true);
    const params: any = {};
    if (range) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    api.get(`/api/v1/accounts/${selected.account_id}/statement`, { params })
      .then((r) => setStatement(r.data))
      .catch(() => setStatement(null))
      .finally(() => setLoading(false));
  }, [treasuryId, range]);

  const fmt = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(),
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!statement) {
    return (
      <Empty style={{ padding: '32px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={loading ? 'جاري التحميل…' : 'اختر الخزينة'} />
    );
  }

  return (
    <Table
      className="sl-table"
      rowKey={(l: any) => `${l.entry_id}-${l.balance}`} size="small" loading={loading}
      dataSource={statement.lines}
      locale={{ emptyText: 'لا توجد حركة في هذه الفترة' }}
      pagination={{
        defaultPageSize: PAGE_SIZE, showSizeChanger: true, locale: { items_per_page: '' },
        showTotal: () => (
          <span className="sl-foot">
            <span>رصيد أول المدة: <b>{fmt(statement.opening_balance)}</b></span>
            <span>وارد: <b className="is-pos">{fmt(statement.total_debit)}</b></span>
            <span>منصرف: <b className="is-neg">{fmt(statement.total_credit)}</b></span>
            <span>الرصيد: <b>{fmt(statement.closing_balance)}</b></span>
          </span>
        ),
      }}
      scroll={{ x: 'max-content' }}
      columns={[
        { title: 'التاريخ', dataIndex: 'entry_date',
          render: (d: string) => String(d).slice(0, 10) },
        { title: 'النوع', dataIndex: 'entry_type',
          render: (t: string) => <Tag>{entryTypeLabel(t)}</Tag> },
        { title: 'البيان', dataIndex: 'description' },
        { title: 'الرصيد قبل', dataIndex: 'balance_before', align: 'left' as const,
          render: (v: string) => <span style={{ color: '#6b6b6b' }}>{fmt(v)}</span> },
        { title: 'وارد', dataIndex: 'debit', align: 'left' as const,
          render: (v: string) => (Number(v) ? fmt(v) : '-') },
        { title: 'منصرف', dataIndex: 'credit', align: 'left' as const,
          render: (v: string) => (Number(v) ? fmt(v) : '-') },
        { title: 'الرصيد بعد', dataIndex: 'balance', align: 'left' as const,
          render: (v: string) => <b>{fmt(v)}</b> },
      ]}
    />
  );
};

const TAB_KIND: Record<string, string> = {
  receipt: 'receipt', payment: 'payment', handover: 'rep_handover',
  expense: 'expense', transfer: 'cash_transfer',
};

const newestFirst = (a: VoucherRecord, b: VoucherRecord) =>
  (b.voucher_date || '').localeCompare(a.voucher_date || '') || b.id - a.id;

const Vouchers: React.FC = () => {
  const [tab, setTab] = useQueryTab('receipt');
  const [chequeDir] = useQueryTab('', 'direction');
  const [vouchers, setVouchers] = useState<VoucherRecord[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [reps, setReps] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [kindFilter, setKindFilter] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const { options: methodOptions } = useLookup('payment_method');

  const [stKind, setStKind] = useState<'customer' | 'supplier' | 'rep'>('customer');
  const [stParty, setStParty] = useState<number | undefined>(undefined);
  const [stRange, setStRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [statement, setStatement] = useState<StatementData | null>(null);
  const [stLoading, setStLoading] = useState(false);

  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<any[]>([]);
  const [expenseGroups, setExpenseGroups] = useState<any[]>([]);
  const [cheques, setCheques] = useState<any[]>([]);
  const [voucherView, setVoucherView] = useState<VoucherRecord | null>(null);
  const [listLoaded, setListLoaded] = useState(false);

  const { markOpen, markClosed, opening: docOpening } = useDocRoute<VoucherRecord>({
    rows: vouchers,
    openId: voucherView?.id ?? null,
    open: (v) => openView(v),
    close: () => closeView(),
    loading: loading || !listLoaded,
    fetchOne: async (id) => {
      try {
        return (await api.get<VoucherRecord>(`/api/v1/vouchers/${id}`)).data;
      } catch {
        message.warning(`السند رقم ${id} غير موجود أو ليس ضمن صلاحيتك`);
        return null;
      }
    },
  });

  const openView = (v: VoucherRecord) => { setVoucherView(v); markOpen(v.id); };

  const closeView = () => { setVoucherView(null); markClosed(); };

  const keyWorld = useMemo<RunnerWorld>(() => ({
    treasuries: treasuries as any, customers, suppliers, reps: reps as any, accounts: [],
  }), [treasuries, customers, suppliers, reps]);

  const [receiptForm] = Form.useForm();
  const [receiptFamilies, setReceiptFamilies] = useState<Record<number, any[]>>({});
  const [receiptTarget, setReceiptTarget] = useState<string>('');
  const [paymentForm] = Form.useForm();
  const [handoverForm] = Form.useForm();
  const [expenseForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [treasuryForm] = Form.useForm();
  const [chequeForm] = Form.useForm();
  const [chequeOpen, setChequeOpen] = useState(false);
  const [tmTreasuryId, setTmTreasuryId] = useState<number | undefined>();
  const [tmRange, setTmRange] = useState<any>(null);
  const searchRef = useRef<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  useScreenShortcuts({
    onNew: () => {
      const open: Record<string, () => void> = {
        receipt: () => { setReceiptTarget(''); openVoucher(receiptForm, setReceiptOpen); },
        payment: () => openVoucher(paymentForm, setPaymentOpen),
        handover: () => { handoverForm.resetFields(); setHandoverOpen(true); },
        expense: () => openVoucher(expenseForm, setExpenseOpen),
        transfer: () => { transferForm.resetFields(); setTransferOpen(true); },
        cheques: () => { chequeForm.resetFields(); setChequeOpen(true); },
      };
      open[tab]?.();
    },
    onSearch: () => searchRef.current?.focus?.(),
  });

  const listKind = TAB_KIND[tab] ?? (tab === 'log' ? kindFilter : undefined);
  const listActive = tab in TAB_KIND || tab === 'log';
  const [vPage, setVPage] = useState(1);
  const [vPageSize, setVPageSize] = useState(PAGE_SIZE);
  const [vTotal, setVTotal] = useState(0);
  const loadSeq = useRef(0);

  const loadVouchers = useCallback(async (opts?: { silent?: boolean }) => {
    if (!listActive) { setListLoaded(true); return; }
    const silent = !!opts?.silent;
    const seq = ++loadSeq.current;
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string | number> = {
        limit: vPageSize, offset: (vPage - 1) * vPageSize,
      };
      if (listKind) params.kind = listKind;
      if (range?.[0]) params.date_from = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.date_to = range[1].format('YYYY-MM-DD');
      const { data } = await api.get<any>('/api/v1/vouchers', { params });
      if (seq !== loadSeq.current) return;
      const rows: VoucherRecord[] = Array.isArray(data) ? data : (data?.rows ?? []);
      setVouchers([...rows].sort(newestFirst));
      setVTotal(Array.isArray(data) ? data.length : Number(data?.total ?? rows.length));
    } catch {
    } finally {
      if (seq === loadSeq.current) {
        if (!silent) setLoading(false);
        setListLoaded(true);
      }
    }
  }, [listActive, listKind, range, vPage, vPageSize]);

  const queryKey = [listActive, listKind ?? '', range?.[0]?.format('YYYY-MM-DD') ?? '',
    range?.[1]?.format('YYYY-MM-DD') ?? ''].join('|');
  const lastQueryKey = useRef(queryKey);
  useEffect(() => {
    if (lastQueryKey.current !== queryKey) {
      lastQueryKey.current = queryKey;
      if (vPage !== 1) { setVPage(1); return; }
    }
    loadVouchers();
  }, [loadVouchers]);

  const fetchAllVouchers = async () => {
    const params: Record<string, string> = {};
    if (listKind) params.kind = listKind;
    if (range?.[0]) params.date_from = range[0].format('YYYY-MM-DD');
    if (range?.[1]) params.date_to = range[1].format('YYYY-MM-DD');
    const res = await api.get<any>('/api/v1/vouchers', { params });
    return [...(Array.isArray(res.data) ? res.data : (res.data?.rows ?? []))].sort(newestFirst);
  };

  const serverPagination = (foot: (total: number) => React.ReactNode) => ({
    current: vPage, pageSize: vPageSize, total: vTotal,
    showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
    locale: { items_per_page: '' },
    onChange: (p: number, size: number) => {
      if (size !== vPageSize) { setVPageSize(size); setVPage(1); } else setVPage(p);
    },
    showTotal: foot,
  });

  const openVoucher = useCallback((form: any, show: (v: boolean) => void) => {
    form.resetFields();
    const id = defaultTreasuryId(treasuries);
    if (id) form.setFieldsValue({ treasury_id: id });
    show(true);
  }, [treasuries]);

  const loadExpenseAccounts = useCallback(() => {
    api.get<any[]>('/api/v1/accounts')
      .then((r) => {
        const expense = r.data.filter((a) => a.nature === 'expense');
        setExpenseAccounts(expense.filter((a) => a.is_postable && a.active !== false));
        setExpenseGroups(expense.filter((a) => !a.is_postable && a.active !== false));
      })
      .catch(() => {});
  }, []);

  const loadTreasuries = useCallback(async () => {
    try {
      const { data } = await api.get<any[]>('/api/v1/treasuries');
      setTreasuries(data);
    } catch {
    }
  }, []);

  const loadCheques = useCallback(async () => {
    try {
      const { data } = await api.get<any[]>('/api/v1/cheques');
      setCheques(data);
    } catch {
    }
  }, []);

  useEffect(() => {
    loadTreasuries();
    loadCheques();
    loadExpenseAccounts();
      }, [loadTreasuries, loadCheques]);

  useLiveRefresh(['vouchers', 'cheques', 'treasuries'], () => {
    loadVouchers({ silent: true });
    loadCheques();
    loadTreasuries();
  });

  useEffect(() => {
    api.get<Party[]>('/api/v1/customers').then((r) => setCustomers(r.data)).catch(() => {});
    api.get<Party[]>('/api/v1/suppliers').then((r) => setSuppliers(r.data)).catch(() => {});
    api
      .get<UserRecord[]>('/api/v1/users')
      .then((r) => setReps(sortByName(r.data.filter((u) => u.role === 'sales_rep'),
        (u) => u.full_name || u.username)))
      .catch(() => {});
  }, []);

  const partyName = (v: VoucherRecord) => {
    if (v.customer_id) return customers.find((c) => c.id === v.customer_id)?.name || `#${v.customer_id}`;
    if (v.supplier_id) return suppliers.find((s) => s.id === v.supplier_id)?.name || `#${v.supplier_id}`;
    if (v.rep_user_id) {
      const u = reps.find((r) => r.id === v.rep_user_id);
      return u ? u.full_name || u.username : `#${v.rep_user_id}`;
    }
    return v.description || v.statement1 || '—';
  };

  const chequeParty = (c: any) =>
    c.customer_id
      ? customers.find((x) => x.id === c.customer_id)?.name || `#${c.customer_id}`
      : c.supplier_id
        ? suppliers.find((x) => x.id === c.supplier_id)?.name || `#${c.supplier_id}`
        : '';

  const [voucherQuery, setVoucherQuery] = useState('');
  const shownVouchers = voucherQuery
    ? vouchers.filter((v) =>
        [v.document_number, KIND_LABEL[v.kind], partyName(v), v.payment_method, v.reference, v.description, v.amount,
          v.statement1, v.external_document_number]
          .some((f) => normalizeAr(f).includes(normalizeAr(voucherQuery))))
    : vouchers;

  const chequeFilter = useListFilter<any>(cheques, {
    initialValues: chequeDir ? { direction: chequeDir } : {},
    search: (c) => [c.document_number, c.cheque_number, c.bank_name, c.amount, chequeParty(c),
      c.statement1],
    filters: {
      direction: (c, v) => c.direction === v,
      status: (c, v) => c.status === v,
      statement: (c, v) => matchesStatement(c, v),
    },
    dateOf: (c) => c.due_date,
  });

  const voucherDoc = (v: VoucherRecord | null): VoucherDoc | null => {
    if (!v) return null;
    const treasuryName = (id: any) => treasuries.find((t) => t.id === id)?.name ?? null;
    const label = v.customer_id ? 'العميل' : v.supplier_id ? 'المورد'
      : v.rep_user_id ? 'المندوب' : 'الطرف';
    return {
      kind: v.kind as VoucherDoc['kind'],
      document_number: v.document_number,
      date: v.voucher_date,
      amount: v.amount,
      partyLabel: label,
      partyName: partyName(v),
      treasury: treasuryName((v as any).treasury_id),
      toTreasury: treasuryName((v as any).to_treasury_id),
      paymentMethod: v.payment_method,
      reference: v.reference,
      description: v.description,
      statement: v.statement1 ?? null,
      family: (v as any).family ?? null,
      entryId: (v as any).ledger_entry_id ?? null,
      isReversal: v.is_reversal,
    };
  };

  const submit = async (
    path: string, values: any, form: any, okMsg: string, opts?: { keepOpen?: boolean },
  ): Promise<any | null> => {
    setPosting(true);
    try {
      const payload: any = { ...values, amount: String(values.amount) };
      if (values.voucher_date) payload.voucher_date = values.voucher_date.format('YYYY-MM-DD');
      const { data } = await api.post(path, payload);
      message.success(okMsg);
      form.resetFields();
      if (!opts?.keepOpen) {
        setReceiptOpen(false);
        setPaymentOpen(false);
        setHandoverOpen(false);
        setExpenseOpen(false);
        setTransferOpen(false);
      }
      loadVouchers();
      loadTreasuries();
      if (payload.supplier_id) {
        api.get<Party[]>('/api/v1/suppliers').then((r) => setSuppliers(r.data)).catch(() => {});
      }
      if (statement) loadStatement();
      return data ?? {};
    } catch {
      return null;
    } finally {
      setPosting(false);
    }
  };

  const deleteVoucher = async (id: number) => {
    try {
      await api.delete(`/api/v1/vouchers/${id}`);
      message.success('تم حذف السند');
      loadVouchers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر مسح السند');
    }
  };

  const loadStatement = async () => {
    if (!stParty) {
      message.warning('اختر الطرف الأول');
      return;
    }
    setStLoading(true);
    try {
      const base =
        stKind === 'customer'
          ? `/api/v1/customers/${stParty}/statement`
          : stKind === 'supplier'
            ? `/api/v1/suppliers/${stParty}/statement`
            : `/api/v1/reps/${stParty}/cash-statement`;
      const params: Record<string, string> = {};
      if (stRange?.[0]) params.date_from = stRange[0].format('YYYY-MM-DD');
      if (stRange?.[1]) params.date_to = stRange[1].format('YYYY-MM-DD');
      const { data } = await api.get<StatementData>(base, { params });
      setStatement(data);
    } catch {
      setStatement(null);
    } finally {
      setStLoading(false);
    }
  };

  const stPartyOptions = sortByName(
    stKind === 'customer'
      ? customers.map((c) => ({ value: c.id, label: c.name }))
      : stKind === 'supplier'
        ? suppliers.map((s) => ({ value: s.id, label: s.name }))
        : repOptions(reps, stParty),
    (o) => o.label);

  const stPartyLabel = stPartyOptions.find((o) => o.value === stParty)?.label || '';

  const printStatement = () => {
    if (!statement) return;
    const title =
      stKind === 'customer' ? 'كشف حساب عميل' : stKind === 'supplier' ? 'كشف حساب مورد' : 'كشف عهدة مندوب';
    const rows = statement.lines
      .map(
        (l) =>
          `<tr><td>${l.entry_date}</td><td>${entryTypeLabel(l.entry_type)}</td><td>${l.description || ''}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td>${money(l.balance)}</td></tr>`
      )
      .join('');
    printDocument(
      {
        title: `تكنو ثيرم — ${title}`,
        meta: [
          ['الطرف', stPartyLabel],
          ['الفترة',
            `${stRange?.[0] ? stRange[0].format('YYYY-MM-DD') : 'من البداية'} إلى ${stRange?.[1] ? stRange[1].format('YYYY-MM-DD') : 'اليوم'}`],
          ['رصيد أول المدة', money(statement.opening_balance)],
        ],
      },
      `<table class="grid">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">لا توجد حركة</td></tr>'}</tbody>
        <tfoot><tr><td colspan="3">الإجمالي</td><td>${money(statement.total_debit)}</td><td>${money(statement.total_credit)}</td><td>${money(statement.closing_balance)}</td></tr></tfoot>
      </table>`,
    );
  };

  const byKind = (k: string) => shownVouchers.filter((v) => v.kind === k);
  const kbArgs = { rowKey: (v: VoucherRecord) => v.id, onOpen: openView };
  const receiptKb = useTableKeyboard<VoucherRecord>({ rows: byKind('receipt'), ...kbArgs });
  const paymentKb = useTableKeyboard<VoucherRecord>({ rows: byKind('payment'), ...kbArgs });
  const handoverKb = useTableKeyboard<VoucherRecord>({ rows: byKind('rep_handover'), ...kbArgs });
  const expenseKb = useTableKeyboard<VoucherRecord>({ rows: byKind('expense'), ...kbArgs });
  const transferKb = useTableKeyboard<VoucherRecord>({ rows: byKind('cash_transfer'), ...kbArgs });

  const voucherColumns = [
    { title: 'رقم السند', dataIndex: 'document_number', width: 120 },
    {
      title: 'النوع',
      dataIndex: 'kind',
      width: 110,
      render: (v: string) => <Tag color={KIND_COLOR[v]}>{KIND_LABEL[v]}</Tag>,
    },
    { title: 'التاريخ', dataIndex: 'voucher_date', width: 110 },
    { title: 'الطرف', width: 180, render: (_: any, r: VoucherRecord) => partyName(r) },
    {
      title: 'المبلغ',
      dataIndex: 'amount',
      width: 120,
      align: 'left' as const,
      render: (v: string) => <b>{money(v)}</b>,
    },
    { title: 'طريقة الدفع', dataIndex: 'payment_method', width: 110 },
    { title: 'المرجع', dataIndex: 'reference', width: 120 },
    { title: 'رقم المستند الورقي', dataIndex: 'external_document_number', width: 130, ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'البيان', dataIndex: 'description' },
    {
      title: '',
      width: 220,
      render: (_: any, r: VoucherRecord) => (
        <Space size={4}>
          <Button size="small" icon={<PrinterOutlined />} onClick={() => openView(r)}>
            عرض / طباعة
          </Button>
          <DocumentHistoryButton iconOnly entityType="voucher" entityId={r.id}
            documentNumber={r.document_number} />
          {r.is_reversal ? (
            <Tag>عكسي</Tag>
          ) : (
          <Popconfirm
            title="مسح السند؟"
            description="سيُحذف هو وقيده، ويعود الرصيد إلى ما كان عليه."
            okText="مسح"
            cancelText="إلغاء"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteVoucher(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              مسح
            </Button>
          </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const voucherCols = useTableColumns('vouchers', voucherColumns);

  const totals = {
    receipts: vouchers.filter((v) => v.kind === 'receipt' && !v.is_reversal)
      .reduce((s, v) => s + Number(v.amount), 0),
    payments: vouchers.filter((v) => v.kind === 'payment' && !v.is_reversal)
      .reduce((s, v) => s + Number(v.amount), 0),
    handovers: vouchers.filter((v) => v.kind === 'rep_handover' && !v.is_reversal)
      .reduce((s, v) => s + Number(v.amount), 0),
  };

  const VOUCHER_TABS: Record<string, {
    kind: string; label: string; empty: string; file: string;
    kb: { tableProps: any }; create: string; onCreate: () => void;
  }> = {
    receipt: { kind: 'receipt', label: 'سند قبض',
      empty: 'لا توجد سندات قبض', file: 'سندات القبض', kb: receiptKb, create: 'سند قبض جديد',
      onCreate: () => { setReceiptTarget(''); openVoucher(receiptForm, setReceiptOpen); } },
    payment: { kind: 'payment', label: 'سند صرف',
      empty: 'لا توجد سندات صرف', file: 'سندات الصرف', kb: paymentKb, create: 'سند صرف جديد',
      onCreate: () => openVoucher(paymentForm, setPaymentOpen) },
    handover: { kind: 'rep_handover', label: 'توريد مندوب',
      empty: 'لا توجد سندات توريد', file: 'توريدات المناديب', kb: handoverKb, create: 'توريد جديد',
      onCreate: () => { handoverForm.resetFields(); setHandoverOpen(true); } },
    expense: { kind: 'expense', label: 'سند مصروف',
      empty: 'لا توجد مصروفات', file: 'سندات المصروفات', kb: expenseKb, create: 'مصروف جديد',
      onCreate: () => openVoucher(expenseForm, setExpenseOpen) },
    transfer: { kind: 'cash_transfer', label: 'تحويل بين الخزائن',
      empty: 'لا توجد تحويلات', file: 'التحويلات بين الخزائن', kb: transferKb, create: 'تحويل جديد',
      onCreate: () => { transferForm.resetFields(); setTransferOpen(true); } },
  };
  const vTab = VOUCHER_TABS[tab];


  const tabs: ListTab[] = [
    ...Object.entries(VOUCHER_TABS).map(([key, t]) => ({
      key, label: t.label, count: key === tab ? vTotal : undefined,
    })),
    { key: 'treasury-movement', label: 'حركة الخزينة' },
    { key: 'statement', label: 'كشف حساب' },
    { key: 'log', label: 'سجل السندات', count: tab === 'log' ? vTotal : undefined },
  ];

  const voucherFoot = (rows: VoucherRecord[]) => (
    <span className="sl-foot">
      <span>عدد: <b>{vTotal}</b></span>
      <span>إجمالي الصفحة: <b>{money(rows.filter((v) => !v.is_reversal)
        .reduce((s, v) => s + Number(v.amount), 0))}</b></span>
    </span>
  );

  const resetVoucherFilters = () => {
    setVoucherQuery('');
    setKindFilter(undefined);
    setRange(null);
  };

  const chequeColumns = [
    { title: 'المستند', dataIndex: 'document_number', width: 120 },
    {
      title: 'النوع',
      dataIndex: 'direction',
      width: 110,
      render: (v: string) => (
        <Tag color={v === 'incoming' ? 'green' : 'red'}>{v === 'incoming' ? 'وارد' : 'صادر'}</Tag>
      ),
    },
    { title: 'رقم الشيك', dataIndex: 'cheque_number', width: 110 },
    { title: 'البنك', dataIndex: 'bank_name', width: 120 },
    {
      title: 'المبلغ',
      dataIndex: 'amount',
      width: 130,
      align: 'left' as const,
      render: (v: string) => <b>{money(v)}</b>,
    },
    { title: 'الاستحقاق', dataIndex: 'due_date', width: 110 },
    { title: 'البيان', dataIndex: 'statement1', width: 160, ellipsis: true,
      render: (v: string | null) => v || '-' },
    {
      title: 'الحالة',
      dataIndex: 'status',
      width: 120,
      render: (v: string) => {
        const map: Record<string, [string, string]> = {
          pending: ['orange', 'تحت التحصيل'],
          settled: ['green', 'تم'],
          bounced: ['red', 'مرتد'],
          cancelled: ['default', 'ملغي'],
        };
        const [color, label] = map[v] || ['default', v];
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: '',
      width: 240,
      render: (_: any, c: any) =>
        c.status === 'settled' ? (
          <Popconfirm
            title="عكس التحصيل؟"
            description="ستعود القيمة إلى الحساب الوسيط وتخرج من الخزينة، ويعود الشيك تحت التحصيل."
            okText="عكس"
            cancelText="إلغاء"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              try {
                await api.post(`/api/v1/cheques/${c.id}/unsettle`);
                message.success('تم عكس التحصيل وأُعيد الشيك تحت التحصيل');
                loadCheques();
                loadTreasuries();
              } catch {
              }
            }}
          >
            <Button size="small" icon={<UndoOutlined />}>
              {c.direction === 'incoming' ? 'عكس التحصيل' : 'عكس الصرف'}
            </Button>
          </Popconfirm>
        ) : c.status !== 'pending' ? null : (
          <Space>
            <Button
              size="small"
              type="primary"
              onClick={async () => {
                try {
                  await api.post(`/api/v1/cheques/${c.id}/settle`, {});
                  message.success(c.direction === 'incoming' ? 'تم التحصيل ✔' : 'تم الصرف ✔');
                  loadCheques();
                  loadTreasuries();
                } catch {
                }
              }}
            >
              {c.direction === 'incoming' ? 'تحصيل' : 'صرف'}
            </Button>
            {c.direction === 'incoming' && (
              <Popconfirm
                title="ارتداد الشيك؟"
                description="سيعود الدين على العميل."
                okText="ارتداد"
                cancelText="إلغاء"
                okButtonProps={{ danger: true }}
                onConfirm={async () => {
                  try {
                    await api.post(`/api/v1/cheques/${c.id}/bounce`);
                    message.success('تم تسجيل الارتداد');
                    loadCheques();
                  } catch {
                  }
                }}
              >
                <Button size="small" danger>
                  ارتداد
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
    },
  ];

  const multiValue = (v: any) => (v === undefined || v === null || v === ''
    ? undefined : Array.isArray(v) ? v : [v]);

  const actions = (
    <>
      {vTab && (<>
        <Button type="primary" icon={<PlusOutlined />} className="sl-create" onClick={vTab.onCreate}>
          {vTab.create}
        </Button>
        <ExportExcelButton name={vTab.file} rows={byKind(vTab.kind)}
          tableColumns={voucherCols.columns} style={{ marginInlineStart: 0 }} />
        {voucherCols.control}
      </>)}
      {tab === 'cheques' && (<>
        <Button type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={() => { chequeForm.resetFields(); setChequeOpen(true); }}>
          ورقة جديدة
        </Button>
        <ExportExcelButton name="الشيكات" rows={chequeFilter.filtered}
          tableColumns={chequeColumns as any} style={{ marginInlineStart: 0 }} />
      </>)}
      {tab === 'statement' && statement && (
        <Button icon={<PrinterOutlined />} onClick={printStatement}>طباعة</Button>
      )}
      {tab === 'log' && (<>
        <ExportExcelButton name="سجل السندات" rows={shownVouchers}
          tableColumns={voucherCols.columns} style={{ marginInlineStart: 0 }} />
        {voucherCols.control}
      </>)}
      {(vTab || tab === 'log') && (
        <Button icon={<ReloadOutlined />} onClick={() => loadVouchers()}>تحديث</Button>
      )}
    </>
  );

  const voucherSearch = (
    <Input
      className="sl-f-search"
      allowClear
      ref={searchRef}
      value={voucherQuery}
      onChange={(e) => setVoucherQuery(e.target.value)}
      prefix={<SearchOutlined />}
      placeholder="بحث برقم السند أو الطرف أو البيان"
    />
  );
  const voucherDates = (
    <DateRangeFilter className="sl-f-dates" value={range as any} onChange={(v) => setRange(v as any)} />
  );

  let filters: React.ReactNode = null;
  if (vTab) {
    filters = (<>
      {voucherSearch}
      {voucherDates}
      <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetVoucherFilters}>مسح</Button>
    </>);
  } else if (tab === 'log') {
    filters = (<>
      {voucherSearch}
      <Select
        placeholder="نوع السند"
        allowClear
        value={kindFilter}
        onChange={setKindFilter}
        options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
      />
      {voucherDates}
      <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetVoucherFilters}>مسح</Button>
    </>);
  } else if (tab === 'treasury-movement') {
    filters = (<>
      <Select
        className="sl-f-customer" placeholder="اختر الخزينة" showSearch
        value={tmTreasuryId} onChange={setTmTreasuryId}
        options={sortByName(treasuries, (t) => t.name)
          .map((t) => ({ value: t.id, label: `${t.name} (${money(t.balance)})` }))}
        filterOption={searchFilter} filterSort={searchRank}
      />
      <DateRangeFilter className="sl-f-dates" value={tmRange} onChange={(v) => setTmRange(v)} />
    </>);
  } else if (tab === 'cheques') {
    filters = (<>
      <Input
        className="sl-f-search"
        allowClear
        ref={searchRef}
        value={chequeFilter.query}
        onChange={(e) => chequeFilter.setQuery(e.target.value)}
        prefix={<SearchOutlined />}
        placeholder="بحث برقم الشيك أو المستند أو البنك أو الطرف أو البيان"
      />
      <Select
        mode="multiple" maxTagCount="responsive" allowClear placeholder="النوع"
        value={multiValue(chequeFilter.values.direction)}
        onChange={(v) => chequeFilter.setValue('direction', v?.length ? v : undefined)}
        options={[{ value: 'incoming', label: 'وارد' }, { value: 'outgoing', label: 'صادر' }]}
      />
      <Select
        mode="multiple" maxTagCount="responsive" allowClear placeholder="الحالة"
        value={multiValue(chequeFilter.values.status)}
        onChange={(v) => chequeFilter.setValue('status', v?.length ? v : undefined)}
        options={[
          { value: 'pending', label: 'تحت التحصيل' },
          { value: 'settled', label: 'تم' },
          { value: 'bounced', label: 'مرتد' },
          { value: 'cancelled', label: 'ملغي' },
        ]}
      />
      <Input
        allowClear placeholder="البيان"
        value={chequeFilter.values.statement ?? undefined}
        onChange={(e) => chequeFilter.setValue('statement', e.target.value || undefined)}
      />
      <DateRangeFilter className="sl-f-dates" value={chequeFilter.range ?? null}
        onChange={(v) => chequeFilter.setRange(v)} />
      <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={chequeFilter.reset}>مسح</Button>
    </>);
  } else if (tab === 'statement') {
    filters = (<>
      <Select
        value={stKind}
        onChange={(v) => {
          setStKind(v);
          setStParty(undefined);
          setStatement(null);
        }}
        options={[
          { value: 'customer', label: 'عميل' },
          { value: 'supplier', label: 'مورد' },
          { value: 'rep', label: 'عهدة مندوب' },
        ]}
      />
      <Select
        className="sl-f-customer"
        showSearch
        placeholder="اختر الطرف"
        value={stParty}
        onChange={setStParty}
        options={stPartyOptions} filterOption={searchFilter} filterSort={searchRank}/>
      <DateRangeFilter className="sl-f-dates" value={stRange as any} onChange={(v) => setStRange(v as any)} />
      <Button type="primary" icon={<FileSearchOutlined />} onClick={loadStatement}
        style={{ flex: '0 0 auto' }}>
        عرض الكشف
      </Button>
    </>);
  }

  const voucherTable = (rows: VoucherRecord[], kbProps: any, empty: string) => (
    <Table<VoucherRecord>
      {...kbProps}
      className="sl-table"
      rowKey="id" size="small" loading={loading}
      dataSource={rows}
      columns={voucherCols.columns}
      locale={{ emptyText: empty }}
      pagination={serverPagination(() => voucherFoot(rows))}
      {...allRows(fetchAllVouchers)}
    />
  );

  let body: React.ReactNode = null;
  if (vTab) {
    body = (<>
      {voucherTable(byKind(vTab.kind), vTab.kb.tableProps, vTab.empty)}
      {tab === 'expense' && expenseAccounts.length === 0 && (
        <Alert
          type="info"
          showIcon
          style={{ margin: '4px 0 10px' }}
          message="لا توجد حسابات مصروفات"
          description="أضف حساب مصروف من شجرة الحسابات (طبيعة: مصروفات) حتى تتمكن من الصرف عليه."
        />
      )}
      {tab === 'transfer' && (<>
        <Table
          className="sl-table"
          rowKey="id"
          size="small"
          style={{ marginTop: 12 }}
          title={() => <b>الخزائن</b>}
          dataSource={treasuries}
          pagination={false}
          columns={[
            { title: 'الخزينة', dataIndex: 'name' },
            {
              title: 'النوع',
              dataIndex: 'kind',
              width: 100,
              render: (v: string) => (
                <Tag color={v === 'bank' ? 'purple' : 'gold'}>{v === 'bank' ? 'بنك' : 'نقدية'}</Tag>
              ),
            },
            { title: 'البنك', dataIndex: 'bank_name', width: 140 },
            {
              title: 'الرصيد',
              dataIndex: 'balance',
              width: 150,
              align: 'left' as const,
              render: (v: string) => <b>{money(v)}</b>,
            },
            {
              title: '',
              width: 110,
              render: (_: any, t: any) =>
                t.is_default ? <Tag color="blue">الافتراضية</Tag> : t.active ? null : <Tag>موقوفة</Tag>,
            },
          ]}
        />

        <Form
          form={treasuryForm}
          layout="inline"
          style={{ margin: '12px 0', rowGap: 8 }}
          onFinish={async (v) => {
            setPosting(true);
            try {
              await api.post('/api/v1/treasuries', v);
              message.success('تم إنشاء الخزينة ✔');
              treasuryForm.resetFields();
              loadTreasuries();
            } catch {
            } finally {
              setPosting(false);
            }
          }}
        >
          <Form.Item name="name" label="خزينة جديدة" rules={[{ required: true, message: 'اكتب الاسم' }]}>
            <Input placeholder="اسم الخزينة" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="kind" label="النوع" initialValue="cash">
            <Select
              style={{ width: 120 }}
              options={[
                { value: 'cash', label: 'نقدية' },
                { value: 'bank', label: 'بنك' },
              ]}
            />
          </Form.Item>
          <Form.Item name="bank_name" label="البنك">
            <Input placeholder="اختياري" style={{ width: 150 }} />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" loading={posting}>
              إضافة
            </Button>
          </Form.Item>
        </Form>
      </>)}
    </>);
  } else if (tab === 'treasury-movement') {
    body = <TreasuryMovementTab treasuries={treasuries} treasuryId={tmTreasuryId} range={tmRange} />;
  } else if (tab === 'cheques') {
    body = (
      <Table
        className="sl-table"
        rowKey="id"
        size="small"
        dataSource={chequeFilter.filtered}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          showTotal: () => (
            <span className="sl-foot">
              <span>المعروض: <b>{chequeFilter.filtered.length}</b> من {cheques.length}</span>
              <span>الإجمالي: <b>{money(chequeFilter.filtered
                .reduce((s: number, c: any) => s + Number(c.amount || 0), 0))}</b></span>
            </span>
          ),
        }}
        columns={chequeColumns}
      />
    );
  } else if (tab === 'statement') {
    body = statement ? (
      <Table<StatementLine>
        className="sl-table"
        rowKey={(r) => `${r.entry_id}-${r.entry_date}-${r.debit}-${r.credit}`}
        loading={stLoading}
        dataSource={statement.lines}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          showTotal: () => (
            <span className="sl-foot">
              <span>رصيد أول المدة: <b>{money(statement.opening_balance)}</b></span>
              <span>إجمالي مدين: <b>{money(statement.total_debit)}</b></span>
              <span>إجمالي دائن: <b>{money(statement.total_credit)}</b></span>
              <span>الرصيد النهائي: <b
                className={Number(statement.closing_balance) > 0 ? 'is-neg' : 'is-pos'}>
                {money(statement.closing_balance)}
              </b></span>
            </span>
          ),
        }}
        size="small"
        columns={[
          { title: 'التاريخ', dataIndex: 'entry_date', width: 110,
            render: (d: string) => String(d || '').slice(0, 10) },
          {
            title: 'النوع',
            dataIndex: 'entry_type',
            width: 120,
            render: (v: string) => entryTypeLabel(v),
          },
          { title: 'البيان', dataIndex: 'description' },
          {
            title: 'مدين',
            dataIndex: 'debit',
            width: 110,
            align: 'left' as const,
            render: (v: string) => (Number(v) ? money(v) : ''),
          },
          {
            title: 'دائن',
            dataIndex: 'credit',
            width: 110,
            align: 'left' as const,
            render: (v: string) => (Number(v) ? money(v) : ''),
          },
          {
            title: 'الرصيد',
            dataIndex: 'balance',
            width: 120,
            align: 'left' as const,
            render: (v: string) => <b>{money(v)}</b>,
          },
        ]}
      />
    ) : (
      <Empty style={{ padding: '32px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={stLoading ? 'جاري التحميل…' : 'اختر الطرف واضغط «عرض الكشف»'} />
    );
  } else if (tab === 'log') {
    body = (
      <Table<VoucherRecord>
        className="sl-table"
        rowKey="id"
        loading={loading}
        dataSource={shownVouchers}
        columns={voucherCols.columns}
        {...allRows(fetchAllVouchers)}
        pagination={serverPagination((t) => (
          <span className="sl-foot">
            <span>عدد: <b>{t}</b></span>
            <span>تحصيل الصفحة: <b className="is-pos">{money(totals.receipts)}</b></span>
            <span>مدفوعات الصفحة: <b className="is-neg">{money(totals.payments)}</b></span>
            <span>توريدات الصفحة: <b>{money(totals.handovers)}</b></span>
          </span>
        ))}
        size="small"
      />
    );
  }

  if (docOpening) return <DocOpening />;
  return (
    <>
    <ListPage
      icon={<WalletOutlined />}
      title="سندات القبض والصرف"
      muted={vTab ? `(${vTab.label})` : undefined}
      tabs={tabs} activeTab={tab} onTabChange={setTab}
      actions={actions}
      filters={filters}
    >
      <div style={{ paddingTop: 6 }}>
        <VoucherKeyStrip world={keyWorld}
          onPosted={() => { loadVouchers(); loadTreasuries(); }} />
      </div>
      {body}
    </ListPage>

      <TabModal
        open={voucherView !== null}
        title={(
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {`${voucherView ? VOUCHER_TITLES[voucherView.kind as VoucherDoc['kind']] : 'سند'} ${voucherView?.document_number ?? ''}`}
            <DocumentHistoryButton entityType="voucher" entityId={voucherView?.id}
              documentNumber={voucherView?.document_number} />
          </span>
        )}
        onCancel={closeView}
        footer={voucherFooter(voucherDoc(voucherView), closeView)}
        width={760}
        centered
        destroyOnHidden
      >
        {voucherView && <VoucherDocument doc={voucherDoc(voucherView)!} />}
        {voucherView && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginTop: 12 }}>
              <Descriptions.Item label="رقم المستند">
                {voucherView.external_document_number || '-'}
              </Descriptions.Item>
            </Descriptions>
            <DocumentAttachments docType="voucher" docId={voucherView.id} />
          </>
        )}
      </TabModal>

      <ReceiptModal
        open={receiptOpen} onCancel={() => setReceiptOpen(false)}
        form={receiptForm} posting={posting} submit={submit}
        customers={customers} treasuries={treasuries} methodOptions={methodOptions}
        families={receiptFamilies} setFamilies={setReceiptFamilies}
        target={receiptTarget} setTarget={setReceiptTarget}
        reps={reps} suppliers={suppliers}
      />

      <PaymentModal
        open={paymentOpen} onCancel={() => setPaymentOpen(false)}
        form={paymentForm} posting={posting} submit={submit}
        suppliers={suppliers} treasuries={treasuries} methodOptions={methodOptions}
        customers={customers}
      />

      <HandoverModal
        open={handoverOpen} onCancel={() => setHandoverOpen(false)}
        form={handoverForm} posting={posting} submit={submit} reps={reps}
      />

      <ExpenseModal
        open={expenseOpen} onCancel={() => setExpenseOpen(false)}
        form={expenseForm} posting={posting} submit={submit}
        expenseAccounts={expenseAccounts} expenseGroups={expenseGroups}
        loadExpenseAccounts={loadExpenseAccounts} treasuries={treasuries}
      />

      <TransferModal
        open={transferOpen} onCancel={() => setTransferOpen(false)}
        form={transferForm} posting={posting} submit={submit} treasuries={treasuries}
      />

      <ChequeModal
        open={chequeOpen} onCancel={() => setChequeOpen(false)}
        form={chequeForm} posting={posting} setPosting={setPosting}
        customers={customers} suppliers={suppliers}
        onSaved={loadCheques} defaultDirection={chequeDir}
      />
    </>
  );
};

export default Vouchers;
