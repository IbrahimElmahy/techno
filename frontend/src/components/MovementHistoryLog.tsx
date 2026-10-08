import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, DatePicker, Empty, Select, Spin, Tag,
} from 'antd';
import { FilterTable } from './FilterTable';
import { CloseOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

type Preset = 'all' | 'm1' | 'm3' | 'm12' | 'custom';
const PRESET_MONTHS: Record<'m1' | 'm3' | 'm12', number> = { m1: 1, m3: 3, m12: 12 };
import { api } from '../api/client';
import { useMovementLabels } from '../lib/movementTypes';
import { DocRef, docKindOf } from './DocumentLink';
import { qty } from '../utils/money';

export interface MovementHistoryTarget {
  itemId: number;
  itemName?: string | null;
  locationKind?: string | null;
  locationId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}


export default function MovementHistoryLog({
  target, onClose, periodFilter = true,
}: {
  target: MovementHistoryTarget | null;
  onClose: () => void;
  periodFilter?: boolean;
}) {
  const moveLabels = useMovementLabels();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [preset, setPreset] = useState<Preset>('all');
  const box = useRef<HTMLDivElement>(null);

  const targetKey = target ? JSON.stringify([
    target.itemId, target.locationKind ?? null, target.locationId ?? null,
    target.dateFrom ?? null, target.dateTo ?? null,
  ]) : '';
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const asked = target.dateFrom || target.dateTo;
    setRange(asked ? [
      target.dateFrom ? dayjs(target.dateFrom) : null,
      target.dateTo ? dayjs(target.dateTo) : null,
    ] : null);
    setPreset(asked ? 'custom' : 'all');
  }, [targetKey]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) { setRows([]); return; }
    setLoading(true);
    const params: any = {};
    if (target.locationKind && target.locationId) {
      params.location_kind = target.locationKind;
      params.location_id = target.locationId;
    }
    if (range?.[0]) params.date_from = range[0]!.format('YYYY-MM-DD');
    if (range?.[1]) params.date_to = range[1]!.format('YYYY-MM-DD');
    api.get(`/api/v1/items/${target.itemId}/card`, { params })
      .then((r) => setRows(r.data?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [targetKey, range]);

  useEffect(() => {
    if (targetRef.current) box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [targetKey]);

  const tableRows = useMemo(() => rows.map((r: any, i: number) => ({
    key: String(r.movement_id ?? i),
    date: r.date ? String(r.date).slice(0, 10) : '',
    kind: moveLabels[r.movement_type] || r.movement_type,
    direction: r.direction === 'in' ? 'وارد' : 'منصرف',
    qin: Number(r.quantity_in || 0) || null,
    qout: Number(r.quantity_out || 0) || null,
    document_number: r.document_number || '',
    doc_kind: docKindOf(r.source_doc_type),
    doc_id: r.source_doc_id ?? null,
    party: r.party || '',
    location: r.location || '',
    before: Number(r.balance_before ?? 0),
    after: Number(r.balance_after ?? 0),
  })), [rows, moveLabels]);

  const columns = [
    { title: 'التاريخ', dataIndex: 'date', width: 110 },
    { title: 'نوع الحركة', dataIndex: 'kind',
      render: (v: string, r: any) => <Tag color={r.direction === 'وارد' ? 'green' : 'red'}>{v}</Tag> },
    { title: 'المستند', dataIndex: 'document_number',
      render: (v: string, r: any) => (r.doc_kind && r.doc_id
        ? <DocRef kind={r.doc_kind} id={r.doc_id} label={v || `#${r.doc_id}`} />
        : (v || '')) },
    { title: 'جهة التعامل', dataIndex: 'party' },
    { title: 'الموقع', dataIndex: 'location' },
    { title: 'وارد', dataIndex: 'qin', align: 'center' as const,
      render: (v: number | null) => (v ? <b style={{ color: '#6AB42D' }}>+{qty(v)}</b> : '') },
    { title: 'منصرف', dataIndex: 'qout', align: 'center' as const,
      render: (v: number | null) => (v ? <b style={{ color: '#cf1322' }}>−{qty(v)}</b> : '') },
    { title: 'الرصيد قبل', dataIndex: 'before', align: 'center' as const,
      render: (v: number) => qty(v) },
    { title: 'الرصيد بعد', dataIndex: 'after', align: 'center' as const,
      render: (v: number) => <b>{qty(v)}</b> },
  ];

  if (!target) return null;

  return (
    <div ref={box} style={{ marginTop: 16 }}>
      <Card
        title={`سجل عمليات — ${target.itemName || `صنف #${target.itemId}`}`}
        extra={<Button type="text" icon={<CloseOutlined />} onClick={onClose}>إغلاق</Button>}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          marginBottom: 12, padding: '6px 10px', borderRadius: 8,
          background: '#fafafa', border: '1px solid #f0f0f0',
        }}>
          {periodFilter ? (
            <>
              <Select
                size="small"
                style={{ minWidth: 130 }}
                value={preset}
                onChange={(v) => {
                  const key = v as Preset;
                  setPreset(key);
                  if (key === 'all') setRange(null);
                  else if (key === 'custom') {
                    setRange(range ?? [dayjs().subtract(1, 'month'), dayjs()]);
                  } else setRange([dayjs().subtract(PRESET_MONTHS[key], 'month'), dayjs()]);
                }}
                options={[
                  { value: 'all', label: 'كل الحركات' },
                  { value: 'm1', label: 'آخر شهر' },
                  { value: 'm3', label: 'آخر ٣ أشهر' },
                  { value: 'm12', label: 'آخر سنة' },
                  { value: 'custom', label: 'فترة محددة' },
                ]}
              />
              {preset === 'custom' && (
                <>
                  <DatePicker
                    size="small" format="YYYY-MM-DD" placeholder="من" allowClear={false}
                    value={range?.[0] ?? null} style={{ width: 128 }}
                    onChange={(v) => setRange([v, range?.[1] ?? null])}
                  />
                  <span style={{ color: '#8c8c8c' }}>←</span>
                  <DatePicker
                    size="small" format="YYYY-MM-DD" placeholder="إلى" allowClear={false}
                    value={range?.[1] ?? null} style={{ width: 128 }}
                    onChange={(v) => setRange([range?.[0] ?? null, v])}
                  />
                </>
              )}
            </>
          ) : (
            <span style={{ fontSize: 14, color: '#4a4a4a' }}>
              الفترة:{' '}
              <b>
                {range?.[0] ? range[0]!.format('YYYY-MM-DD') : 'من البداية'}
                {' ← '}
                {range?.[1] ? range[1]!.format('YYYY-MM-DD') : 'اليوم'}
              </b>
            </span>
          )}

          <span style={{ marginInlineStart: 'auto', fontSize: 14, color: '#4a4a4a' }}>
            {rows.length} حركة
          </span>
        </div>

        {loading ? <Spin /> : tableRows.length
          ? <FilterTable size="small" rowKey="key" dataSource={tableRows} columns={columns as any}
              pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
              scroll={{ x: 'max-content' }} />
          : <Empty description="لا توجد حركات في هذه الفترة" />}
      </Card>
    </div>
  );
}
