import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, InputNumber, Select, Tag, message, Row, Col, Divider } from 'antd';
import { PlusOutlined, RollbackOutlined, WalletOutlined, FileSearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';

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
  const [balance, setBalance] = useState<string>('...');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Manual Journal inputs
  const [form] = Form.useForm();
  const [journalLines, setJournalLines] = useState<JournalLineInput[]>([
    { key: '1', account_id: null, direction: 'debit', amount: 0 },
    { key: '2', account_id: null, direction: 'credit', amount: 0 },
  ]);

  const fetchBalance = async () => {
    try {
      const res = await api.get('/api/v1/treasury/balance');
      setBalance(parseFloat(res.data.balance).toLocaleString('ar-EG', {
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

  useEffect(() => {
    fetchBalance();
    fetchEntries();
    loadLookups();
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

  // Dynamic journal calculations
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
      render: (id: number) => <Tag color="blue">#{id}</Tag>,
    },
    {
      title: 'نوع القيد',
      dataIndex: 'entry_type',
      key: 'entry_type',
    },
    {
      title: 'البيان (الوصف)',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: 'الفرع المسؤول',
      dataIndex: 'branch_id',
      key: 'branch_id',
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
      render: (lines: LedgerLine[]) => (
        <div style={{ padding: '4px 0' }}>
          {lines.map((line) => {
            const acc = accounts.find((a) => a.id === line.account_id);
            const accName = acc ? `${acc.account_type} (#${acc.id})` : `حساب #${line.account_id}`;
            return (
              <div key={line.id} style={{ fontSize: '13px', marginBottom: 4 }}>
                <span style={{ color: line.direction === 'debit' ? '#6AB42D' : '#F5A11D' }}>
                  {line.direction === 'debit' ? '[مدين] ' : '[دائن] '}
                </span>
                <span>{accName}: </span>
                <strong>{parseFloat(line.amount).toFixed(2)} ج.م</strong>
              </div>
            );
          })}
        </div>
      ),
    },
    {
      title: 'معكوس للقيد',
      dataIndex: 'reverses_entry_id',
      key: 'reverses_entry_id',
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

  return (
    <div>
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  backgroundColor: '#6AB42D',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  color: '#fff',
                  fontSize: 20,
                  marginLeft: 16,
                }}
              >
                <WalletOutlined />
              </div>
              <div>
                <span style={{ color: '#888', fontSize: 13 }}>رصيد الخزينة الموحد (السيولة المتوفرة)</span>
                <h2 style={{ margin: 0, color: '#6AB42D' }}>{balance} ج.م</h2>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        title="الحسابات المالية (دفتر أستاذ القيود المزدوجة)"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerVisible(true)}>
            تسوية يدوية (قيد يومية جديد)
          </Button>
        }
      >
        <Table
          dataSource={entries}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Manual Entry Drawer */}
      <Drawer
        title="تسجيل قيد تسوية يدوية"
        width={550}
        onClose={() => setDrawerVisible(false)}
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

          {journalLines.map((line, idx) => (
            <Row gutter={12} key={line.key} align="middle" style={{ marginBottom: 12 }}>
              <Col span={10}>
                <Select
                  placeholder="الحساب المالي"
                  style={{ width: '100%' }}
                  value={line.account_id}
                  onChange={(val) => handleLineChange(line.key, 'account_id', val)}
                >
                  {accounts.map((a) => (
                    <Select.Option key={a.id} value={a.id}>
                      {a.account_type} (#{a.id})
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
                <h3 style={{ margin: '4px 0 0', color: '#6AB42D' }}>{totalDebits.toFixed(2)} ج.م</h3>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 8, textAlign: 'center' }}>
                <span style={{ fontSize: '13px', color: '#888' }}>إجمالي الحركات الدائنة</span>
                <h3 style={{ margin: '4px 0 0', color: '#F5A11D' }}>{totalCredits.toFixed(2)} ج.m</h3>
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
      </Drawer>
    </div>
  );
}
