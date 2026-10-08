import React, { useMemo, useState } from 'react';
import { Button, Card, Col, Input, InputNumber, Row, Segmented, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  AccountLink, DrillButton, M, ManualLines, SourceTag, TotalRow, newKey, num, sectionTotal, signed,
  type ClosingLine, type ViewProps,
} from './shared';

function SystemRows({ rows, open }: { rows: any[]; open: (id: number) => void }) {
  return (
    <Table size="small" rowKey={(r: any) => String(r.account_id ?? r.key ?? r.name)} pagination={false}
      dataSource={rows} locale={{ emptyText: 'لا توجد أرصدة' }}
      columns={[
        {
          title: 'الحساب', key: 'n',
          render: (_: any, r: any) => <AccountLink id={r.account_id} name={r.name || r.label} open={open} />,
        },
        { title: 'المبلغ', dataIndex: 'amount', key: 'a', width: 150, render: (v: any) => <M v={v} /> },
        { title: '', key: 's', width: 60, render: () => <SourceTag source="system" /> },
      ]} />
  );
}

function MixedCard({ title, block, section, lines, setLines, editable, open, withQty = false, withSign = true }: {
  title: string; block: any; section: string; lines: ClosingLine[]; setLines: (l: ClosingLine[]) => void;
  editable: boolean; open: (id: number) => void; withQty?: boolean; withSign?: boolean;
}) {
  const live = num(block?.system_total) + sectionTotal(lines, section);
  return (
    <Card size="small" title={title} extra={<DrillButton ids={block?.account_ids} open={open} />}>
      <SystemRows rows={block?.rows || []} open={open} />
      <Typography.Text strong style={{ display: 'block', margin: '8px 0 4px' }}>بنود يدوية</Typography.Text>
      <ManualLines lines={lines} setLines={setLines} section={section} editable={editable}
        withQty={withQty} withSign={withSign} />
      <TotalRow label="الإجمالي" v={live} />
    </Card>
  );
}

const PARAMS: [string, string][] = [
  ['coupon_value', 'قيمة الكوبون'], ['coupons_pct', 'نسبة التحويل إلى كوبونات ٪'],
  ['cost_pct', 'تكلفة الكوبون ٪'], ['per_count', 'عدد كوبونات البوانص'], ['per_base', 'لكل عدد كوبونات'],
  ['unit_value', 'قيمة كوبون البوانص'], ['cash_bonus', 'بوانص نقدية'],
];

function BonusesCard({ pkg, lines, setLines, editable, params, setParams }: ViewProps) {
  const bo = pkg?.balances?.bonuses;
  const mine = lines.filter((l) => l.section === 'bonuses');
  const [extraYears, setExtraYears] = useState<string[]>([]);
  const [extraCars, setExtraCars] = useState<string[]>([]);
  const [newCar, setNewCar] = useState('');
  const years = useMemo(() => {
    const ys = new Set<string>([...mine.map((l) => l.group_key || ''), ...extraYears]);
    const y = Number(String(pkg?.as_of || '').slice(0, 4)) || new Date().getFullYear();
    if (!Array.from(ys).filter(Boolean).length) for (let i = 4; i >= 0; i -= 1) ys.add(String(y - i));
    return Array.from(ys).filter(Boolean).sort();
  }, [mine, extraYears, pkg?.as_of]);
  const cars = useMemo(
    () => Array.from(new Set([...mine.map((l) => l.label), ...extraCars])),
    [mine, extraCars],
  );

  const cell = (car: string, y: string) => mine.find((l) => l.label === car && l.group_key === y);
  const setCell = (car: string, y: string, v: number | null) => {
    const rest = lines.filter((l) => !(l.section === 'bonuses' && l.label === car && l.group_key === y));
    if (v === null || v === 0) { setLines(rest); return; }
    setLines([...rest, { key: cell(car, y)?.key || newKey(), section: 'bonuses', group_key: y, label: car, amount: String(v), sign: 1 }]);
  };
  const renameCar = (from: string, to: string) => {
    setExtraCars(extraCars.map((c) => (c === from ? to : c)));
    setLines(lines.map((l) => (l.section === 'bonuses' && l.label === from ? { ...l, label: to } : l)));
  };
  const addYear = () => {
    const next = String((Number(years[years.length - 1]) || new Date().getFullYear()) + 1);
    setExtraYears([...extraYears, next]);
  };

  const p = params?.bonus || {};
  const setP = (k: string, v: any) => setParams({ ...params, bonus: { ...p, [k]: v === null ? '' : String(v) } });

  const columns: any[] = [
    {
      title: 'السيارة', dataIndex: 'car', key: 'car', width: 160,
      render: (v: string) => (editable
        ? <Input size="small" defaultValue={v} onBlur={(e) => e.target.value && e.target.value !== v && renameCar(v, e.target.value)} />
        : v),
    },
    ...years.map((y) => ({
      title: y, key: y, width: 120,
      render: (_: any, r: any) => (editable
        ? <InputNumber size="small" style={{ width: '100%' }} value={cell(r.car, y) ? Number(cell(r.car, y)!.amount) : null}
          onChange={(n) => setCell(r.car, y, n as number | null)} />
        : <M v={cell(r.car, y)?.amount} />),
    })),
    {
      title: 'الإجمالي', key: 't', width: 130,
      render: (_: any, r: any) => <M v={mine.filter((l) => l.label === r.car).reduce((s, l) => s + signed(l), 0)} strong />,
    },
  ];

  return (
    <Card size="small" title="بوانص التجار وتكلفتها" extra={<SourceTag source="manual" />}>
      <Table size="small" rowKey="car" pagination={false} columns={columns}
        dataSource={cars.map((c) => ({ car: c }))} locale={{ emptyText: 'لا توجد بوانص' }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
            {years.map((y, i) => (
              <Table.Summary.Cell key={y} index={i + 1}>
                <M v={mine.filter((l) => l.group_key === y).reduce((s, l) => s + signed(l), 0)} strong />
              </Table.Summary.Cell>
            ))}
            <Table.Summary.Cell index={years.length + 1}><M v={mine.reduce((s, l) => s + signed(l), 0)} strong /></Table.Summary.Cell>
          </Table.Summary.Row>
        )} />
      {editable && (
        <Space style={{ marginTop: 6 }} wrap>
          <Input size="small" placeholder="السيارة" value={newCar} onChange={(e) => setNewCar(e.target.value)} style={{ width: 180 }} />
          <Button size="small" icon={<PlusOutlined />} disabled={!newCar.trim()}
            onClick={() => { setExtraCars([...extraCars, newCar.trim()]); setNewCar(''); }}>إضافة صف</Button>
          <Button size="small" onClick={addYear}>إضافة سنة</Button>
        </Space>
      )}
      <Row gutter={12} style={{ marginTop: 12 }}>
        <Col xs={24} md={10}>
          <Typography.Text strong>المعاملات</Typography.Text>
          {PARAMS.map(([k, label]) => (
            <Space key={k} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span>{label}</span>
              {editable
                ? <InputNumber size="small" value={p[k] === '' || p[k] === undefined ? null : Number(p[k])} onChange={(n) => setP(k, n)} style={{ width: 120 }} />
                : <span dir="ltr">{p[k]}</span>}
            </Space>
          ))}
        </Col>
        <Col xs={24} md={14}>
          <Typography.Text strong>تكلفة البوانص</Typography.Text>
          <Table size="small" rowKey="label" pagination={false} showHeader={false}
            dataSource={bo?.calc || []}
            columns={[{ dataIndex: 'label', key: 'l' }, { dataIndex: 'value', key: 'v', width: 140, render: (v: any) => <M v={v} /> }]} />
          <TotalRow label="قيمة بوانص التجار" v={bo?.net} />
        </Col>
      </Row>
    </Card>
  );
}

export default function BalancesView(props: ViewProps) {
  const { pkg, lines, setLines, editable, params, setParams, openStatement } = props;
  const b = pkg?.balances;
  if (!b) return null;
  const c = b.customers;
  const custLive = num(c.system_total) + sectionTotal(lines, 'customers_adj');

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={12}>
        <Card size="small" title="مديونية العملاء"
          extra={(
            <Space>
              <Segmented size="small" value={params?.customers_group_by || 'rep'}
                disabled={!editable}
                onChange={(v) => setParams({ ...params, customers_group_by: v })}
                options={[{ value: 'rep', label: 'حسب المندوب' }, { value: 'territory', label: 'حسب المنطقة' }]} />
              <DrillButton ids={c.account_ids} open={openStatement} />
            </Space>
          )}>
          <Table size="small" rowKey={(r: any) => String(r.key)} pagination={false} dataSource={c.rows}
            columns={[
              { title: c.group_by === 'territory' ? 'المنطقة' : 'المندوب', dataIndex: 'label', key: 'l' },
              { title: 'عدد العملاء', dataIndex: 'customers', key: 'n', width: 90 },
              { title: 'المديونية', dataIndex: 'amount', key: 'a', width: 150, render: (v: any) => <M v={v} /> },
              { title: '', key: 's', width: 60, render: () => <SourceTag source="system" /> },
            ]} />
          <Typography.Text strong style={{ display: 'block', margin: '8px 0 4px' }}>المخصصات والتسويات</Typography.Text>
          <ManualLines lines={lines} setLines={setLines} section="customers_adj" editable={editable}
            withQty={false} withSign defaultSign={-1} />
          <TotalRow label="صافي مديونية العملاء" v={custLive} />
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <MixedCard title="مستحقات الموردين" block={b.suppliers} section="suppliers_adj" lines={lines}
          setLines={setLines} editable={editable} open={openStatement} />
      </Col>
      <Col xs={24} xl={12}>
        <Card size="small" title="مستحقات الفنيين" extra={<SourceTag source="manual" />}>
          <ManualLines lines={lines} setLines={setLines} section="technicians" editable={editable} />
          <TotalRow label="الإجمالي" v={sectionTotal(lines, 'technicians')} />
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card size="small" title="رصيد الهدايا" extra={<SourceTag source="manual" />}>
          <ManualLines lines={lines} setLines={setLines} section="gifts" editable={editable} withSign />
          <TotalRow label="الصافي" v={sectionTotal(lines, 'gifts')} />
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <MixedCard title="مصروفات مستحقة" block={b.accrued} section="accrued" lines={lines}
          setLines={setLines} editable={editable} open={openStatement} withSign={false} />
      </Col>
      <Col xs={24} xl={12}>
        <MixedCard title="جاري الشركاء" block={b.partners} section="partners_adj" lines={lines}
          setLines={setLines} editable={editable} open={openStatement} />
      </Col>
      <Col xs={24} xl={12}>
        <MixedCard title="النقدية" block={b.cash} section="cash" lines={lines} setLines={setLines}
          editable={editable} open={openStatement} withQty />
      </Col>
      <Col xs={24}>
        <BonusesCard {...props} />
      </Col>
    </Row>
  );
}
