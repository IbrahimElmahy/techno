import React from 'react';
import { Card, Col, Row, Select, Space, Table, Typography } from 'antd';
import { M, ManualLines, SourceTag, type ViewProps } from './shared';

const BLOCK_VIEW: Record<string, string> = {
  inventory: 'inventory', bonuses: 'balances', technicians: 'balances',
};

export default function BalanceSheetView({ pkg, lines, setLines, editable, openStatement, goto }: ViewProps) {
  const bs = pkg?.balance_sheet;
  if (!bs) return null;

  const open = (x: any) => {
    if (x.link?.accounts?.length) openStatement(x.link.accounts[0]);
    else if (x.link?.block) goto(BLOCK_VIEW[x.link.block] || 'package');
  };

  const section = (title: string, rows: any[], total: string) => (
    <>
      <Table size="small" rowKey="key" pagination={false} showHeader={false} dataSource={rows}
        title={() => (
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>{title}</Typography.Text>
            <M v={total} strong />
          </Space>
        )}
        locale={{ emptyText: '—' }}
        columns={[
          { key: 'l', render: (_: any, x: any) => (x.link ? <a onClick={() => open(x)}>{x.label}</a> : x.label) },
          { key: 'a', width: 150, render: (_: any, x: any) => <M v={x.amount} /> },
          { key: 's', width: 110, render: (_: any, x: any) => <SourceTag source={x.source} /> },
        ]} />
      <div style={{ height: 8 }} />
    </>
  );

  const bsLines = lines.filter((l) => l.section === 'balance_sheet');

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Typography.Title level={4} style={{ textAlign: 'center', margin: 0 }}>
        الميزانية العمومية في {pkg.as_of} — {pkg.branch_name}
      </Typography.Title>
      <Row gutter={12}>
        <Col xs={24} lg={12}>
          <Card size="small" title="الأصول" extra={<M v={bs.assets.total} strong />}>
            {section('الأصول المتداولة', bs.assets.current, bs.assets.current_total)}
            {section('الأصول الثابتة', bs.assets.fixed, bs.assets.fixed_total)}
            {section('أرصدة مدينة أخرى', bs.assets.other, bs.assets.other_total)}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="الخصوم وحقوق الملكية" extra={<M v={bs.total} strong />}>
            {section('حقوق الملكية', bs.equity.rows, bs.equity.total)}
            {section('الالتزامات', bs.liabilities.rows, bs.liabilities.total)}
          </Card>
        </Col>
      </Row>
      {!!bs.memo?.length && (
        <Card size="small" title="بنود خارج الميزانية">
          {section('', bs.memo, String(bs.memo.reduce((s: number, m: any) => s + Number(m.amount || 0), 0)))}
        </Card>
      )}
      <Card size="small" title="بنود الميزانية اليدوية">
        <ManualLines lines={lines} setLines={setLines} section="balance_sheet" editable={editable}
          withQty={false} withSign />
        {editable && !!bsLines.length && (
          <Table size="small" rowKey="key" pagination={false} dataSource={bsLines} style={{ marginTop: 8 }}
            columns={[
              { title: 'البند', dataIndex: 'label', key: 'l' },
              {
                title: 'التصنيف', key: 'g', width: 220,
                render: (_: any, r: any) => (
                  <Select size="small" style={{ width: 200 }} value={r.group_key || 'asset'}
                    onChange={(v) => setLines(lines.map((l) => (l.key === r.key ? { ...l, group_key: v } : l)))}
                    options={[
                      { value: 'asset', label: 'أصل ثابت' },
                      { value: 'liability', label: 'التزام' },
                      { value: 'memo', label: 'خارج الميزانية' },
                    ]} />
                ),
              },
            ]} />
        )}
      </Card>
    </Space>
  );
}
