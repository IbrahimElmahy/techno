import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, List, Row, Skeleton, Space, Tag, Tooltip } from 'antd';
import {
  ReloadOutlined, ArrowLeftOutlined, CheckCircleFilled,
  CloseCircleFilled, WarningFilled, InfoCircleFilled,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

/**
 * الصفحة الرئيسية — فيه إيه غلط، من غير ما تسأل.
 *
 * The home screen was a placeholder, and what filled that space in most systems is a wall of
 * totals: sales this month, customer count, a chart. Numbers nobody acts on, on the one screen
 * everybody opens first.
 *
 * This asks the only question worth putting there. Every problem it shows was already visible on
 * some screen — the reorder report knows what is below its minimum, the balance list knows what is
 * negative, the invoice knows its cost was never captured. Finding them meant opening fourteen
 * screens every morning, so nobody found them, and an item priced at nothing kept being sold at
 * nothing.
 *
 * Three rules the layout follows:
 *
 * * **Worst first, always.** A wrong number outranks a missing one, and both outrank a threshold
 *   somebody chose. Sorting by count would put four hundred uncategorised items above one ledger
 *   entry that does not balance.
 * * **Every finding goes somewhere.** A count with nowhere to click is a complaint. Each card
 *   carries the screen that fixes it.
 * * **Clean is a real answer.** An empty page has to say «مفيش حاجة غلط» in as many words —
 *   otherwise a healthy system and a broken endpoint look identical, and the healthy day is the
 *   common one.
 */

interface Sample { label: string; detail: string }

interface Issue {
  key: string;
  title: string;
  group: string;
  severity: 'high' | 'medium' | 'low';
  count: number;
  hint: string;
  link: string;
  samples: Sample[];
}

interface Health {
  generated_at: string;
  clean: boolean;
  totals: { high: number; medium: number; low: number };
  issues: Issue[];
}

/** Severity is about consequence, not about how many rows matched. */
const SEVERITY: Record<Issue['severity'], {
  label: string; color: string; icon: React.ReactNode; note: string;
}> = {
  high: {
    label: 'خطر',
    color: '#cf1322',
    icon: <CloseCircleFilled />,
    note: 'فيه رقم في النظام بقى غلط',
  },
  medium: {
    label: 'محتاج تظبيط',
    color: '#d46b08',
    icon: <WarningFilled />,
    note: 'مفيش حاجة بايظة، بس فيه قرار بيتاخد على بيانات ناقصة',
  },
  low: {
    label: 'للعلم',
    color: '#0958d9',
    icon: <InfoCircleFilled />,
    note: 'حد انتوا حطتوه واتعدّى',
  },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<Health>('/api/v1/reports/health');
      setData(res.data);
    } catch (err) {
      // A failure has to look different from a clean system. Rendering «كله تمام» because the
      // request died is the worst thing this screen could do.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const header = (
    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
      <Col>
        <h2 style={{ margin: 0 }}>فحص النظام</h2>
        <span style={{ color: '#8a8a8a', fontSize: 13 }}>
          كل حاجة فيها خلل — المنتجات والأرصدة والفواتير والحسابات
        </span>
      </Col>
      <Col>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          إعادة الفحص
        </Button>
      </Col>
    </Row>
  );

  if (loading && !data) {
    return <div>{header}<Card><Skeleton active paragraph={{ rows: 6 }} /></Card></div>;
  }

  if (failed) {
    return (
      <div>
        {header}
        <Alert type="error" showIcon
          message="الفحص نفسه مانجحش"
          description="مش معناه إن مفيش مشاكل — معناه إننا مانعرفش. جرّب إعادة الفحص."
          action={<Button size="small" onClick={load}>إعادة المحاولة</Button>} />
      </div>
    );
  }

  if (!data) return <div>{header}<Empty /></div>;

  if (data.clean) {
    return (
      <div>
        {header}
        <Card>
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <CheckCircleFilled style={{ fontSize: 56, color: '#6AB42D' }} />
            <h3 style={{ marginTop: 16, marginBottom: 4 }}>مفيش حاجة غلط</h3>
            <div style={{ color: '#8a8a8a' }}>
              كل الفحوصات عدّت: مفيش رصيد سالب، ولا قيد مش متوازن، ولا فاتورة ناقصة تكلفة.
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {header}

      {/* The count per severity, said in words. «٣ خطر» means nothing without «فيه رقم بقى غلط». */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {(['high', 'medium', 'low'] as const).map((sev) => {
          const s = SEVERITY[sev];
          const n = data.totals[sev];
          return (
            <Col xs={24} md={8} key={sev}>
              <Card size="small" style={{ borderInlineStart: `4px solid ${n ? s.color : '#e8e8e8'}` }}>
                <Space align="start">
                  <span style={{ color: n ? s.color : '#bfbfbf', fontSize: 22 }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
                      {n} <span style={{ fontSize: 14, fontWeight: 500 }}>{s.label}</span>
                    </div>
                    <div style={{ color: '#8a8a8a', fontSize: 12 }}>{s.note}</div>
                  </div>
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Row gutter={[12, 12]}>
        {data.issues.map((issue) => {
          const s = SEVERITY[issue.severity];
          return (
            <Col xs={24} lg={12} key={issue.key}>
              <Card
                size="small"
                style={{ height: '100%', borderInlineStart: `4px solid ${s.color}` }}
                title={
                  <Space size={8} wrap>
                    <span style={{ color: s.color }}>{s.icon}</span>
                    <span style={{ fontWeight: 600 }}>{issue.title}</span>
                    <Tag color={issue.severity === 'high' ? 'red'
                      : issue.severity === 'medium' ? 'orange' : 'blue'}>
                      {issue.count}
                    </Tag>
                    <Tag>{issue.group}</Tag>
                  </Space>
                }
                extra={
                  <Tooltip title="روح للصفحة اللي بتتصلّح منها">
                    <Button type="link" size="small" icon={<ArrowLeftOutlined />}
                      onClick={() => navigate(issue.link)}>
                      افتح
                    </Button>
                  </Tooltip>
                }
              >
                {/* What it costs to leave alone — the sentence that turns a count into a reason. */}
                <div style={{ marginBottom: 8 }}>{issue.hint}</div>

                {issue.samples.length > 0 && (
                  <List
                    size="small"
                    dataSource={issue.samples}
                    renderItem={(sample) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Space size={8} wrap>
                          <span style={{ fontWeight: 500 }}>{sample.label}</span>
                          <span style={{ color: '#8a8a8a', fontSize: 12 }}>{sample.detail}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
                {issue.count > issue.samples.length && (
                  <div style={{ color: '#8a8a8a', fontSize: 12, marginTop: 4 }}>
                    {/* Never let a truncated list read as the whole list. */}
                    و{issue.count - issue.samples.length} غيرهم — افتح الصفحة تشوفهم كلهم
                  </div>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
