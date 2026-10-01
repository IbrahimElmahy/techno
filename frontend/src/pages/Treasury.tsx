import React, { useEffect, useRef, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import {
  Button, Col, Divider, Form, Input, Row, Select, Space, Tag, message,
} from 'antd';
// فلتر على كل عمود — شوف `FilterTable`.
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import {
  ClearOutlined, PlusOutlined, RollbackOutlined, SearchOutlined, SwapOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import ListPage from '../components/ListPage';
import { textColumn, numberColumn, choiceColumn } from '../components/gridColumns';
import { entryTypeLabel } from '../components/labels';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { money, numeralsLocale } from '../utils/money';

interface LedgerLine {
  id: number;
  account_id: number;
  direction: 'debit' | 'credit';
  amount: string;
}

interface LedgerEntry {
  id: number;
  entry_type: string;
  description: string;
  actor_user_id: number;
  rep_id: number | null;
  branch_id: number | null;
  reverses_entry_id: number | null;
  lines: LedgerLine[];
}

interface Account {
  id: number;
  account_type: string;
  normal_side: string;
}

interface JournalLineInput {
  key: string;
  account_id: number | null;
  direction: 'debit' | 'credit';
  amount: number;
}

export default function Treasury() {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<string>('...');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountNames, setAccountNames] = useState<Record<number, string>>({});
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  const branchName = (id: number | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? `فرع #${id}`) : 'عام (إداري)';

  const accountDisplay = (accountId: number) => {
    const name = accountNames[accountId];
    if (name) return `${name} (#${accountId})`;
    const acc = accounts.find((a) => a.id === accountId);
    return acc ? `${acc.account_type} (#${acc.id})` : `حساب #${accountId}`;
  };

  const filter = useListFilter(entries, {
    search: (e) => [e.id, entryTypeLabel(e.entry_type), e.description,
      branchName(e.branch_id)],
    filters: {
      entry_type: (e, v) => e.entry_type === v,
      branch_id: (e, v) => (v === 0 ? e.branch_id === null : e.branch_id === v),
      reversal: (e, v) => (v === 'reversal' ? !!e.reverses_entry_id : !e.reverses_entry_id),
    },
  });

  const entryTypeOptions = Array.from(new Set(entries.map((e) => e.entry_type).filter(Boolean)))
    .map((t) => ({ value: t, label: t }));

  const [form] = Form.useForm();
  const [journalLines, setJournalLines] = useState<JournalLineInput[]>([
    { key: '1', account_id: null, direction: 'debit', amount: 0 },
    { key: '2', account_id: null, direction: 'credit', amount: 0 },
  ]);

  const fetchBalance = async () => {
    try {
      const res = await api.get('/api/v1/treasury/balance');
      setBalance(parseFloat(res.data.balance).toLocaleString(numeralsLocale(), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }));
    } catch (err) {
      console.error(err);
      setBalance('خطأ');
    }
  };

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/ledger/entries');
      setEntries(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadLookups = async () => {
    try {
      const [accRes, branchRes] = await Promise.all([
        api.get('/api/v1/ledger/accounts'),
        api.get('/api/v1/branches'),
      ]);
      setAccounts(accRes.data);
      setBranches(branchRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAccountNames = async () => {
    try {
      const res = await api.get('/api/v1/accounts');
      const map: Record<number, string> = {};
      for (const a of res.data as any[]) {
        map[a.id] = a.owner_name || a.name || '';
      }
      setAccountNames(map);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchBalance();
    fetchEntries();
    loadLookups();
    loadAccountNames();
  }, []);

  const handleReverse = (record: LedgerEntry) => {
    showReversalConfirm({
      title: 'إلغاء وعكس قيد اليومية',
      content: `هل أنت متأكد من إلغاء وعكس القيد رقم #${record.id} (${record.entry_type})؟ سيتم إنشاء قيد يومية عكسي متوازن بالكامل لإلغاء الأرصدة المالية المقابلة.`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/ledger/entries/${record.id}/reverse`);
          message.success('تم عكس قيد اليومية بنجاح');
          fetchBalance();
          fetchEntries();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const totalDebits = journalLines
    .filter((l) => l.direction === 'debit')
    .reduce((sum, l) => sum + l.amount, 0);

  const totalCredits = journalLines
    .filter((l) => l.direction === 'credit')
    .reduce((sum, l) => sum + l.amount, 0);

  const handleAddLine = () => {
    const newKey = (journalLines.length + 1).toString();
    setJournalLines([
      ...journalLines,
      { key: newKey, account_id: null, direction: 'debit', amount: 0 },
    ]);
  };

  const handleRemoveLine = (key: string) => {
    if (journalLines.length <= 2) {
      message.warning('يجب وجود سطرين على الأقل في القيد المزدوج!');
      return;
    }
    setJournalLines(journalLines.filter((l) => l.key !== key));
  };

  const handleLineChange = (key: string, field: keyof JournalLineInput, value: any) => {
    setJournalLines(
      journalLines.map((l) => (l.key === key ? { ...l, [field]: value } : l))
    );
  };

  const onManualPost = async (values: any) => {
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      message.error('عذراً، يجب أن يتساوى مجموع الحسابات المدينة والدائنة لقيد اليومية!');
      return;
    }

    const validLines = journalLines.filter((l) => l.account_id !== null);
    if (validLines.length < 2) {
      message.error('يرجى إدخال حسابين صالحين على الأقل للقيد!');
      return;
    }

    try {
      await api.post('/api/v1/ledger/entries', {
        entry_type: values.entry_type,
        description: values.description,
        branch_id: values.branch_id || null,
        lines: validLines.map((l) => ({
          account_id: l.account_id,
          direction: l.direction,
          amount: l.amount,
        })),
      });

      message.success('تم ترحيل قيد اليومية بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      setJournalLines([
        { key: '1', account_id: null, direction: 'debit', amount: 0 },
        { key: '2', account_id: null, direction: 'credit', amount: 0 },
      ]);
      fetchBalance();
      fetchEntries();
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    {
      title: 'كود القيد',
      dataIndex: 'id',
      key: 'id',
      ...numberColumn<LedgerEntry>((e) => e.id),
      render: (id: number) => <Tag color="blue">#{id}</Tag>,
    },
    {
      title: 'نوع القيد',
      dataIndex: 'entry_type',
      key: 'entry_type',
      ...textColumn(entries, (e: LedgerEntry) => entryTypeLabel(e.entry_type)),
      render: (t: string) => entryTypeLabel(t),
    },
    {
      title: 'البيان (الوصف)',
      dataIndex: 'description',
      key: 'description',
      ...textColumn(entries, (e: LedgerEntry) => e.description),
    },
    {
      title: 'الفرع المسؤول',
      dataIndex: 'branch_id',
      key: 'branch_id',
      ...textColumn(entries, (e: LedgerEntry) => branchName(e.branch_id)),
      render: (branchId: number | null) => {
        if (!branchId) return 'عام (إداري)';
        const branch = branches.find((b) => b.id === branchId);
        return branch ? branch.name : `فرع #${branchId}`;
      },
    },
    {
      title: 'الحركات المالية والتسويات المزدوجة',
      dataIndex: 'lines',
      key: 'lines',
      ...numberColumn<LedgerEntry>(
        (e) => (e.lines || []).reduce((t, l) => t + Number(l.amount || 0), 0)),
      render: (lines: LedgerLine[]) => (
        <div style={{ padding: '4px 0' }}>
          {lines.map((line) => (
            <div key={line.id} style={{ fontSize: '13px', marginBottom: 4 }}>
              <span style={{ color: line.direction === 'debit' ? '#6AB42D' : '#F5A11D' }}>
                {line.direction === 'debit' ? '[مدين] ' : '[دائن] '}
              </span>
              <span>{accountDisplay(line.account_id)}: </span>
              <strong>{money(line.amount)}</strong>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'معكوس للقيد',
      dataIndex: 'reverses_entry_id',
      key: 'reverses_entry_id',
      ...choiceColumn<LedgerEntry>(
        [{ text: 'قيد عكسي', value: 'yes' }, { text: 'قيد أصلي', value: 'no' }],
        (e, v) => (v === 'yes' ? e.reverses_entry_id !== null : e.reverses_entry_id === null)),
      render: (rev: number | null) => (rev ? <Tag color="red">عكس لقيد #{rev}</Tag> : '-'),
    },
    {
      title: 'التراجع',
      key: 'actions',
      render: (_: any, record: LedgerEntry) => (
        <Space size="middle">
          {!record.reverses_entry_id &&
            !entries.some((e) => e.reverses_entry_id === record.id) && (
              <Button
                type="link"
                danger
                icon={<RollbackOutlined />}
                onClick={() => handleReverse(record)}
              >
                تراجع وعكس القيد
              </Button>
            )}
        </Space>
      ),
    },
  ];

  const tableCols = useTableColumns('treasury-moves', columns, {
    export: { name: 'الحسابات المالية', rows: filter.filtered },
  });

  const kb = useTableKeyboard<LedgerEntry>({
    rows: filter.filtered, rowKey: (e) => e.id,
    onOpen: (e) => { const a = e.lines?.[0]?.account_id;
      if (a) navigate(`/account-statement?account=${a}`); },
  });

  // F3 — خانة البحث (كانت جوّه `ListToolbar`).
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => searchRef.current?.focus?.() });

  // قوايم الفلاتر بتقبل أكتر من قيمة — زي ما كانت في `ListToolbar`.
  const multi = (key: string) => ({
    mode: 'multiple' as const,
    maxTagCount: 'responsive' as const,
    allowClear: true,
    showSearch: true,
    value: filter.values[key] === undefined || filter.values[key] === null
      ? undefined : ([] as any[]).concat(filter.values[key]),
    onChange: (v: any[]) => filter.setValue(key, v?.length ? v : undefined),
    filterOption: searchFilter,
    filterSort: searchRank,
  });

  return (
    <>
    <ListPage
      icon={<SwapOutlined />}
      title="حركة خزينه" muted="(دفتر أستاذ القيود المزدوجة)"
      subtitle="القيود المرحّلة على الحسابات المالية، والتسوية اليدوية والعكس"
      actions={(<>
        <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
          onClick={() => setDrawerVisible(true)}>
          تسوية يدوية (قيد يومية جديد)
        </Button>
        {tableCols.control}
      </>)}
      filters={(<>
        <Input
          className="sl-f-search"
          allowClear
          ref={searchRef}
          value={filter.query}
          placeholder="بحث برقم القيد أو النوع أو البيان"
          prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)}
        />
        <Select placeholder="نوع القيد" options={entryTypeOptions} {...multi('entry_type')} />
        <Select placeholder="الفرع" {...multi('branch_id')}
          options={[{ value: 0, label: 'عام (إداري)' },
            ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
        <Select placeholder="العكس" {...multi('reversal')}
          options={[{ value: 'reversal', label: 'قيود عكسية' }, { value: 'normal', label: 'قيود أصلية' }]} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table
        {...kb.tableProps}
        className="sl-table"
        size="small"
        dataSource={filter.filtered}
        columns={tableCols.columns}
        rowKey="id"
        loading={loading}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          // رصيد الخزينة الموحد — كان كارت كبير فوق، دلوقت في سطر الترقيم.
          showTotal: () => (
            <span className="sl-foot">
              <span>رصيد الخزينة الموحد (السيولة المتوفرة): <b className="is-pos">{balance}</b></span>
              <span>المعروض: <b>{filter.filtered.length}</b> من {entries.length}</span>
            </span>
          ),
        }}
      />
    </ListPage>

      <TabModal footer={null} centered
        title="تسجيل قيد تسوية يدوية"
        width={550}
        onCancel={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onManualPost} requiredMark={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="entry_type"
                label="نوع التسوية"
                rules={[{ required: true, message: 'يرجى إدخال نوع التسوية!' }]}
              >
                <Input placeholder="مثال: تسوية عهدة، إيداع رأسمال" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branch_id" label="الفرع المرتبط (اختياري)">
                <Select placeholder="اختر الفرع" allowClear>
                  {branches.map((b) => (
                    <Select.Option key={b.id} value={b.id}>
                      {b.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label="البيان / الوصف"
            rules={[{ required: true, message: 'يرجى كتابة البيان!' }]}
          >
            <Input.TextArea placeholder="اكتب سبباً للتسوية أو تفاصيل إضافية للحركة" rows={2} />
          </Form.Item>

          <Divider orientation="right">حركات القيد المزدوج</Divider>

          {journalLines.map((line) => (
            <Row gutter={12} key={line.key} align="middle" style={{ marginBottom: 12 }}>
              <Col span={10}>
                <Select showSearch
                  placeholder="الحساب المالي"
                  style={{ width: '100%' }}
                  value={line.account_id}
                  onChange={(val) => handleLineChange(line.key, 'account_id', val)} filterOption={searchFilter} filterSort={searchRank}>
                  {accounts.map((a) => (
                    <Select.Option key={a.id} value={a.id}>
                      {accountDisplay(a.id)}
                    </Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={6}>
                <Select
                  value={line.direction}
                  onChange={(val) => handleLineChange(line.key, 'direction', val)}
                  style={{ width: '100%' }}
                >
                  <Select.Option value="debit">مدين [Debit]</Select.Option>
                  <Select.Option value="credit">دائن [Credit]</Select.Option>
                </Select>
              </Col>
              <Col span={6}>
                <InputNumber
                  min={0.01}
                  style={{ width: '100%' }}
                  value={line.amount}
                  onChange={(val) => handleLineChange(line.key, 'amount', val || 0)}
                  placeholder="المبلغ"
                />
              </Col>
              <Col span={2}>
                <Button type="text" danger onClick={() => handleRemoveLine(line.key)}>
                  حذف
                </Button>
              </Col>
            </Row>
          ))}

          <Button type="dashed" onClick={handleAddLine} block icon={<PlusOutlined />} style={{ marginBottom: 24 }}>
            إضافة حركة للقيد
          </Button>

          <Divider />

          <Row gutter={16}>
            <Col span={12}>
              <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 8, textAlign: 'center' }}>
                <span style={{ fontSize: '13px', color: '#888' }}>إجمالي الحركات المدينة</span>
                <h3 style={{ margin: '4px 0 0', color: '#6AB42D' }}>{money(totalDebits)}</h3>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 8, textAlign: 'center' }}>
                <span style={{ fontSize: '13px', color: '#888' }}>إجمالي الحركات الدائنة</span>
                <h3 style={{ margin: '4px 0 0', color: '#F5A11D' }}>{money(totalCredits)}</h3>
              </div>
            </Col>
          </Row>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                ترحيل قيد التسوية
              </Button>
              <Button onClick={() => setDrawerVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </TabModal>
    </>
  );
}
