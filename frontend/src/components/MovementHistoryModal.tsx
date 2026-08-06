import React, { useEffect, useState } from 'react';
import { Alert, Modal, Spin, Table, Tag } from 'antd';
import { api } from '../api/client';

/**
 * سجل عمليات الصنف — قبل، وبعد، وإمتى.
 *
 * The question behind every stocktake difference: «الفرق ده جه منين». A number on its own accuses
 * somebody; the movements behind it explain — a sale on Tuesday, a transfer on Thursday, and the
 * shortfall is the one nobody wrote down.
 *
 * **Reads the item card, not a new endpoint.** `GET /api/v1/items/{id}/card` has returned
 * `balance_before`, `balance_after`, the date, the movement type, the party and the document
 * number since كارت الصنف was built. Writing a second history beside it would be two answers to
 * one question, and they would disagree the first time either changed.
 *
 * The period is passed through when the caller has one — a stocktake from→to — so the log answers
 * «إيه اللي حصل في الفترة دي» rather than reciting the item's whole life.
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

export default function MovementHistoryModal({
  target, onClose,
}: { target: MovementHistoryTarget | null; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) { setRows([]); return; }
    setLoading(true);
    const params: any = {};
    if (target.locationKind) params.location_kind = target.locationKind;
    if (target.locationId) params.location_id = target.locationId;
    if (target.dateFrom) params.date_from = target.dateFrom;
    if (target.dateTo) params.date_to = target.dateTo;
    api.get(`/api/v1/items/${target.itemId}/card`, { params })
      .then((r) => setRows(r.data?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [target]);

  const period = target?.dateFrom || target?.dateTo
    ? `من ${target?.dateFrom || 'البداية'} إلى ${target?.dateTo || 'النهاردة'}`
    : 'كل الحركات';

  return (
    <Modal
      open={!!target}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnHidden
      title={`سجل عمليات — ${target?.itemName || `صنف #${target?.itemId ?? ''}`}`}
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={period}
        description="كل حركة والرصيد قبلها وبعدها — الفرق بيتفسّر من هنا مش من الرقم لوحده." />
      {loading ? <Spin /> : (
        <Table
          size="small" rowKey="movement_id" dataSource={rows}
          locale={{ emptyText: 'مفيش حركات في الفترة دي' }}
          pagination={{ defaultPageSize: 12, showSizeChanger: true }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: 'التاريخ', dataIndex: 'date', width: 110,
              render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
            { title: 'الحركة', dataIndex: 'movement_type', width: 130,
              render: (t: string, r: any) => (
                <Tag color={r.direction === 'in' ? 'green' : 'red'}>
                  {MOVEMENT_LABELS[t] || t}
                </Tag>
              ) },
            { title: 'المستند', dataIndex: 'document_number', width: 130,
              render: (v: string | null) => v || <span style={{ color: '#bbb' }}>-</span> },
            { title: 'جهة التعامل', dataIndex: 'party', ellipsis: true,
              render: (v: string | null) => v || <span style={{ color: '#bbb' }}>-</span> },
            { title: 'الموقع', dataIndex: 'location', ellipsis: true },
            // The three that make this a history rather than a list: what it was, what moved,
            // what it became. Reading down the «بعد» column is the item's whole story.
            { title: 'الرصيد قبل', dataIndex: 'balance_before', align: 'left' as const, width: 110,
              render: (v: string) => <span style={{ color: '#8a8a8a' }}>{qty(v)}</span> },
            { title: 'الكمية', key: 'moved', align: 'left' as const, width: 110,
              render: (_: any, r: any) => {
                const inQ = Number(r.quantity_in || 0);
                const outQ = Number(r.quantity_out || 0);
                return inQ
                  ? <b style={{ color: '#6AB42D' }}>+{qty(inQ)}</b>
                  : <b style={{ color: '#cf1322' }}>−{qty(outQ)}</b>;
              } },
            { title: 'الرصيد بعد', dataIndex: 'balance_after', align: 'left' as const, width: 110,
              render: (v: string) => <b>{qty(v)}</b> },
          ]}
        />
      )}
    </Modal>
  );
}
