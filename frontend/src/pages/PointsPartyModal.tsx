import React, { useEffect, useState } from 'react';
import { Empty, Spin, Table, Tag } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { TabModal } from '../components/TabModal';
import { withReturn } from '../components/docReturn';
import { numeralsLocale } from '../utils/money';

type Row = Record<string, any>;

const SOURCE_COLOR: Record<string, string> = { issue: 'gold', invoice: 'blue', receipt: 'green' };
const one = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 1 });
const int = (v: any) => Number(v || 0).toLocaleString(numeralsLocale());

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', background: '#fafafa', minWidth: 0 }}>
      <div style={{ color: '#64748b', fontSize: '0.85em' }}>{label}</div>
      <div style={{ fontWeight: 700, color: tone, overflowWrap: 'anywhere' }}>{value || '—'}</div>
    </div>
  );
}

export default function PointsPartyModal({ row, year, monthKeys, onClose }: {
  row: Row | null;
  year: number;
  monthKeys: string[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const here = useLocation();
  const [moves, setMoves] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row?.party_id) return;
    setLoading(true);
    setError(null);
    api.get('/api/v1/after-sales-reports/coupon-card', {
      params: { party_id: row.party_id, date_from: `${year}-01-01`, date_to: `${year}-12-31` },
    })
      .then((r) => setMoves(((r.data?.rows || []) as Row[]).filter((m) => m.source !== 'receipt').reverse()))
      .catch((e) => {
        setMoves([]);
        setError(e?.response?.status === 403 ? 'ليست لديك صلاحية عرض سجل الكوبونات.'
          : (e?.response?.data?.detail?.message || 'تعذّر تحميل سجل الكوبونات'));
      })
      .finally(() => setLoading(false));
  }, [row?.party_id, year]);

  const openDoc = (r: Row) => {
    onClose();
    navigate(withReturn(`/invoices?doc=${r.doc_id}`, here.pathname + here.search));
  };

  const gap = row ? Number(row.earned_coupons || 0) - Number(row.received_in_gold || 0) : 0;

  return (
    <TabModal
      open={!!row} onCancel={onClose} footer={null} destroyOnHidden centered
      width="min(1200px, 96vw)" styles={{ body: { maxHeight: '80vh', overflowY: 'auto' } }}
      title={row ? `${row.party} — ${year}` : ''}
    >
      {row && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            <Fact label="المندوب" value={row.party_rep} />
            <Fact label="الكود" value={row.party_code} />
            <Fact label="الهاتف" value={row.party_phone} />
            <Fact label="المحافظة" value={row.party_governorate} />
            <Fact label="إجمالي كوبونات السنة" value={one(row.earned_coupons)} />
            <Fact label="مسلّم ذهبي" value={int(row.received_gold)} />
            <Fact label="مسلّم فضي" value={int(row.received_silver)} />
            <Fact label="المسلّم بالذهبي" value={one(row.received_in_gold)} />
            <Fact label="الفرق" value={one(gap)} tone={gap < 0 ? '#cf1322' : undefined} />
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>الكوبونات المستحقة بالشهر</div>
            <Table
              size="small" bordered pagination={false} rowKey={() => 'm'} tableLayout="auto" sticky={false}
              scroll={{ x: 'max-content' }} summary={() => null}
              dataSource={[row]}
              columns={monthKeys.map((k, i) => ({
                title: String(i + 1), key: k, align: 'center' as const,
                render: (_: any, r: Row) => (Number(r[k]) ? one(r[k]) : '—'),
              }))}
            />
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              سجل الكوبونات <span style={{ color: '#64748b', fontWeight: 400 }}>({moves.length})</span>
            </div>
            {loading ? <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
              : error ? <Empty description={error} />
                : !moves.length ? <Empty description="لا توجد حركة كوبونات لهذا العميل في السنة" />
                  : (
                    <Table<Row>
                      size="small" bordered rowKey="key" dataSource={moves} tableLayout="auto" sticky={false}
                      scroll={{ x: 'max-content' }} pagination={moves.length > 20 ? { defaultPageSize: 20 } : false}
                      summary={() => null}
                      columns={[
                        { title: 'التاريخ', dataIndex: 'date', key: 'date',
                          render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{v || '—'}</span> },
                        { title: 'نوع الحركة', dataIndex: 'type', key: 'type',
                          render: (v: string, r: Row) => <Tag color={SOURCE_COLOR[r.source]}>{v}</Tag> },
                        { title: 'رقم المستند', dataIndex: 'doc', key: 'doc',
                          render: (v: string, r: Row) => (r.source === 'invoice'
                            ? <a onClick={() => openDoc(r)}>{v}</a> : (v || '—')) },
                        { title: 'المندوب', dataIndex: 'rep', key: 'rep', render: (v: string | null) => v || '—' },
                        { title: 'الفئة', dataIndex: 'kind', key: 'kind', render: (v: string | null) => v || '—' },
                        { title: 'مصروف', dataIndex: 'issued', key: 'issued', align: 'center' as const,
                          render: (v: number) => (v ? <b>{int(v)}</b> : '—') },
                        { title: 'الأرقام', dataIndex: 'ranges', key: 'ranges',
                          render: (v: string) => <span dir="ltr" style={{ overflowWrap: 'anywhere' }}>{v || '—'}</span> },
                      ]}
                    />
                  )}
          </div>
        </div>
      )}
    </TabModal>
  );
}
