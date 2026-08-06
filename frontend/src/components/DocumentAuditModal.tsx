import React, { useEffect, useState } from 'react';
import { Empty, Modal, Spin, Table, Tag } from 'antd';
import { api } from '../api/client';

/**
 * سجل عمليات المستند — مين عمل إيه وإمتى بالدقيقة.
 *
 * The person who raised a transfer reads this to find out why what arrived is not what he asked
 * for. «الكمية اتغيّرت» with no name and no minute on it is not an answer.
 *
 * Reads `GET /api/v1/audit`, which has recorded actor, action and timestamp since the audit log
 * was built — it simply could not be asked about ONE document until `entity_id` became a filter.
 *
 * Written against `entityType`/`entityId` rather than against transfers, so an invoice or a
 * voucher gets its history by passing different strings.
 */

const ACTION_LABELS: Record<string, string> = {
  'transfer.initiate': 'إنشاء الإذن',
  'transfer.line_add': 'إضافة صنف',
  'transfer.line_qty': 'تعديل كمية',
  'transfer.line_remove': 'حذف صنف',
  'transfer.approve': 'اعتماد',
  'transfer.reject': 'رفض',
  'transfer.reverse': 'عكس',
};

/** «الكمية: 5 ← 9» — what actually changed, rather than two JSON blobs to compare by eye. */
function describe(before: any, after: any): React.ReactNode {
  const b = before || {};
  const a = after || {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const changed = keys.filter((k) => String(b[k] ?? '') !== String(a[k] ?? ''));
  if (!changed.length) return <span style={{ color: '#bbb' }}>-</span>;
  return (
    <span>
      {changed.map((k) => (
        <span key={k} style={{ marginInlineEnd: 10 }}>
          <span style={{ color: '#8a8a8a' }}>{k}: </span>
          {b[k] !== undefined && <span style={{ textDecoration: 'line-through' }}>{String(b[k])}</span>}
          {b[k] !== undefined && a[k] !== undefined && ' ← '}
          {a[k] !== undefined && <b>{String(a[k])}</b>}
        </span>
      ))}
    </span>
  );
}

export default function DocumentAuditModal({
  entityType, entityId, title, userNames, onClose,
}: {
  entityType: string;
  entityId: number | null;
  title?: string;
  /** id → name, so the trail says who rather than «#7». */
  userNames?: Record<number, string>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityId) { setRows([]); return; }
    setLoading(true);
    api.get('/api/v1/audit', { params: { entity_type: entityType, entity_id: entityId } })
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  return (
    <Modal
      open={!!entityId} onCancel={onClose} footer={null} width={760} destroyOnHidden
      title={title || 'سجل العمليات'}
    >
      {loading ? <Spin /> : rows.length === 0 ? (
        <Empty description="مفيش عمليات متسجّلة على المستند ده" />
      ) : (
        <Table
          size="small" rowKey="id" dataSource={rows}
          pagination={{ defaultPageSize: 10 }}
          scroll={{ x: 'max-content' }}
          columns={[
            // To the minute, as asked. A date alone cannot separate two edits made the same
            // afternoon, which is exactly when a disagreement about one of them comes up.
            { title: 'التاريخ والساعة', dataIndex: 'created_at', width: 165,
              render: (v: string) => (v ? String(v).slice(0, 16).replace('T', ' ') : '-') },
            { title: 'الإجراء', dataIndex: 'action', width: 130,
              render: (a: string) => <Tag color="blue">{ACTION_LABELS[a] || a}</Tag> },
            { title: 'المستخدم', dataIndex: 'actor_user_id', width: 140,
              render: (id: number | null) => (id
                ? (userNames?.[id] || `#${id}`)
                : <span style={{ color: '#bbb' }}>-</span>) },
            { title: 'اللي اتغيّر', key: 'change',
              render: (_: any, r: any) => describe(r.before, r.after) },
          ]}
        />
      )}
    </Modal>
  );
}
