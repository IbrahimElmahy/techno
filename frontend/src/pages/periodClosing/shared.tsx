import React from 'react';
import { Button, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, FileSearchOutlined, PlusOutlined } from '@ant-design/icons';
import { money, qty } from '../../utils/money';

export interface ClosingLine {
  key: string;
  id?: number;
  section: string;
  group_key?: string | null;
  label: string;
  quantity?: string | number | null;
  rate?: string | number | null;
  amount?: string | number | null;
  sign: number;
  note?: string | null;
}

export interface ViewProps {
  pkg: any;
  lines: ClosingLine[];
  setLines: (next: ClosingLine[]) => void;
  editable: boolean;
  params: any;
  setParams: (p: any) => void;
  asOf: string;
  openStatement: (accountId: number) => void;
  goto: (view: string) => void;
}

export const num = (v: unknown) => Number(v || 0);

export function M({ v, strong }: { v: unknown; strong?: boolean }) {
  const n = num(v);
  const s = <span dir="ltr" style={{ color: n < 0 ? '#cf1322' : undefined }}>{money(n)}</span>;
  return strong ? <b>{s}</b> : s;
}

export function Q({ v }: { v: unknown }) {
  return <span dir="ltr">{qty(v)}</span>;
}

const SOURCE: Record<string, [string, string]> = {
  system: ['النظام', 'blue'],
  manual: ['يدوي', 'orange'],
  mixed: ['النظام + يدوي', 'geekblue'],
  computed: ['محسوب', 'purple'],
};

export function SourceTag({ source }: { source?: string }) {
  const [label, color] = SOURCE[source || 'system'] || SOURCE.system;
  return <Tag color={color} style={{ marginInlineEnd: 0 }}>{label}</Tag>;
}

const filled = (v: unknown) => v !== null && v !== undefined && v !== '';

export function lineAmount(l: ClosingLine): number {
  if (filled(l.quantity) && filled(l.rate)) return Math.round(num(l.quantity) * num(l.rate) * 100) / 100;
  return num(l.amount);
}

export const signed = (l: ClosingLine) => lineAmount(l) * (l.sign < 0 ? -1 : 1);

export function sectionTotal(lines: ClosingLine[], section: string, group?: string | null) {
  return lines
    .filter((l) => l.section === section && (group === undefined || (l.group_key ?? null) === group))
    .reduce((s, l) => s + signed(l), 0);
}

let seq = 0;
export const newKey = () => `n${Date.now()}_${(seq += 1)}`;

export function fromServer(lines: any[] = []): ClosingLine[] {
  return lines.map((l) => ({
    key: `s${l.id}`, id: l.id, section: l.section, group_key: l.group_key, label: l.label,
    quantity: l.quantity, rate: l.rate, amount: l.amount, sign: l.sign || 1, note: l.note,
  }));
}

export function ManualLines({
  lines, setLines, section, group, editable, withQty = true, withSign = false,
  defaultSign = 1, addLabel = 'إضافة بند',
}: {
  lines: ClosingLine[]; setLines: (n: ClosingLine[]) => void; section: string;
  group?: string | null; editable: boolean; withQty?: boolean; withSign?: boolean;
  defaultSign?: number; addLabel?: string;
}) {
  const mine = lines.filter((l) => l.section === section
    && (group === undefined || (l.group_key ?? null) === (group ?? null)));
  const patch = (key: string, p: Partial<ClosingLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key: string) => setLines(lines.filter((l) => l.key !== key));
  const add = () => setLines([...lines, {
    key: newKey(), section, group_key: group ?? null, label: '', sign: defaultSign,
    quantity: null, rate: null, amount: null,
  }]);
  const numberCell = (v: any, onChange: (n: number | null) => void) => (
    <InputNumber size="small" value={filled(v) ? Number(v) : null} style={{ width: '100%' }}
      onChange={(n) => onChange(n === null ? null : Number(n))} />
  );

  const columns: any[] = [
    {
      title: 'البند', dataIndex: 'label', key: 'label',
      render: (v: string, r: ClosingLine) => (editable
        ? <Input size="small" value={v} onChange={(e) => patch(r.key, { label: e.target.value })} />
        : v),
    },
  ];
  if (withQty) {
    columns.push(
      {
        title: 'الكمية', dataIndex: 'quantity', key: 'quantity', width: 120,
        render: (v: any, r: ClosingLine) => (editable
          ? numberCell(v, (n) => patch(r.key, { quantity: n === null ? null : String(n) }))
          : (filled(v) ? <Q v={v} /> : '')),
      },
      {
        title: 'السعر', dataIndex: 'rate', key: 'rate', width: 100,
        render: (v: any, r: ClosingLine) => (editable
          ? numberCell(v, (n) => patch(r.key, { rate: n === null ? null : String(n) }))
          : (filled(v) ? <span dir="ltr">{v}</span> : '')),
      },
    );
  }
  if (withSign) {
    columns.push({
      title: '±', dataIndex: 'sign', key: 'sign', width: 70,
      render: (v: number, r: ClosingLine) => (editable
        ? <Select size="small" value={v < 0 ? -1 : 1} style={{ width: 60 }}
          onChange={(s) => patch(r.key, { sign: s })}
          options={[{ value: 1, label: '+' }, { value: -1, label: '−' }]} />
        : (v < 0 ? '−' : '+')),
    });
  }
  columns.push(
    {
      title: 'المبلغ', key: 'amount', width: 150, align: 'left' as const,
      render: (_: any, r: ClosingLine) => {
        const computed = withQty && filled(r.quantity) && filled(r.rate);
        if (editable && !computed) {
          return numberCell(r.amount, (n) => patch(r.key, { amount: n === null ? null : String(n) }));
        }
        return <M v={signed(r)} />;
      },
    },
    { title: '', key: 'src', width: 60, render: () => <SourceTag source="manual" /> },
  );
  if (editable) {
    columns.push({
      title: '', key: 'x', width: 40,
      render: (_: any, r: ClosingLine) => (
        <Popconfirm title="حذف البند؟" okText="حذف" cancelText="إلغاء" onConfirm={() => remove(r.key)}>
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    });
  }

  return (
    <div>
      <Table size="small" rowKey="key" pagination={false} dataSource={mine} columns={columns}
        locale={{ emptyText: 'لا توجد بنود' }} />
      {editable && (
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={add} style={{ marginTop: 6 }}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}

export function AccountLink({ id, name, open }: { id?: number | null; name: string; open: (id: number) => void }) {
  if (!id) return <span>{name}</span>;
  return <a onClick={() => open(id)}>{name}</a>;
}

export function DrillButton({ ids, open }: { ids?: number[]; open: (id: number) => void }) {
  if (!ids?.length) return null;
  return <Button size="small" type="text" icon={<FileSearchOutlined />} onClick={() => open(ids[0])}>كشف حساب</Button>;
}

export function TotalRow({ label, v }: { label: string; v: unknown }) {
  return (
    <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 8, padding: '4px 8px', background: 'rgba(0,0,0,0.04)', borderRadius: 4 }}>
      <Typography.Text strong>{label}</Typography.Text>
      <M v={v} strong />
    </Space>
  );
}
