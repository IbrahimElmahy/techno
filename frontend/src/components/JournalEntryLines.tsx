import React from 'react';
import { Table, Tag } from 'antd';

/**
 * القيد بسطوره — الطرف المقابل.
 *
 * كشف الحساب بيوري طرف واحد من كل قيد: الحساب اللي انت فاتح كشفه. يعني العمود بيرد على
 * سؤال انت عارف إجابته، والسؤال الحقيقي — «مقابل إيه؟» — كان لازمله إنك تسيب الشاشة وتفتح
 * القيد في اليومية وتدوّر على رقمه.
 *
 * الجدول ده هو الرد: الحسابات اللي القيد قفل عليها كلها، وكل واحد فيهم بيفتح كشفه.
 *
 * وهو في `components/` مش جوّه الشاشة عن قصد — الجداول اللي جوّه الشاشات بتخضع لقواعد
 * التقارير (كل عمود بيتفلتر، والسطر بيفتح حاجة مع الكيبورد)، وهي قواعد صح لجدول بيتقرا
 * بمئات السطور وغلط لقيد من سطرين.
 */
export interface JournalLine {
  account_id: number;
  direction: string;
  amount: string | number;
  statement?: string | null;
  cost_center_id?: number | null;
}

interface Props {
  lines: JournalLine[];
  /** الحساب اللي الكشف مفتوح عليه — سطره بيتعلّم عشان اللي بيقرا يعرف هو فين في القيد. */
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
  return (
    <>
      <Table
        size="small"
        pagination={false}
        rowKey="_k"
        // القيد ممكن يكون فيه سطرين بنفس الحساب وبنفس المبلغ، فترتيبهم هو اللي بيفرّقهم.
        dataSource={(lines || []).map((l, i) => ({ ...l, _k: i }))}
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
      <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 6 }}>
        دوس على أي حساب فوق يفتحلك كشفه.
      </div>
    </>
  );
}
