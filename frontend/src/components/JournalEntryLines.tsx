import React, { useState } from 'react';
import { Button, Table, Tag } from 'antd';

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
  accountLabel: (id: number) => string;
  costCenterName: (id: number | null | undefined) => string | null;
  onOpenAccount: (id: number) => void;
  money: (v: any) => string;
}

const dash = <span style={{ color: '#8c8c8c' }}>-</span>;

export default function JournalEntryLines({
  lines, currentAccountId, accountLabel, costCenterName, onOpenAccount, money,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const all = (lines || []).map((l, i) => ({ ...l, _k: i }));
  const mine = all.filter((l) => l.account_id === currentAccountId);
  const others = all.filter((l) => l.account_id !== currentAccountId);
  const summarised = !showAll && currentAccountId != null && mine.length > 0 && others.length > 8;
  const shown = summarised ? mine : all;
  const otherDebit = others.reduce((t, l) => t + (l.direction === 'debit' ? Number(l.amount) : 0), 0);
  const otherCredit = others.reduce((t, l) => t + (l.direction === 'credit' ? Number(l.amount) : 0), 0);

  return (
    <>
      <Table
        size="small"
        pagination={false}
        rowKey="_k"
        dataSource={shown}
        rowClassName={(l: any) => (l.account_id === currentAccountId ? 'row-cursor' : '')}
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
                {l.account_id === currentAccountId && (
                  <Tag style={{ marginInlineStart: 6 }} color="blue">الحساب ده</Tag>
                )}
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
      {summarised && (
        <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 6 }}>
          القيد ده مجمّع: فيه {others.length.toLocaleString('ar-EG')} سطر تاني لحسابات تانية
          {' '}(مدين {money(otherDebit)} / دائن {money(otherCredit)}) — معروض منه سطور الحساب ده بس.
          <Button type="link" size="small" onClick={() => setShowAll(true)}>عرض القيد كامل</Button>
        </div>
      )}
      {!summarised && (
        <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 6 }}>
          دوس على أي حساب فوق يفتحلك كشفه.
        </div>
      )}
    </>
  );
}
