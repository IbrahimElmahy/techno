import React, { useEffect, useState } from 'react';
import { Button, Empty, Skeleton, Table, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

/**
 * بنود حساب واحد في فترة — اللي بيتفتح لما تفرد صف في ميزان المراجعة.
 *
 * ده «دفتر الأستاذ العام» بتاع أودو: الميزان بيقول إن الحساب اتحرّك ١٤٥٠ مدين،
 * والفرد بيقول **من أنهي قيود**. قبل كده كان لازم تسيب الميزان، تفتح كشف حساب،
 * تختار الحساب تاني، وتكتب نفس الفترة تاني — أربع خطوات عشان تشوف اللي كان قدامك.
 *
 * **بيتحمّل لما يتفرد بس.** ميزان فيه مية حساب معناه مية نداء لو حمّلنا الكل مقدماً،
 * و٩٥ منهم محدش هيفتحهم.
 */

interface Line {
  entry_id: number;
  entry_date: string;
  entry_type: string;
  doc_number?: string | null;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  statement?: string | null;
}

const money = (v: string | number) =>
  Number(v || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AccountItems({
  accountId, dateFrom, dateTo,
}: {
  accountId: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const navigate = useNavigate();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [opening, setOpening] = useState<string>('0');

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    api.get(`/api/v1/accounts/${accountId}/statement?${params.toString()}`)
      .then((r) => {
        if (!alive) return;
        setLines(r.data?.lines || []);
        setOpening(r.data?.opening_balance ?? '0');
      })
      .catch(() => alive && setLines([]));
    return () => { alive = false; };
  }, [accountId, dateFrom, dateTo]);

  if (lines === null) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (!lines.length) return <Empty description="لا توجد حركة في الفترة" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  return (
    <Table<Line>
      rowKey={(r, i) => `${r.entry_id}-${i}`}
      size="small"
      dataSource={lines}
      pagination={lines.length > 20 ? { defaultPageSize: 20 } : false}
      title={() => <span style={{ color: '#888' }}>رصيد أول المدة: {money(opening)}</span>}
      columns={[
        { title: 'التاريخ', dataIndex: 'entry_date', width: 105 },
        {
          title: 'المستند',
          key: 'doc',
          width: 170,
          render: (_: unknown, r) => (
            <Button type="link" size="small"
              onClick={() => navigate(`/general-ledger?tab=journal&doc=${r.entry_id}`)}>
              {r.doc_number || `#${r.entry_id}`}
            </Button>
          ),
        },
        {
          title: 'البيان',
          key: 'text',
          ellipsis: true,
          render: (_: unknown, r) => r.statement || r.description || '',
        },
        {
          title: 'مدين', dataIndex: 'debit', width: 120, align: 'left' as const,
          render: (v: string) => (Number(v) ? money(v) : ''),
        },
        {
          title: 'دائن', dataIndex: 'credit', width: 120, align: 'left' as const,
          render: (v: string) => (Number(v) ? money(v) : ''),
        },
        {
          title: 'الرصيد', dataIndex: 'balance', width: 130, align: 'left' as const,
          render: (v: string) => <b>{money(v)}</b>,
        },
      ]}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={5}>
            <Tag>{lines.length} حركة</Tag>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={5}>
            <b>{money(lines[lines.length - 1]?.balance ?? 0)}</b>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}
