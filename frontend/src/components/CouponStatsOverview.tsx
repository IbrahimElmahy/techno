import React from 'react';
import { Card, Row, Col, Statistic, Tag } from 'antd';
import { money } from '../utils/money';

export interface CouponKindStat {
  key: string;
  label: string;
  count: number;
  value?: number | string;
  active?: boolean;
  color?: string;
  onClick?: () => void;
}

interface Props {
  totalCount: number;
  totalValue: number | string;
  currentKind?: string;
  kinds: CouponKindStat[];
  title?: React.ReactNode;
  countTitle?: string;
  valueTitle?: string;
  kindsTitle?: string;
  style?: React.CSSProperties;
}

export default function CouponStatsOverview({
  totalCount,
  totalValue,
  currentKind,
  kinds,
  title,
  countTitle = 'عدد الكوبونات',
  valueTitle = 'إجمالي القيمة',
  kindsTitle = 'النوع وتوزيع الأعداد',
  style,
}: Props) {
  return (
    <Card
      size="small"
      title={title}
      style={{
        marginBottom: 16,
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        ...style,
      }}
    >
      <Row gutter={[12, 12]} align="middle">
        <Col xs={12} sm={8} md={6}>
          <Card size="small" style={{ borderRadius: 8, background: '#fff', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
            <Statistic
              title={<span style={{ fontSize: 13, color: '#595959', fontWeight: 600 }}>{countTitle}</span>}
              value={totalCount}
              valueStyle={{ color: '#1677ff', fontWeight: 700 }}
              prefix={<Tag color="blue" style={{ marginInlineEnd: 4, borderRadius: 4 }}>العدد</Tag>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" style={{ borderRadius: 8, background: '#fff', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
            <Statistic
              title={<span style={{ fontSize: 13, color: '#595959', fontWeight: 600 }}>{valueTitle}</span>}
              value={money(totalValue)}
              suffix="ج.م"
              valueStyle={{ color: '#52c41a', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8} md={12}>
          <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: '#595959' }}>{kindsTitle}</span>
              {currentKind && (
                <Tag color="cyan" style={{ borderRadius: 4 }}>النوع الحالي: {currentKind}</Tag>
              )}
            </div>
            {/* الحقول المصغرة: كل نوع وتحته العدد بتاعه */}
            <Row gutter={[8, 8]}>
              {kinds.map((k) => (
                <Col key={k.key} xs={12} sm={6} md={6} style={{ flex: '1 1 0' }}>
                  <div
                    onClick={k.onClick}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      textAlign: 'center',
                      background: k.active ? '#e6f4ff' : '#f5f5f5',
                      border: `1px solid ${k.active ? '#91caff' : '#e8e8e8'}`,
                      cursor: k.onClick ? 'pointer' : 'default',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{
                      fontSize: 12,
                      fontWeight: k.active ? 700 : 500,
                      color: k.active ? '#0958d9' : (k.color || '#262626'),
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {k.label}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: k.active ? '#1677ff' : '#262626', marginTop: 2 }}>
                      {Number(k.count || 0).toLocaleString('ar-EG')}
                    </div>
                    {k.value !== undefined && (
                      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 1 }}>
                        {money(k.value)} ج.م
                      </div>
                    )}
                  </div>
                </Col>
              ))}
            </Row>
          </div>
        </Col>
      </Row>
    </Card>
  );
}
