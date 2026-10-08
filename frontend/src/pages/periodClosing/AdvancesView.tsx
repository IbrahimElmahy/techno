import React from 'react';
import { Button, Card, DatePicker, Space, Table, Tag } from 'antd';
import type { Dayjs } from 'dayjs';
import { AccountLink, M, SourceTag, type ViewProps } from './shared';

export default function AdvancesView({
  pkg, openStatement, dates, setDates,
}: ViewProps & { dates: string[]; setDates: (d: string[]) => void }) {
  const adv = pkg?.advances;
  if (!adv) return null;
  const cols: any[] = [
    {
      title: 'الموظف / الحساب', key: 'l', fixed: 'right' as const, width: 240,
      render: (_: any, r: any) => <AccountLink id={r.account_id} name={r.label} open={openStatement} />,
    },
    ...adv.dates.map((d: string) => ({
      title: d, key: d, width: 130,
      render: (_: any, r: any) => (r.values[d] === undefined ? '—' : <M v={r.values[d]} />),
    })),
    { title: '', key: 's', width: 60, render: () => <SourceTag source="system" /> },
  ];
  return (
    <Card size="small" title="سلف الموظفين"
      extra={(
        <Space wrap>
          {dates.map((d) => (
            <Tag key={d} closable onClose={(e) => { e.preventDefault(); setDates(dates.filter((x) => x !== d)); }}>{d}</Tag>
          ))}
          <DatePicker size="small" placeholder="إضافة تاريخ" value={null as Dayjs | null}
            onChange={(v: Dayjs | null) => v && setDates(Array.from(new Set([...dates, v.format('YYYY-MM-DD')])).sort())} />
          {!!dates.length && <Button size="small" onClick={() => setDates([])}>التواريخ الافتراضية</Button>}
        </Space>
      )}>
      <Table size="small" rowKey="key" pagination={false} dataSource={adv.rows} columns={cols}
        scroll={{ x: 'max-content' }} locale={{ emptyText: 'لا توجد سلف' }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
            {adv.dates.map((d: string, i: number) => (
              <Table.Summary.Cell key={d} index={i + 1}><M v={adv.totals[d]} strong /></Table.Summary.Cell>
            ))}
            <Table.Summary.Cell index={adv.dates.length + 1} />
          </Table.Summary.Row>
        )} />
    </Card>
  );
}
