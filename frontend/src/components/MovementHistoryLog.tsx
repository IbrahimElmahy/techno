import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, DatePicker, Descriptions, Empty, Space, Spin, Tag } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';

/**
 * سجل عمليات الصنف — قايمة منسدلة، وتفاصيل اللي تختاره تحته.
 *
 * The question behind every stocktake difference: «الفرق ده جه منين». A number on its own accuses
 * somebody; the movements behind it explain — a sale on Tuesday, a transfer on Thursday, and the
 * shortfall is the one nobody wrote down.
 *
 * It opened as a modal over the sheet first, then as a panel at the FOOT of the page. Both were
 * the wrong shape, and for the same reason twice: the number being explained is on a row, and the
 * explanation has to sit with it. The modal covered the row; the foot panel put the answer three
 * screens below the question, and holding one item at a time meant «الصنف ده ناقص خمسة والتاني
 * زايد خمسة، هما نفس الحاجة؟» could not be asked at all.
 *
 * It renders as the EXPANDED ROW under its own item now, and several rows stay open together —
 * which is what reading a stocktake actually is. One collapsible row per movement, and the full
 * detail of whichever one is opened directly underneath it.
 *
 * One component, five screens (الجرد · جرد المخازن · دورة الجرد · رصيد الصنف · ملف الصنف). They
 * all render it the same way, so this shape change reached all five without touching any of them.
 *
 * **Reads the item card, not a new endpoint.** `GET /api/v1/items/{id}/card` has returned
 * `balance_before`, `balance_after`, the date, the movement type, the party and the document
 * number since كارت الصنف was built. Writing a second history beside it would be two answers to
 * one question, and they would disagree the first time either changed.
 */

export interface MovementHistoryTarget {
  itemId: number;
  itemName?: string | null;
  /** Narrow to one store when the caller is looking at one. */
  locationKind?: string | null;
  locationId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

const MOVEMENT_LABELS: Record<string, string> = {
  sale_out: 'بيع',
  sale_return_in: 'مرتجع بيع',
  purchase_in: 'شراء',
  purchase_return_out: 'مرتجع شراء',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  permit_in: 'إذن إضافة',
  permit_out: 'إذن صرف',
  opening: 'أول المدة',
  manufacture_in: 'إنتاج',
  manufacture_out: 'استهلاك تصنيع',
  count_adjust: 'تسوية جرد',
  wastage_out: 'هالك',
};

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function MovementHistoryLog({
  target, onClose,
}: { target: MovementHistoryTarget | null; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * الفترة — بتبدأ باللي الشاشة اللي نادت طالباه، وبعدين بقت في إيد اللي بيقرا.
   *
   * A stocktake opens this with its own from→to so the log answers «إيه اللي حصل في الفترة دي».
   * From that point the range belongs to the reader: «فين الفرق» is very often answered by widening
   * past the period being counted, and forcing them back to the sheet to change it there would
   * make the log a dead end.
   */
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // A new target resets the range to whatever that caller asked for — carrying the previous
  // item's dates over would silently answer a different question than the one just clicked.
  useEffect(() => {
    if (!target) return;
    setRange([
      target.dateFrom ? dayjs(target.dateFrom) : null,
      target.dateTo ? dayjs(target.dateTo) : null,
    ]);
  }, [target]);

  useEffect(() => {
    if (!target) { setRows([]); return; }
    setLoading(true);
    const params: any = {};
    if (target.locationKind) params.location_kind = target.locationKind;
    if (target.locationId) params.location_id = target.locationId;
    if (range?.[0]) params.date_from = range[0]!.format('YYYY-MM-DD');
    if (range?.[1]) params.date_to = range[1]!.format('YYYY-MM-DD');
    api.get(`/api/v1/items/${target.itemId}/card`, { params })
      .then((r) => setRows(r.data?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [target, range]);

  // Harmless where the caller expands a row (antd has already brought it into view) and still
  // needed on the screens that render this on its own — رصيد الصنف and ملف الصنف.
  useEffect(() => {
    if (target) box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [target]);

  const items = useMemo(() => rows.map((r: any, i: number) => {
    const inQ = Number(r.quantity_in || 0);
    const outQ = Number(r.quantity_out || 0);
    return {
      key: String(r.movement_id ?? i),
      label: (
        <Space size={8} wrap>
          <span style={{ color: '#6b6b6b', fontSize: 12 }}>
            {r.date ? String(r.date).slice(0, 10) : '-'}
          </span>
          <Tag color={r.direction === 'in' ? 'green' : 'red'}>
            {MOVEMENT_LABELS[r.movement_type] || r.movement_type}
          </Tag>
          {inQ
            ? <b style={{ color: '#6AB42D' }}>+{qty(inQ)}</b>
            : <b style={{ color: '#cf1322' }}>−{qty(outQ)}</b>}
          <span style={{ color: '#6b6b6b', fontSize: 12 }}>
            الرصيد بعدها <b style={{ color: '#16241c' }}>{qty(r.balance_after)}</b>
          </span>
          {r.document_number && <Tag>{r.document_number}</Tag>}
        </Space>
      ),
      children: (
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="المستند">
            {r.document_number || <span style={{ color: '#8c8c8c' }}>-</span>}
          </Descriptions.Item>
          <Descriptions.Item label="جهة التعامل">
            {r.party || <span style={{ color: '#8c8c8c' }}>-</span>}
          </Descriptions.Item>
          <Descriptions.Item label="الموقع">{r.location || '-'}</Descriptions.Item>
          <Descriptions.Item label="التاريخ">
            {r.date ? String(r.date).slice(0, 10) : '-'}
          </Descriptions.Item>
          {/* The three that make this a history rather than a list: what it was, what moved,
              what it became. */}
          <Descriptions.Item label="الرصيد قبل">{qty(r.balance_before)}</Descriptions.Item>
          <Descriptions.Item label="الرصيد بعد"><b>{qty(r.balance_after)}</b></Descriptions.Item>
        </Descriptions>
      ),
    };
  }), [rows]);

  if (!target) return null;

  return (
    <div ref={box} style={{ marginTop: 16 }}>
      <Card
        title={`سجل عمليات — ${target.itemName || `صنف #${target.itemId}`}`}
        extra={<Button type="text" icon={<CloseOutlined />} onClick={onClose}>إغلاق</Button>}
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <DatePicker.RangePicker
            value={range as any} allowClear
            onChange={(v) => setRange(v as any)}
            placeholder={['من تاريخ', 'إلى تاريخ']}
          />
          <span style={{ color: '#6b6b6b', fontSize: 12 }}>
            {rows.length} حركة
          </span>
        </Space>

        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="اضغط على أي حركة تشوف تفاصيلها تحتها"
          description="كل حركة والرصيد قبلها وبعدها — الفرق بيتفسّر من هنا مش من الرقم لوحده." />

        {loading ? <Spin /> : items.length
          ? <Collapse accordion items={items} />
          : <Empty description="مفيش حركات في الفترة دي" />}
      </Card>
    </div>
  );
}
