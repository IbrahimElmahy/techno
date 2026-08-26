import React, { useMemo } from 'react';
import { Table } from 'antd';

export interface JournalLine {
  account_id: number;
  direction: string;
  amount: string | number;
  statement?: string | null;
  cost_center_id?: number | null;
}

interface Props {
  lines: JournalLine[];
  currentAccountId?: number;
  currentAccountIds?: number[];
  accountLabel: (id: number) => string;
  costCenterName: (id: number | null | undefined) => string | null;
  onOpenAccount: (id: number) => void;
  money: (v: any) => string;
}

const dash = <span style={{ color: '#8c8c8c' }}>-</span>;

export default function JournalEntryLines({
  lines, currentAccountId, currentAccountIds, accountLabel, costCenterName, onOpenAccount, money,
}: Props) {
  const targetIds = useMemo(() => {
    if (currentAccountIds && currentAccountIds.length > 0) return currentAccountIds;
    if (currentAccountId != null) return [currentAccountId];
    return [];
  }, [currentAccountId, currentAccountIds]);

  const shown = useMemo(() => {
    const raw = lines || [];
    if (targetIds.length > 0) {
      const filtered = raw.filter((l) => targetIds.includes(l.account_id));
      if (filtered.length > 0) return filtered.map((l, i) => ({ ...l, _k: i }));
    }
    return raw.map((l, i) => ({ ...l, _k: i }));
  }, [lines, targetIds]);

  return (
    <Table
      size="small"
      pagination={shown.length > 20 ? { defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] } : false}
      rowKey="_k"
      dataSource={shown}
      onRow={(l: any) => ({
        onClick: () => onOpenAccount(l.account_id),
        style: { cursor: 'pointer' as const },
      })}
      columns={[
        {
          title: 'الحساب',
          key: 'account',
          render: (_: unknown, l: any) => (
            <span>
              {accountLabel(l.account_id)}
            </span>
          ),
        },
        {
          title: 'البيان',
          dataIndex: 'statement',
          render: (v: string | null) => v || dash,
        },
        {
          title: 'مركز التكلفة',
          key: 'cc',
          width: 160,
          render: (_: unknown, l: any) => costCenterName(l.cost_center_id) || dash,
        },
        {
          title: 'مدين',
          key: 'debit',
          align: 'left' as const,
          width: 120,
          render: (_: unknown, l: any) => (l.direction === 'debit' ? money(l.amount) : '-'),
        },
        {
          title: 'دائن',
          key: 'credit',
          align: 'left' as const,
          width: 120,
          render: (_: unknown, l: any) => (l.direction === 'credit' ? money(l.amount) : '-'),
        },
      ]}
    />
  );
}
