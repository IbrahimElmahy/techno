import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Col, Empty, Row, Skeleton, Space, Tag, Tooltip } from 'antd';
import { Statistic } from '../components/Statistic';
import {
  ReloadOutlined, PlusOutlined, FileTextOutlined, BankOutlined,
  SafetyCertificateOutlined, WalletOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

import StatsRow from '../components/StatsRow';

interface JournalCard {
  id: number;
  code: string;
  name: string;
  kind: string;
  kind_label: string;
  restrict_mode_hash: boolean;
  draft_count: number;
  month_entries: number;
  month_total: string;
  open_residual: string;
  last_number: string | null;
  last_date: string | null;
}

interface TreasuryCard {
  id: number;
  name: string;
  kind: string;
  bank_name: string | null;
  is_default: boolean;
  balance: string;
}

const money = (v: string | number) =>
  Number(v).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const KIND_COLOR: Record<string, string> = {
  sale: 'green', purchase: 'orange', cash: 'gold', bank: 'blue', general: 'purple',
};

function primaryAction(card: JournalCard): { label: string; to: string } {
  switch (card.kind) {
    case 'sale': return { label: 'فاتورة بيع', to: '/invoices?new=1' };
    case 'purchase': return { label: 'فاتورة شراء', to: '/purchases?new=1' };
    case 'cash': return { label: 'سند قبض', to: '/vouchers?tab=receipt' };
    case 'bank': return { label: 'سند قبض', to: '/vouchers?tab=receipt' };
    default: return { label: 'سند صرف', to: '/vouchers?tab=payment' };
  }
}

export default function AccountingDashboard() {
  const navigate = useNavigate();
  const [journals, setJournals] = useState<JournalCard[]>([]);
  const [treasuries, setTreasuries] = useState<TreasuryCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/v1/accounting/dashboard');
      setJournals(data?.journals || []);
      setTreasuries(data?.treasuries || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space wrap>
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        <Button icon={<BankOutlined />} onClick={() => navigate('/general-ledger?tab=trial')}>
          ميزان المراجعة
        </Button>
        <Button icon={<FileTextOutlined />} onClick={() => navigate('/finance-reports?tab=income')}>
          التقارير المالية
        </Button>
      </Space>

      <div>
        <h3 style={{ margin: '0 0 10px' }}>دفاتر اليومية</h3>
        {journals.length === 0 ? <Empty description="لا توجد دفاتر" /> : (
          <StatsRow gutter={[16, 16]}>
            {journals.map((j) => {
              const action = primaryAction(j);
              return (
                <Col key={j.id} xs={24} sm={12} lg={8} xxl={6}>
                  <Card
                    size="small"
                    title={
                      <Space size={6}>
                        <Tag color={KIND_COLOR[j.kind] || 'default'}>{j.code}</Tag>
                        <span>{j.name}</span>
                        {j.restrict_mode_hash && (
                          <Tooltip title="سلسلة التجزئة مفعّلة — لا يمكن تعديل القيود">
                            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
                          </Tooltip>
                        )}
                      </Space>
                    }
                    extra={
                      <Button type="primary" size="small" icon={<PlusOutlined />}
                              onClick={() => navigate(action.to)}>
                        {action.label}
                      </Button>
                    }
                  >
                    <Row gutter={8}>
                      <Col span={12}>
                        <Statistic
                          title="حركة الشهر" value={Number(j.month_total)} precision={2}
                          valueStyle={{ fontSize: 18 }}
                          suffix={<span style={{ fontSize: 14, color: '#888' }}>
                            · {j.month_entries} قيد
                          </span>}
                        />
                      </Col>
                      <Col span={12}>
                        <Statistic
                          title="مفتوح" value={Number(j.open_residual)} precision={2}
                          valueStyle={{ fontSize: 18, color: Number(j.open_residual) ? '#d64545' : undefined }}
                        />
                      </Col>
                    </Row>

                    <Space wrap size={6} style={{ marginTop: 10 }}>
                      <Badge count={j.draft_count} offset={[-6, 2]}>
                        <Button size="small" type={j.draft_count ? 'default' : 'text'}
                          disabled={!j.draft_count}
                          onClick={() => navigate(
                            `/general-ledger?tab=journal&journal=${j.id}&state=draft`)}>
                          مسودات
                        </Button>
                      </Badge>
                      <Button size="small" type="text" icon={<ArrowLeftOutlined />}
                        onClick={() => navigate(`/general-ledger?tab=journal&journal=${j.id}`)}>
                        قيود الدفتر
                      </Button>
                      {Number(j.open_residual) > 0 && (
                        <Button size="small" type="text" onClick={() => navigate('/reconciliation')}>
                          تسوية
                        </Button>
                      )}
                    </Space>

                    <div style={{ marginTop: 8, color: '#888', fontSize: 14 }}>
                      {j.last_number
                        ? <>آخر قيد: {j.last_number} · {j.last_date}</>
                        : 'لا توجد قيود بعد'}
                    </div>
                  </Card>
                </Col>
              );
            })}
          </StatsRow>
        )}
      </div>

      <div>
        <h3 style={{ margin: '0 0 10px' }}>الخزن والبنوك</h3>
        {treasuries.length === 0 ? <Empty description="لا توجد خزائن" /> : (
          <StatsRow gutter={[16, 16]}>
            {treasuries.map((t) => (
              <Col key={t.id} xs={24} sm={12} lg={8} xxl={6}>
                <Card
                  size="small"
                  title={
                    <Space size={6}>
                      <WalletOutlined style={{ color: t.kind === 'bank' ? '#1677ff' : '#d4a017' }} />
                      <span>{t.name}</span>
                      {t.is_default && <Tag color="green">الافتراضية</Tag>}
                    </Space>
                  }
                  extra={
                    <Button size="small" onClick={() => navigate('/treasury')}>الحركة</Button>
                  }
                >
                  <Statistic
                    value={Number(t.balance)} precision={2}
                    valueStyle={{ fontSize: 22, color: Number(t.balance) < 0 ? '#d64545' : '#0e4c6d' }}
                  />
                  <div style={{ color: '#888', fontSize: 14 }}>
                    {t.bank_name || (t.kind === 'bank' ? 'بنك' : 'خزنة نقدية')}
                  </div>
                </Card>
              </Col>
            ))}
          </StatsRow>
        )}
      </div>
    </Space>
  );
}
