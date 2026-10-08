import React, { useState } from 'react';
import { Button, Card, Col, Empty, Row, Select, Space, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { M, ManualLines, SourceTag, TotalRow, newKey, num, sectionTotal, type ViewProps } from './shared';

const DEFAULT_DEDUCTIONS = ['ديون معدومة', 'البوانص', 'كوبونات', 'مستحقات الفنيين'];

export default function SettlementView({ pkg, lines, setLines, editable }: ViewProps) {
  const st = pkg?.settlement;
  const [pick, setPick] = useState<number | undefined>();
  if (!st) return null;

  const serverAreas: any[] = st.areas || [];
  const shown = new Set(serverAreas.map((a) => String(a.territory_id)));
  const pending = Array.from(new Set(lines.filter((l) => l.section === 'settlement'
    && l.group_key && !shown.has(l.group_key)).map((l) => l.group_key as string)));
  const nameOf = (id: string) => st.territories?.find((t: any) => String(t.id) === id)?.name || `#${id}`;

  const addArea = () => {
    if (!pick) return;
    const g = String(pick);
    setLines([...lines, ...DEFAULT_DEDUCTIONS.map((label) => ({
      key: newKey(), section: 'settlement', group_key: g, label, amount: '0', sign: 1,
    }))]);
    setPick(undefined);
  };

  const areaCard = (g: string, name: string, debt: string | null) => {
    const ded = sectionTotal(lines, 'settlement', g);
    return (
      <Col xs={24} xl={12} key={g}>
        <Card size="small" title={name}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <span>المديونية في {pkg.as_of}</span>
            <Space>{debt === null ? '—' : <M v={debt} strong />}<SourceTag source="system" /></Space>
          </Space>
          <Typography.Text strong style={{ display: 'block', margin: '8px 0 4px' }}>الخصومات</Typography.Text>
          <ManualLines lines={lines} setLines={setLines} section="settlement" group={g}
            editable={editable} withQty={false} />
          <TotalRow label="الصافي المستحق على المنطقة" v={num(debt) - ded} />
        </Card>
      </Col>
    );
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {editable && (
        <Space>
          <Select showSearch optionFilterProp="label" placeholder="المنطقة" style={{ width: 240 }}
            value={pick} onChange={setPick}
            options={(st.territories || []).filter((t: any) => !shown.has(String(t.id)) && !pending.includes(String(t.id)))
              .map((t: any) => ({ value: t.id, label: t.name }))} />
          <Button icon={<PlusOutlined />} onClick={addArea} disabled={!pick}>إضافة منطقة</Button>
        </Space>
      )}
      {!serverAreas.length && !pending.length && <Empty description="لا توجد تسويات" />}
      <Row gutter={[12, 12]}>
        {serverAreas.map((a) => areaCard(String(a.territory_id), a.name, a.debt))}
        {pending.map((g) => areaCard(g, nameOf(g), null))}
      </Row>
    </Space>
  );
}
