import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, InputNumber, Modal, Radio, Row, Select, Space, Spin,
  Table, Tabs, Tag, Tooltip, message,
} from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, FileExcelOutlined, FundOutlined, PlusOutlined, SettingOutlined,
  PrinterOutlined, ReloadOutlined, SaveOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth, roleForAccess } from '../components/AuthProvider';
import DateRangeFilter from '../components/DateRangeFilter';
import { useQueryTab } from '../components/useQueryTab';
import { money, num } from '../utils/money';
import { printDocument } from '../print/brand';
import { exportExcel } from '../utils/exportExcel';
import StatementView, { buildStatement, KpiCards } from './incomeSheet/StatementView';
import ListPage from '../components/ListPage';

type Range = [Dayjs, Dayjs] | null;

const ROLE_COLORS: Record<string, string> = {
  ga: 'blue', marketing: 'purple', other_income: 'green', other_loss: 'red', excluded: 'default',
  sales: 'gold', sales_returns: 'gold', sales_discount: 'gold', purchases: 'cyan',
  purchase_returns: 'cyan',
};
const SECTION_LABELS: Record<string, string> = {
  ga: 'مصاريف عمومية وإدارية', marketing: 'مصاريف البيع والتسويق', other_income: 'إيرادات أخرى',
  other_loss: 'خسائر أخرى', cost: 'تكلفة المبيعات',
};
const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  trader: 'تاجر', showroom: 'معرض', company: 'شركة', employee: 'موظف', establishment: 'مؤسسة',
  plumber: 'سباك', other: 'أخرى',
};

const pct = (v: string | null | undefined) => (v == null ? '—' : `${num(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const iso = (d: Dayjs) => d.format('YYYY-MM-DD');

function compareRange(range: Range, mode: 'none' | 'prev' | 'year'): Range {
  if (!range || mode === 'none') return null;
  if (mode === 'year') return [range[0].subtract(1, 'year'), range[1].subtract(1, 'year')];
  const startOfMonth = range[0].date() === 1 && range[1].isSame(range[1].endOf('month'), 'day');
  if (startOfMonth) {
    const months = range[1].diff(range[0], 'month') + 1;
    const from = range[0].subtract(months, 'month');
    return [from, from.add(months - 1, 'month').endOf('month')];
  }
  const days = range[1].diff(range[0], 'day') + 1;
  return [range[0].subtract(days, 'day'), range[0].subtract(1, 'day')];
}

function quickRanges(): { label: string; value: [Dayjs, Dayjs] }[] {
  const now = dayjs();
  const qStart = now.month(Math.floor(now.month() / 3) * 3).startOf('month');
  const prevQ = qStart.subtract(3, 'month');
  return [
    { label: 'الشهر الحالي', value: [now.startOf('month'), now.endOf('month')] },
    { label: 'الشهر الماضي', value: [now.subtract(1, 'month').startOf('month'), now.subtract(1, 'month').endOf('month')] },
    { label: 'الربع الحالي', value: [qStart, qStart.add(2, 'month').endOf('month')] },
    { label: 'الربع الماضي', value: [prevQ, prevQ.add(2, 'month').endOf('month')] },
    { label: 'السنة الحالية', value: [now.startOf('year'), now.endOf('year')] },
  ];
}

const IncomeSheet: React.FC = () => {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const seesAll = roleForAccess(user?.role) === 'system_admin' || !user?.branch_id;
  const canEdit = can('accounting.chart.write');
  const [tab, setTab] = useQueryTab('sheet');
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState<number | undefined>(
    seesAll ? undefined : (user?.branch_id ?? undefined));
  const [range, setRange] = useState<Range>(() => quickRanges()[3].value);
  const [postedOnly, setPostedOnly] = useState(true);
  const [data, setData] = useState<any | null>(null);
  const [compare, setCompare] = useState<'none' | 'prev' | 'year'>('none');
  const [cmpData, setCmpData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<{ title: string; body: React.ReactNode } | null>(null);

  useEffect(() => {
    if (!seesAll) return;
    api.get('/api/v1/branches').then((r) => {
      const list = r.data || [];
      setBranches(list);
      if (branchId === undefined && list.length) setBranchId(list[0].id);
    }).catch(() => setBranches([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const params = useCallback(() => {
    const p: Record<string, any> = { posted_only: postedOnly };
    if (branchId !== undefined) p.branch_id = branchId;
    if (range) { p.date_from = iso(range[0]); p.date_to = iso(range[1]); }
    return p;
  }, [branchId, range, postedOnly]);

  const load = useCallback(async () => {
    if (!range) { setData(null); return; }
    setLoading(true);
    try {
      const cmpRange = compareRange(range, compare);
      const [r, c] = await Promise.all([
        api.get('/api/v1/reports/income-sheet', { params: params() }),
        cmpRange ? api.get('/api/v1/reports/income-sheet', {
          params: { ...params(), date_from: iso(cmpRange[0]), date_to: iso(cmpRange[1]) },
        }).catch(() => null) : Promise.resolve(null),
      ]);
      setData(r.data);
      setCmpData(c ? c.data : null);
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'تعذّر تحميل قائمة الدخل');
    } finally {
      setLoading(false);
    }
  }, [params, range, compare]);

  useEffect(() => { load(); }, [load]);

  const branchName = data?.branch_name
    || branches.find((b) => b.id === branchId)?.name || '';
  const periodLabel = range ? `من ${range[0].format('D-M-YYYY')} إلى ${range[1].format('D-M-YYYY')}` : '';

  const openAccount = (accountId: number) => {
    if (!range) return;
    navigate(`/account-statement?account=${accountId}&from=${iso(range[0])}&to=${iso(range[1])}`);
  };

  const openSales = async (key: string, name: string) => {
    if (!range) return;
    setDrill({ title: `مبيعات «${name}»`, body: <Spin /> });
    try {
      const r = await api.get('/api/v1/reports/income-sheet/sales-detail',
        { params: { ...params(), category: key } });
      const d = r.data;
      setDrill({
        title: `مبيعات «${name}» — ${money(d.total)}`,
        body: (
          <Tabs items={[
            {
              key: 'cust', label: 'بالعميل',
              children: (
                <Table size="small" rowKey={(x: any) => `${x.customer_id}`} dataSource={d.by_customer}
                  pagination={{ pageSize: 15 }}
                  columns={[
                    { title: 'العميل', dataIndex: 'customer_name' },
                    { title: 'النوع', dataIndex: 'customer_type', render: (t: string) => CUSTOMER_TYPE_LABELS[t] || t },
                    { title: 'الصافي', dataIndex: 'amount', align: 'left', render: money },
                  ]} />
              ),
            },
            {
              key: 'cat', label: 'بفئة الصنف',
              children: (
                <Table size="small" rowKey="category" dataSource={d.by_item_category} pagination={false}
                  columns={[
                    { title: 'فئة الصنف', dataIndex: 'category' },
                    { title: 'الصافي', dataIndex: 'amount', align: 'left', render: money },
                  ]} />
              ),
            },
          ]} />
        ),
      });
    } catch {
      setDrill(null);
      message.error('تعذّر تحميل التفصيل');
    }
  };

  const openInventory = async (asOf: string, title: string) => {
    setDrill({ title, body: <Spin /> });
    try {
      const p: any = { as_of: asOf };
      if (branchId !== undefined) p.branch_id = branchId;
      const r = await api.get('/api/v1/reports/income-sheet/inventory', { params: p });
      const d = r.data;
      setDrill({
        title: `${title} — ${money(d.total)}`,
        body: (
          <>
            {d.missing_cost > 0 && (
              <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                message={`${d.missing_cost} صنف له رصيد دون تكلفة — قيمته صفر في الإجمالي.`} />
            )}
            <Tabs items={[
              {
                key: 'cat', label: 'بالفئة',
                children: (
                  <Table size="small" rowKey="category" pagination={false}
                    dataSource={Object.entries(d.by_category).map(([category, value]) => ({ category, value }))}
                    columns={[
                      { title: 'الفئة', dataIndex: 'category' },
                      { title: 'القيمة', dataIndex: 'value', align: 'left', render: money },
                    ]} />
                ),
              },
              {
                key: 'rows', label: 'تفصيل الأصناف',
                children: (
                  <Table size="small" rowKey={(x: any) => `${x.item_id}-${x.warehouse_id}`} dataSource={d.rows}
                    pagination={{ pageSize: 20 }}
                    columns={[
                      { title: 'الصنف', dataIndex: 'item_name' },
                      { title: 'الفئة', dataIndex: 'category' },
                      { title: 'المخزن', dataIndex: 'warehouse_name' },
                      { title: 'الكمية', dataIndex: 'quantity', align: 'left', render: (v: string) => Number(v).toLocaleString() },
                      {
                        title: 'تكلفة الوحدة', dataIndex: 'unit_cost', align: 'left',
                        render: (v: string, r: any) => (
                          <Tooltip title={{
                            average: 'متوسط سعر الشراء حتى التاريخ', list_factor: 'أصل قائمة الأسعار × نسبة الصافي',
                            item_purchase_price: 'سعر الشراء في كارت الصنف', none: 'ليس له تكلفة',
                          }[r.cost_source as string]}>{money(v)}</Tooltip>
                        ),
                      },
                      { title: 'القيمة', dataIndex: 'value', align: 'left', render: money },
                    ]} />
                ),
              },
            ]} />
          </>
        ),
      });
    } catch {
      setDrill(null);
      message.error('تعذّر تحميل المخزون');
    }
  };

  const openPurchases = () => {
    const p = data?.cost?.purchases;
    if (!p) return;
    setDrill({
      title: `صافي المشتريات — ${money(p.net)}`,
      body: (
        <>
          <p style={{ color: '#64748b' }}>
            فواتير الشراء مطروحاً منها المرتجعات في الفترة، دون الفئات المستبعدة
            ({(data.cost.excluded_categories || []).join('، ')}) — المستبعد منها {money(p.excluded)}.
          </p>
          <Table size="small" rowKey="category" pagination={false}
            dataSource={Object.entries(p.by_category).map(([category, value]) => ({ category, value }))}
            columns={[
              { title: 'فئة الصنف', dataIndex: 'category',
                render: (c: string) => (data.cost.excluded_categories || []).includes(c)
                  ? <span>{c} <Tag>مستبعد</Tag></span> : c },
              { title: 'الصافي', dataIndex: 'value', align: 'left', render: money },
            ]} />
        </>
      ),
    });
  };

  const openLine = (line: any) => {
    if (line.manual) return;
    if (line.accounts.length === 1) { openAccount(line.accounts[0].account_id); return; }
    setDrill({
      title: `${line.name} — ${money(line.amount)}`,
      body: (
        <Table size="small" rowKey="account_id" dataSource={line.accounts} pagination={false}
          onRow={(r: any) => ({ onClick: () => openAccount(r.account_id), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'الكود', dataIndex: 'code' },
            { title: 'الحساب', dataIndex: 'name' },
            { title: 'الحركة', dataIndex: 'amount', align: 'left', render: money },
          ]} />
      ),
    });
  };

  const flatRows = useMemo(() => {
    if (!data) return [] as { section: string; label: string; amount: string; note?: string }[];
    const rows: { section: string; label: string; amount: string; note?: string }[] = [];
    const add = (section: string, label: string, amount: any, note?: string) =>
      rows.push({ section, label, amount: String(amount ?? ''), note });
    data.sales.lines.forEach((l: any) => add('المبيعات', l.name, l.amount,
      `${pct(l.pct)}${Number(l.bonus_pct) ? ` · بونص ${l.bonus_pct}% = ${money(l.bonus_value)}` : ''}`));
    add('المبيعات', 'صافي المبيعات', data.sales.total);
    const c = data.cost;
    add('تكلفة المبيعات', `المخزون أول المدة ${data.cost.opening_inventory.as_of}`, c.opening_inventory.amount,
      c.opening_inventory.source === 'override' ? 'جرد فعلي' : 'دفتري');
    add('تكلفة المبيعات', 'يضاف: صافي المشتريات خلال المدة', c.purchases.net);
    add('تكلفة المبيعات', `يطرح: المخزون آخر المدة ${data.cost.closing_inventory.as_of}`, c.closing_inventory.amount,
      c.closing_inventory.source === 'override' ? 'جرد فعلي' : 'دفتري');
    add('تكلفة المبيعات', 'المواد المباشرة', c.direct_materials);
    add('تكلفة المبيعات', 'يضاف: الأجور المباشرة', c.direct_labor);
    add('تكلفة المبيعات', 'يضاف: مواد غير مباشرة', c.indirect_materials);
    add('تكلفة المبيعات', 'يضاف: أجور غير مباشرة', c.indirect_labor);
    add('تكلفة المبيعات', 'يضاف: مصاريف أخرى', c.other_mfg);
    c.manual.forEach((l: any) => add('تكلفة المبيعات', l.name, l.amount, l.note));
    add('تكلفة المبيعات', 'تكلفة المبيعات', c.total);
    add('القائمة', 'مجمل الربح', data.gross_profit, `نسبة مجمل الربح ${pct(data.gross_margin_pct)}`);
    data.ga.lines.forEach((l: any) => add('مصاريف عمومية وإدارية', l.name, l.amount, l.manual ? l.note : undefined));
    add('مصاريف عمومية وإدارية', 'الإجمالي', data.ga.total);
    const mm = data.marketing.model;
    add('مصاريف البيع والتسويق', 'قيمة البوانص', mm.bonus_value);
    add('مصاريف البيع والتسويق', couponLabel(mm), mm.coupon_unit);
    add('مصاريف البيع والتسويق', 'كوبونات البوانص', mm.bonus_coupons);
    add('مصاريف البيع والتسويق', `× ${mm.ratio_num} ÷ ${mm.ratio_den}`, mm.ratio_coupons);
    add('مصاريف البيع والتسويق', 'كوبونات البيع الفعلي', mm.sales_coupons);
    add('مصاريف البيع والتسويق', `إجمالي الكوبونات × ${mm.coupon_cost}`, mm.amount);
    add('مصاريف البيع والتسويق', 'مصاريف البيع والتسويق', data.marketing.amount);
    add('القائمة', 'صافي الربح التشغيلي', data.operating_profit);
    add('القائمة', 'يضاف: الإيرادات الأخرى', data.other_income.total);
    add('القائمة', 'يطرح: الخسائر الأخرى', data.other_losses.total);
    add('القائمة', 'صافي الربح', data.net_profit, `نسبة صافي الربح ${pct(data.net_margin_pct)}`);
    add('القائمة', 'المصروفات للمبيعات', '', pct(data.expenses_to_sales_pct));
    return rows;
  }, [data]);

  const doExport = () => {
    if (!data) return;
    exportExcel(`قائمة الدخل ${branchName} ${data.date_to}`, [
      { title: 'القسم', value: 'section' }, { title: 'البند', value: 'label' },
      { title: 'المبلغ', value: (r: any) => (r.amount === '' ? '' : Number(r.amount)) },
      { title: 'ملاحظة', value: 'note' },
    ], flatRows, 'قائمة الدخل');
  };

  const doPrint = () => {
    if (!data) return;
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
    const tr = (label: string, amount: any, opts: { bold?: boolean; sign?: string; note?: string } = {}) =>
      `<tr${opts.bold ? ' style="font-weight:700;background:#f1f5f9"' : ''}><td style="width:50px">${esc(opts.sign || '')}</td><td>${esc(label)}</td><td style="text-align:left">${amount === '' ? '' : money(amount)}</td><td style="color:#64748b">${esc(opts.note || '')}</td></tr>`;
    const table = (title: string, body: string) =>
      `<h3 style="margin:10px 0 4px">${esc(title)}</h3><table class="items"><tbody>${body}</tbody></table>`;
    const c = data.cost;
    const mm = data.marketing.model;
    const main = [
      tr('صافي المبيعات', data.sales.total, { bold: true }),
      tr('تكلفة المبيعات', c.total, { sign: 'يطرح' }),
      tr('مجمل الربح', data.gross_profit, { bold: true, note: `نسبة مجمل الربح ${pct(data.gross_margin_pct)}` }),
      tr('مصاريف عمومية وإدارية', data.ga.total, { sign: 'يطرح' }),
      tr('مصاريف البيع والتسويق', data.marketing.amount, { sign: 'يطرح' }),
      tr('صافي الربح التشغيلي', data.operating_profit, { bold: true }),
      tr('الإيرادات الأخرى', data.other_income.total, { sign: 'يضاف' }),
      tr('الخسائر الأخرى', data.other_losses.total, { sign: 'يطرح' }),
      tr('صافي الربح', data.net_profit, { bold: true, note: `نسبة صافي الربح ${pct(data.net_margin_pct)} · المصروفات للمبيعات ${pct(data.expenses_to_sales_pct)}` }),
    ].join('');
    const sales = data.sales.lines.map((l: any) => tr(l.name, l.amount, {
      note: `${pct(l.pct)}${Number(l.bonus_pct) ? ` · بونص ${l.bonus_pct}% = ${money(l.bonus_value)}` : ''}`,
    })).join('') + tr('الإجمالي', data.sales.total, { bold: true, note: `البوانص ${money(data.sales.bonus_value)}` });
    const cost = [
      tr(`المخزون أول المدة ${c.opening_inventory.as_of}`, c.opening_inventory.amount, { note: c.opening_inventory.source === 'override' ? 'جرد فعلي' : 'دفتري' }),
      tr('صافي المشتريات خلال المدة', c.purchases.net, { sign: 'يضاف' }),
      tr(`المخزون آخر المدة ${c.closing_inventory.as_of}`, c.closing_inventory.amount, { sign: 'يطرح', note: c.closing_inventory.source === 'override' ? 'جرد فعلي' : 'دفتري' }),
      tr('المواد المباشرة', c.direct_materials, { bold: true }),
      tr('الأجور المباشرة', c.direct_labor, { sign: 'يضاف' }),
      tr('مواد غير مباشرة', c.indirect_materials, { sign: 'يضاف' }),
      tr('أجور غير مباشرة', c.indirect_labor, { sign: 'يضاف' }),
      tr('مصاريف أخرى', c.other_mfg, { sign: 'يضاف' }),
      ...c.manual.map((l: any) => tr(l.name, l.amount, { sign: 'يضاف', note: l.note })),
      tr('تكلفة المبيعات', c.total, { bold: true }),
    ].join('');
    const ga = data.ga.lines.map((l: any) => tr(l.name, l.amount, { note: l.manual ? l.note : '' })).join('')
      + tr('الإجمالي', data.ga.total, { bold: true });
    const mk = [
      tr('قيمة البوانص', mm.bonus_value),
      tr(couponLabel(mm), mm.coupon_unit),
      tr('كوبونات البوانص', mm.bonus_coupons),
      tr(`× ${mm.ratio_num} ÷ ${mm.ratio_den}`, mm.ratio_coupons),
      tr('كوبونات البيع الفعلي', mm.sales_coupons, { sign: 'يضاف' }),
      tr(`الإجمالي × ${mm.coupon_cost}`, mm.amount, { bold: true }),
    ].join('');
    printDocument({
      title: `قائمة الدخل لفرع ${branchName}`, date: periodLabel,
      fileName: `قائمة الدخل ${branchName} ${data.date_to}`,
    }, table('القائمة', main) + table('المبيعات بالفئة', sales)
      + table('قائمة التكاليف الصناعية (تكلفة المبيعات)', cost)
      + table('مصاريف عمومية وإدارية', ga) + table('مصاريف البيع والتسويق (البوانص)', mk));
  };

  const Amount: React.FC<{ v: any; onClick?: () => void; strong?: boolean }> = ({ v, onClick, strong }) => (
    <span onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : undefined, color: onClick ? '#1d4ed8' : undefined,
        fontWeight: strong ? 700 : undefined, direction: 'ltr', display: 'inline-block',
      }}>
      {money(v)}
    </span>
  );

  const StatementRow: React.FC<{
    sign?: string; label: React.ReactNode; amount: any; strong?: boolean; onClick?: () => void; note?: React.ReactNode;
  }> = ({ sign, label, amount, strong, onClick, note }) => (
    <tr style={{ background: strong ? '#f1f5f9' : undefined }}>
      <td style={{ width: 56, color: '#64748b', padding: '6px 8px' }}>{sign}</td>
      <td style={{ padding: '6px 8px', fontWeight: strong ? 700 : undefined }}>{label}</td>
      <td style={{ padding: '6px 8px', textAlign: 'left' }}><Amount v={amount} onClick={onClick} strong={strong} /></td>
      <td style={{ padding: '6px 8px', color: '#64748b', fontSize: 12 }}>{note}</td>
    </tr>
  );

  const handlers = { openSales, openInventory, openPurchases, openAccount };
  const statementRows = useMemo(() => buildStatement(data, handlers), [data]);
  const compareRows = useMemo(() => (cmpData ? buildStatement(cmpData, {}) : null), [cmpData]);
  const cmpRange = compareRange(range, compare);
  const compareLabel = cmpRange ? `${cmpRange[0].format('D-M-YYYY')} — ${cmpRange[1].format('D-M-YYYY')}` : '';

  const statement = data && (
    <Spin spinning={loading}>
      <StatementView rows={statementRows} compare={compareRows}
        label={range ? `${range[0].format('D-M-YYYY')} — ${range[1].format('D-M-YYYY')}` : ''}
        compareLabel={compareLabel}
        salesTotal={Number(data.sales.total)} compareSalesTotal={cmpData ? Number(cmpData.sales.total) : 0} />
    </Spin>
  );

  const sheet = data && (
    <Tabs type="card" defaultActiveKey="sales" style={{ width: '100%' }} items={[
      {
        key: 'sales', label: 'المبيعات بالفئة',
        children: (
          <div style={{ width: '100%' }}>
          <Table size="small" pagination={false} rowKey="key" dataSource={data.sales.lines}
            columns={[
              { title: 'الفئة', dataIndex: 'name', render: (n: string, r: any) =>
                r.key === '_unmatched' ? <Tag color="red">{n}</Tag> : n },
              { title: 'البيع خلال الفترة', dataIndex: 'amount', align: 'left',
                render: (v: string, r: any) => <Amount v={v} onClick={() => openSales(r.key, r.name)} /> },
              { title: 'النسبة', dataIndex: 'pct', align: 'left', render: pct },
              { title: 'البونص', dataIndex: 'bonus_pct', align: 'left', render: (v: string) => (Number(v) ? `${v}%` : '—') },
              { title: 'قيمة البونص', dataIndex: 'bonus_value', align: 'left', render: (v: string) => (Number(v) ? money(v) : '—') },
            ]}
            summary={() => (
              <Table.Summary.Row style={{ fontWeight: 700 }}>
                <Table.Summary.Cell index={0}>الإجمالي</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="left">{money(data.sales.total)}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="left">100%</Table.Summary.Cell>
                <Table.Summary.Cell index={3} />
                <Table.Summary.Cell index={4} align="left">{money(data.sales.bonus_value)}</Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
            من فواتير البيع مطروحاً منها المرتجعات، بعد الخصم ودون ضريبة
            {data.sales.include_bonus ? '، شاملةً فواتير البونص' : '، دون فواتير البونص (هدية — قيمتها ضمن الخصم المسموح به)'}.
          </div>
                  </div>
        ),
      },
      {
        key: 'cost', label: 'تكلفة المبيعات',
        children: (
          <div style={{ width: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <StatementRow label={`المخزون أول المدة ${data.cost.opening_inventory.as_of}`}
                amount={data.cost.opening_inventory.amount}
                onClick={() => openInventory(data.cost.opening_inventory.as_of, 'المخزون أول المدة (دفتري)')}
                note={data.cost.opening_inventory.source === 'override'
                  ? <Tooltip title={`الدفتري ${money(data.cost.opening_inventory.computed)}`}><Tag color="green">جرد فعلي</Tag></Tooltip>
                  : <Tag>دفتري</Tag>} />
              <StatementRow sign="يضاف" label="صافي المشتريات خلال المدة" amount={data.cost.purchases.net}
                onClick={openPurchases} />
              <StatementRow sign="يطرح" label={`المخزون آخر المدة ${data.cost.closing_inventory.as_of}`}
                amount={data.cost.closing_inventory.amount}
                onClick={() => openInventory(data.cost.closing_inventory.as_of, 'المخزون آخر المدة (دفتري)')}
                note={data.cost.closing_inventory.source === 'override'
                  ? <Tooltip title={`الدفتري ${money(data.cost.closing_inventory.computed)}`}><Tag color="green">جرد فعلي</Tag></Tooltip>
                  : <Tag>دفتري</Tag>} />
              <StatementRow label="المواد المباشرة" amount={data.cost.direct_materials} strong />
              <StatementRow sign="يضاف" label="الأجور المباشرة" amount={data.cost.direct_labor} />
              <StatementRow sign="يضاف" label="مواد غير مباشرة" amount={data.cost.indirect_materials} />
              <StatementRow sign="يضاف" label="أجور غير مباشرة" amount={data.cost.indirect_labor} />
              <StatementRow sign="يضاف" label="مصاريف أخرى" amount={data.cost.other_mfg} />
              {data.cost.manual.map((l: any, i: number) => (
                <StatementRow key={i} sign="يضاف" label={l.name} amount={l.amount} note={<Tag color="orange">{l.note}</Tag>} />
              ))}
              <StatementRow label="تكلفة المبيعات" amount={data.cost.total} strong />
            </tbody>
          </table>
          {(data.cost.opening_inventory.missing_cost > 0 || data.cost.closing_inventory.missing_cost > 0) && (
            <Alert type="warning" showIcon style={{ marginTop: 8 }}
              message="توجد أصناف لها رصيد دون تكلفة — قيمتها صفر في المخزون الدفتري. اضغط على رقم المخزون لعرض التفصيل." />
          )}
                  </div>
        ),
      },
      {
        key: 'ga', label: 'المصروفات العمومية والإدارية',
        children: (
          <div style={{ width: '100%' }}>
          <Table size="small" pagination={false} rowKey={(r: any) => r.name} dataSource={data.ga.lines}
            onRow={(r: any) => ({ onClick: () => openLine(r), style: { cursor: r.manual ? undefined : 'pointer' } })}
            columns={[
              { title: 'البند', dataIndex: 'name', render: (n: string, r: any) => (
                <span>{n}{r.manual && <Tag color="orange" style={{ marginInlineStart: 6 }}>{r.note}</Tag>}
                  {!r.manual && r.accounts.length > 1 && <span style={{ color: '#94a3b8' }}> ({r.accounts.length} حساب)</span>}</span>) },
              { title: 'المبلغ', dataIndex: 'amount', align: 'left', render: money },
            ]} />
                  </div>
        ),
      },
      {
        key: 'marketing', label: 'البيع والتسويق',
        children: (
          <div style={{ width: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <StatementRow label="قيمة البوانص (بيع الفئة × نسبة بونصها)" amount={data.marketing.model.bonus_value} />
              <StatementRow label={couponLabel(data.marketing.model)}
                amount={data.marketing.model.coupon_unit} />
              <StatementRow label="كوبونات البوانص (البوانص ÷ قيمة الكوبون)" amount={data.marketing.model.bonus_coupons} />
              <StatementRow label={`× ${data.marketing.model.ratio_num} ÷ ${data.marketing.model.ratio_den}`}
                amount={data.marketing.model.ratio_coupons} />
              <StatementRow sign="يضاف" label="كوبونات البيع الفعلي" amount={data.marketing.model.sales_coupons}
                note={{ issued: 'المصروفة للعملاء في الفترة', received: 'المستلمة في الفترة', manual: 'رقم ثابت من الإعدادات', period: 'مُدخلة لهذه الفترة' }[data.marketing.model.sales_coupons_source as string]} />
              <StatementRow label={`إجمالي الكوبونات ${money(data.marketing.model.total_coupons)} × ${data.marketing.model.coupon_cost}`}
                amount={data.marketing.model.amount} strong
                note={data.marketing.source === 'model' ? <Tag color="blue">المستعمل في القائمة</Tag> : null} />
              {data.marketing.manual.map((l: any, i: number) => (
                <StatementRow key={i} sign="يضاف" label={l.name} amount={l.amount} note={<Tag color="orange">{l.note}</Tag>} />
              ))}
            </tbody>
          </table>
          <Alert style={{ marginTop: 10 }} type="info"
            message="للمقارنة — القيم الفعلية من النظام (غير محتسبة في القائمة إلا إذا اختيرت في الإعدادات)"
            description={(
              <div>
                <div>كوبونات صُرفت للعملاء في الفترة: <b>{data.marketing.actual.issued_total}</b>
                  {' '}({Object.entries(data.marketing.actual.coupons_issued).map(([k, n]) => `${k} ${n}`).join('، ') || '—'})
                  {' '}× القيمة = <b>{money(data.marketing.actual.coupons_value)}</b>
                  {data.marketing.source === 'coupons' && <Tag color="blue" style={{ marginInlineStart: 6 }}>المستعمل</Tag>}
                </div>
                <div>كوبونات استُلمت في الفترة: <b>{data.marketing.actual.received_total}</b></div>
                <div>حسابات «بيع وتسويق» الفعلية (نقاط، عهدة خدمة العملاء…): <b>{money(data.marketing.actual.ledger.total)}</b>
                  {data.marketing.source === 'ledger' && <Tag color="blue" style={{ marginInlineStart: 6 }}>المستعمل</Tag>}
                </div>
                {data.marketing.actual.ledger.lines.map((l: any) => (
                  <div key={l.name} style={{ paddingInlineStart: 12, cursor: 'pointer', color: '#1d4ed8' }} onClick={() => openLine(l)}>
                    • {l.name}: {money(l.amount)}
                  </div>
                ))}
              </div>
            )} />
                  </div>
        ),
      },
      {
        key: 'other', label: 'الإيرادات والخسائر الأخرى',
        children: (
          <div style={{ width: '100%' }}>
          <Table size="small" pagination={false} rowKey={(r: any) => `${r.kind}-${r.name}`}
            dataSource={[
              ...data.other_income.lines.map((l: any) => ({ ...l, kind: 'إيراد' })),
              ...data.other_losses.lines.map((l: any) => ({ ...l, kind: 'خسارة' })),
            ]}
            locale={{ emptyText: 'لا يوجد' }}
            onRow={(r: any) => ({ onClick: () => openLine(r), style: { cursor: r.manual ? undefined : 'pointer' } })}
            columns={[
              { title: '', dataIndex: 'kind', width: 70 },
              { title: 'البند', dataIndex: 'name' },
              { title: 'المبلغ', dataIndex: 'amount', align: 'left', render: money },
            ]} />
                  </div>
        ),
      },
      {
        key: 'recon', label: 'المطابقة مع الدفاتر',
        children: (
          <div style={{ width: '100%' }}>
          <table style={{ width: '100%' }}>
            <tbody>
              <StatementRow label="صافي المبيعات من الحسابات (مبيعات − مردودات − خصم مسموح/بونص)"
                amount={data.reconciliation.ledger_net_sales} />
              <StatementRow label="صافي المبيعات من الفواتير (المستعمل)" amount={data.reconciliation.documents_net_sales} />
              <StatementRow label="صافي المشتريات من الحسابات" amount={data.reconciliation.ledger_net_purchases} />
              <StatementRow label="صافي المشتريات من الفواتير (المستعمل)" amount={data.reconciliation.documents_net_purchases}
                note={`مستبعد بفئته ${money(data.reconciliation.documents_excluded_purchases)}`} />
            </tbody>
          </table>
          {data.reconciliation.excluded_accounts.length > 0 && (
            <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
              حسابات مستبعدة من القائمة (من الإعدادات): {data.reconciliation.excluded_accounts.map((a: any) => (
                <Tag key={a.account_id} style={{ cursor: 'pointer' }} onClick={() => openAccount(a.account_id)}>
                  {a.name} {money(a.amount)}
                </Tag>
              ))}
            </div>
          )}
                  </div>
        ),
      },
    ]} />
  );

  const empty = <Empty description="اختر الفترة من الفلاتر فوق" />;
  const quick = quickRanges();

  return (
    <>
      <ListPage
        icon={<FundOutlined />}
        title="قائمة الدخل"
        muted={data ? `${branchName}${periodLabel ? ` · ${periodLabel}` : ''}` : undefined}
        tabs={[
          { key: 'sheet', label: 'القائمة' },
          { key: 'details', label: 'التفاصيل' },
        ]}
        activeTab={tab as any}
        onTabChange={(k) => setTab(k)}
        actions={(<>
          <Button icon={<PrinterOutlined />} onClick={doPrint} disabled={!data}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={!range}>تحديث</Button>
          {canEdit ? (
            <Button icon={<SettingOutlined />} type={tab === 'settings' ? 'primary' : 'default'}
              onClick={() => setTab(tab === 'settings' ? 'sheet' : 'settings')}>
              {tab === 'settings' ? 'رجوع للقائمة' : 'إعدادات الحساب'}
            </Button>
          ) : null}
        </>)}
        filters={(<>
          {seesAll ? (
            <Select style={{ flex: '0 0 170px' }} value={branchId} onChange={setBranchId} placeholder="الفرع"
              options={[...branches.map((b) => ({ value: b.id, label: b.name })), { value: 0, label: 'كل الفروع' }]} />
          ) : null}
          <DateRangeFilter className="sl-f-dates" value={range} onChange={setRange} />
          <Select style={{ flex: '0 0 160px' }} placeholder="فترة جاهزة" value={null as any}
            onChange={(i: number) => setRange(quick[i].value)}
            options={quick.map((q, i) => ({ value: i, label: q.label }))} />
          <Select style={{ flex: '0 0 230px' }} value={compare} onChange={setCompare}
            options={[
              { value: 'none', label: 'بدون مقارنة' },
              { value: 'prev', label: 'مقارنة بالفترة السابقة' },
              { value: 'year', label: 'مقارنة بنفس الفترة العام الماضي' },
            ]} />
          <Select style={{ flex: '0 0 140px' }} value={postedOnly} onChange={setPostedOnly}
            options={[{ value: true, label: 'المرحّل' }, { value: false, label: 'كل القيود' }]} />
        </>)}
        summary={tab === 'sheet' && data ? <KpiCards data={data} /> : undefined}
      >
        {tab === 'sheet' ? (!range ? empty : loading && !data ? <Spin /> : statement)
          : tab === 'details' ? (!range ? empty : loading && !data ? <Spin />
            : (data ? <Spin spinning={loading}>{sheet}</Spin> : null))
          : tab === 'settings' && canEdit ? <SettingsTab branchId={branchId} canEdit={canEdit} onSaved={load} />
          : (!range ? empty : statement)}
      </ListPage>

      <Modal open={!!drill} onCancel={() => setDrill(null)} footer={null} width={900} title={drill?.title} destroyOnClose>
        {drill?.body}
      </Modal>
    </>
  );
};

const PeriodInputs: React.FC<{
  data: any; range: Range; branchId?: number; canEdit: boolean; onSaved: () => void;
}> = ({ data, range, branchId, canEdit, onSaved }) => {
  const inputs = data?.period_inputs || {};
  const [opening, setOpening] = useState<number | null>(null);
  const [closing, setClosing] = useState<number | null>(null);
  const [coupons, setCoupons] = useState<number | null>(null);
  const [adj, setAdj] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOpening(inputs.opening_inventory != null ? Number(inputs.opening_inventory) : null);
    setClosing(inputs.closing_inventory != null ? Number(inputs.closing_inventory) : null);
    setCoupons(inputs.sales_coupons != null ? Number(inputs.sales_coupons) : null);
    setAdj((inputs.adjustments || []).map((a: any) => ({ ...a, amount: Number(a.amount) })));
  }, [data?.period_key, data?.branch_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!range || !data) return <Empty description="اختر الفرع والفترة أولاً" />;

  const save = async () => {
    setSaving(true);
    try {
      const p: any = { date_from: iso(range[0]), date_to: iso(range[1]) };
      if (branchId !== undefined) p.branch_id = branchId;
      await api.put('/api/v1/reports/income-sheet/period', {
        opening_inventory: opening, closing_inventory: closing, sales_coupons: coupons,
        adjustments: adj,
      }, { params: p });
      message.success('تم حفظ مدخلات الفترة');
      onSaved();
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: number | null, set: (v: number | null) => void, hint: React.ReactNode) => (
    <Row gutter={8} align="middle" style={{ marginBottom: 10 }}>
      <Col flex="260px">{label}</Col>
      <Col flex="220px">
        <InputNumber style={{ width: '100%' }} value={value} onChange={(v) => set(v as number | null)}
          disabled={!canEdit} placeholder="فارغ = القيمة الدفترية / النظام" />
      </Col>
      <Col flex="auto" style={{ color: '#64748b' }}>{hint}</Col>
    </Row>
  );

  return (
    <Card size="small" title={`مدخلات الفترة ${data.date_from} → ${data.date_to} — ${data.branch_name}`}>
      {field(`المخزون أول المدة (جرد ${data.cost.opening_inventory.as_of})`, opening, setOpening,
        <>الدفتري: {money(data.cost.opening_inventory.computed)}</>)}
      {field(`المخزون آخر المدة (جرد ${data.cost.closing_inventory.as_of})`, closing, setClosing,
        <>الدفتري: {money(data.cost.closing_inventory.computed)}</>)}
      {field('كوبونات البيع الفعلي (عدد)', coupons, setCoupons,
        <>المصروف للعملاء في الفترة: {data.marketing.actual.issued_total} · المستلم: {data.marketing.actual.received_total}</>)}

      <h4 style={{ marginTop: 16 }}>بنود يدوية («زيادة») — مصروفات ليس لها قيد في الفترة</h4>
      <Table size="small" pagination={false} rowKey={(_: any, i?: number) => String(i)} dataSource={adj}
        columns={[
          { title: 'البند', render: (_: any, r: any, i: number) => (
            <Input value={r.label} disabled={!canEdit}
              onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />) },
          { title: 'المبلغ', width: 180, render: (_: any, r: any, i: number) => (
            <InputNumber style={{ width: '100%' }} value={r.amount} disabled={!canEdit}
              onChange={(v) => setAdj(adj.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />) },
          { title: 'القسم', width: 220, render: (_: any, r: any, i: number) => (
            <Select style={{ width: '100%' }} value={r.section || 'ga'} disabled={!canEdit}
              options={Object.entries(SECTION_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(v) => setAdj(adj.map((x, j) => (j === i ? { ...x, section: v } : x)))} />) },
          { title: 'ملاحظة', width: 140, render: (_: any, r: any, i: number) => (
            <Input value={r.note} placeholder="زيادة" disabled={!canEdit}
              onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />) },
          { title: '', width: 50, render: (_: any, __: any, i: number) => canEdit && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setAdj(adj.filter((_x, j) => j !== i))} />) },
        ]} />
      {canEdit && (
        <Space style={{ marginTop: 10 }}>
          <Button icon={<PlusOutlined />} onClick={() => setAdj([...adj, { label: '', amount: null, section: 'ga', note: 'زيادة' }])}>
            بند
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>حفظ مدخلات الفترة</Button>
        </Space>
      )}
    </Card>
  );
};

export const couponLabel = (mm: any) => (mm.coupon_item
  ? `قيمة الكوبون: ${mm.coupon_item.name} (${mm.coupon_item.tier_label}) ${mm.coupon_price} − خصم ${Number(mm.coupon_discount_pct)}%`
  : `قيمة الكوبون (${mm.coupon_base} × ${mm.coupon_base_pct}%)`);

const SettingsTab: React.FC<{ branchId?: number; canEdit: boolean; onSaved: () => void }> = ({ branchId, canEdit, onSaved }) => {
  const [meta, setMeta] = useState<any | null>(null);
  const [cfg, setCfg] = useState<any | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [accFilter, setAccFilter] = useState('');
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    api.get('/api/v1/items').then((r) => setItems(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const p: any = {};
    if (branchId !== undefined) p.branch_id = branchId;
    const r = await api.get('/api/v1/reports/income-sheet/settings', { params: p });
    setMeta(r.data);
    setCfg(JSON.parse(JSON.stringify(r.data.config)));
    setRoles({ ...(r.data.config.accounts?.roles || {}) });
  }, [branchId]);

  useEffect(() => { load().catch(() => message.error('تعذّر تحميل الإعدادات')); }, [load]);

  if (!meta || !cfg) return <Spin />;

  const set = (path: string[], value: any) => {
    const next = JSON.parse(JSON.stringify(cfg));
    let cur = next;
    path.slice(0, -1).forEach((k) => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
    cur[path[path.length - 1]] = value;
    setCfg(next);
  };
  const cats: any[] = cfg.sales.categories;
  const setCat = (i: number, patch: any) => set(['sales', 'categories'], cats.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const moveCat = (i: number, d: number) => {
    const list = [...cats];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set(['sales', 'categories'], list);
  };
  const catOptions = meta.item_categories.map((c: string) => ({ value: c, label: c }));
  const custOptions = meta.customers.map((c: any) => ({ value: c.id, label: c.name }));
  const typeOptions = meta.customer_types.map((t: string) => ({ value: t, label: CUSTOMER_TYPE_LABELS[t] || t }));

  const save = async () => {
    setSaving(true);
    try {
      const p: any = {};
      if (branchId !== undefined) p.branch_id = branchId;
      const body = { ...cfg, accounts: { ...cfg.accounts, roles } };
      delete body.periods;
      await api.put('/api/v1/reports/income-sheet/settings', { config: body }, { params: p });
      message.success('تم حفظ الإعدادات');
      await load();
      onSaved();
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const num = (path: string[], label: string, hint?: string) => (
    <Col xs={24} md={8}>
      <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
      <InputNumber style={{ width: '100%' }} disabled={!canEdit}
        value={path.reduce((o: any, k) => (o ? o[k] : undefined), cfg)}
        onChange={(v) => set(path, v)} />
      {hint && <div style={{ color: '#94a3b8', fontSize: 11 }}>{hint}</div>}
    </Col>
  );

  const accounts = (meta.accounts as any[]).filter((a) => !accFilter
    || `${a.code || ''} ${a.name} ${a.parent_name || ''}`.includes(accFilter));

  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`إعدادات ${meta.branch_name}`} />

      <Card size="small" title="فئات المبيعات — تُطبَّق على السطر أول قاعدة مطابقة" style={{ marginBottom: 16 }}>
        {cats.map((c, i) => (
          <Card key={`${c.key}-${i}`} size="small" style={{ marginBottom: 8 }}
            title={(
              <Space>
                <Input style={{ width: 160 }} value={c.name} disabled={!canEdit} onChange={(e) => setCat(i, { name: e.target.value })} />
                <span style={{ color: '#64748b' }}>بونص %</span>
                <InputNumber style={{ width: 90 }} value={c.bonus_pct} disabled={!canEdit} onChange={(v) => setCat(i, { bonus_pct: v ?? 0 })} />
              </Space>
            )}
            extra={canEdit && (
              <Space>
                <Button size="small" icon={<ArrowUpOutlined />} onClick={() => moveCat(i, -1)} />
                <Button size="small" icon={<ArrowDownOutlined />} onClick={() => moveCat(i, 1)} />
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => set(['sales', 'categories'], cats.filter((_x, j) => j !== i))} />
              </Space>
            )}>
            <Row gutter={[8, 8]}>
              <Col xs={24} md={12}>
                <div style={{ fontSize: 12, color: '#64748b' }}>فئات الأصناف</div>
                <Select mode="multiple" allowClear style={{ width: '100%' }} disabled={!canEdit} options={catOptions}
                  value={c.item_categories || []} onChange={(v) => setCat(i, { item_categories: v })} placeholder="أي فئة" />
              </Col>
              <Col xs={24} md={12}>
                <div style={{ fontSize: 12, color: '#64748b' }}>أنواع العملاء</div>
                <Select mode="multiple" allowClear style={{ width: '100%' }} disabled={!canEdit} options={typeOptions}
                  value={c.customer_types || []} onChange={(v) => setCat(i, { customer_types: v })} placeholder="أي نوع" />
              </Col>
              <Col xs={24} md={12}>
                <div style={{ fontSize: 12, color: '#64748b' }}>عملاء بعينهم</div>
                <Select mode="multiple" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
                  disabled={!canEdit} options={custOptions}
                  value={c.customer_ids || []} onChange={(v) => setCat(i, { customer_ids: v })} placeholder="—" />
              </Col>
              <Col xs={24} md={12}>
                <div style={{ fontSize: 12, color: '#64748b' }}>أو كلمة كاملة في اسم العميل</div>
                <Select mode="tags" style={{ width: '100%' }} disabled={!canEdit}
                  value={c.customer_name_words || []} onChange={(v) => setCat(i, { customer_name_words: v })} placeholder="مثلاً: فرع" />
              </Col>
            </Row>
            {meta.resolved_customers?.[c.key]?.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                العملاء حالياً: {meta.resolved_customers[c.key].map((x: any) => x.name).join('، ')}
              </div>
            )}
            {!(c.item_categories?.length || c.customer_types?.length || c.customer_ids?.length || c.customer_name_words?.length) && (
              <Tag color="blue" style={{ marginTop: 6 }}>بدون شروط = جميع ما تبقى</Tag>
            )}
          </Card>
        ))}
        {canEdit && (
          <Button icon={<PlusOutlined />} onClick={() => set(['sales', 'categories'],
            [...cats, { key: `cat${Date.now()}`, name: 'فئة جديدة', bonus_pct: 0 }])}>فئة</Button>
        )}
        <div style={{ marginTop: 8 }}>
          <Radio.Group disabled={!canEdit} value={!!cfg.sales.include_bonus} onChange={(e) => set(['sales', 'include_bonus'], e.target.value)}>
            <Radio value={false}>بدون فواتير البونص</Radio>
            <Radio value>شاملة فواتير البونص</Radio>
          </Radio.Group>
        </div>
      </Card>

      <Card size="small" title="تقييم المخزون والمشتريات" style={{ marginBottom: 16 }}>
        <Radio.Group disabled={!canEdit} value={cfg.inventory.cost_basis} onChange={(e) => set(['inventory', 'cost_basis'], e.target.value)}>
          <Radio value="average">متوسط سعر الشراء حتى التاريخ</Radio>
          <Radio value="list_factor">أصل قائمة الأسعار × نسبة الصافي (كما في أوراق الجرد)</Radio>
        </Radio.Group>
        <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>فئات مستبعدة من المخزون ومن المشتريات (ليست بضاعة للبيع)</div>
        <Select mode="multiple" style={{ width: '100%' }} disabled={!canEdit} options={catOptions}
          value={cfg.inventory.exclude_categories || []} onChange={(v) => set(['inventory', 'exclude_categories'], v)} />
        {cfg.inventory.cost_basis === 'list_factor' && (
          <>
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>نسبة الصافي من أصل قائمة الأسعار لكل فئة (الفارغ = متوسط سعر الشراء)</div>
            <Row gutter={[8, 8]}>
              {meta.item_categories.map((c: string) => (
                <Col key={c} xs={12} md={6}>
                  <div style={{ fontSize: 12 }}>{c}</div>
                  <InputNumber style={{ width: '100%' }} disabled={!canEdit} addonAfter="%"
                    value={cfg.inventory.list_factors?.[c] ?? null}
                    onChange={(v) => set(['inventory', 'list_factors'], { ...(cfg.inventory.list_factors || {}), [c]: v })} />
                </Col>
              ))}
            </Row>
          </>
        )}
      </Card>

      <Card size="small" title="مصاريف البيع والتسويق (البوانص والكوبونات)" style={{ marginBottom: 16 }}>
        <Radio.Group disabled={!canEdit} value={cfg.marketing.source} onChange={(e) => set(['marketing', 'source'], e.target.value)}
          style={{ marginBottom: 10 }}>
          <Radio value="model">نموذج البوانص (كما في الورقة)</Radio>
          <Radio value="coupons">الكوبونات المصروفة × قيمتها</Radio>
          <Radio value="ledger">حسابات البيع والتسويق الفعلية</Radio>
        </Radio.Group>
        <Row gutter={[8, 8]}>
          <Col xs={24} md={8}>
            <div style={{ color: '#64748b', fontSize: 12 }}>صنف قيمة الكوبون</div>
            <Select showSearch allowClear style={{ width: '100%' }} disabled={!canEdit}
              placeholder={cfg.marketing.coupon_item_name || 'اختر الصنف'}
              value={cfg.marketing.coupon_item_id ?? undefined}
              onChange={(v) => set(['marketing', 'coupon_item_id'], v ?? null)}
              optionFilterProp="label"
              options={items.map((i: any) => ({ value: i.id, label: `${i.name} — ${i.code}` }))} />
          </Col>
          <Col xs={24} md={8}>
            <div style={{ color: '#64748b', fontSize: 12 }}>شريحة السعر</div>
            <Select style={{ width: '100%' }} disabled={!canEdit} value={cfg.marketing.coupon_item_tier || 'semi_commercial'}
              onChange={(v) => set(['marketing', 'coupon_item_tier'], v)}
              options={[['commercial', 'تجاري'], ['semi_commercial', 'نصف تجاري'], ['wholesale', 'جملة'],
                ['semi_wholesale', 'نصف جملة'], ['consumer', 'مستهلك']].map(([value, label]) => ({ value, label }))} />
          </Col>
          {num(['marketing', 'coupon_discount_pct'], 'خصم على سعر الصنف %')}
          {num(['marketing', 'coupon_cost'], 'تكلفة الكوبون الواحد')}
          {num(['marketing', 'ratio_num'], 'معامل × (بسط)')}
          {num(['marketing', 'ratio_den'], 'معامل ÷ (مقام)')}
          <Col xs={24} md={8}>
            <div style={{ color: '#64748b', fontSize: 12 }}>كوبونات البيع الفعلي</div>
            <Select style={{ width: '100%' }} disabled={!canEdit} value={cfg.marketing.sales_coupons_source}
              onChange={(v) => set(['marketing', 'sales_coupons_source'], v)}
              options={[
                { value: 'issued', label: 'المصروفة للعملاء في الفترة' },
                { value: 'received', label: 'المستلمة في الفترة' },
                { value: 'manual', label: 'رقم ثابت' },
              ]} />
            {cfg.marketing.sales_coupons_source === 'manual' && (
              <InputNumber style={{ width: '100%', marginTop: 4 }} disabled={!canEdit} value={cfg.marketing.sales_coupons_manual}
                onChange={(v) => set(['marketing', 'sales_coupons_manual'], v)} />
            )}
          </Col>
        </Row>
      </Card>

      <Card size="small" title="بنود المصروفات (تجميع الحسابات كما في الورقة)" style={{ marginBottom: 16 }}>
        <Table size="small" pagination={false} rowKey={(_: any, i?: number) => String(i)} dataSource={cfg.accounts.groups}
          columns={[
            { title: 'البند', width: 220, render: (_: any, g: any, i: number) => (
              <Input value={g.name} disabled={!canEdit}
                onChange={(e) => set(['accounts', 'groups'], cfg.accounts.groups.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)))} />) },
            { title: 'كلمات في اسم الحساب', render: (_: any, g: any, i: number) => (
              <Select mode="tags" style={{ width: '100%' }} disabled={!canEdit} value={g.keywords || []}
                onChange={(v) => set(['accounts', 'groups'], cfg.accounts.groups.map((x: any, j: number) => (j === i ? { ...x, keywords: v } : x)))} />) },
            { title: '', width: 50, render: (_: any, __: any, i: number) => canEdit && (
              <Button size="small" danger icon={<DeleteOutlined />}
                onClick={() => set(['accounts', 'groups'], cfg.accounts.groups.filter((_x: any, j: number) => j !== i))} />) },
          ]} />
        {canEdit && (
          <Button style={{ marginTop: 8 }} icon={<PlusOutlined />}
            onClick={() => set(['accounts', 'groups'], [...cfg.accounts.groups, { name: 'بند جديد', keywords: [], account_ids: [] }])}>بند</Button>
        )}
      </Card>

      <Card size="small" title="تصنيف الحسابات — موضع كل حساب إيرادات/مصروفات في القائمة"
        extra={<Input.Search allowClear placeholder="بحث" onSearch={setAccFilter} style={{ width: 200 }} />}>
        <Table size="small" rowKey="account_id" dataSource={accounts} pagination={{ pageSize: 25 }}
          columns={[
            { title: 'الكود', dataIndex: 'code', width: 120 },
            { title: 'الحساب', dataIndex: 'name' },
            { title: 'تحت', dataIndex: 'parent_name' },
            { title: 'البند', dataIndex: 'group', render: (g: string) => g || '—' },
            { title: 'الدور', width: 260, render: (_: any, a: any) => {
              const value = roles[String(a.account_id)] ?? a.default_role;
              return (
                <Space>
                  <Select style={{ width: 200 }} disabled={!canEdit} value={value}
                    options={Object.entries(meta.roles).map(([v, l]) => ({ value: v, label: l as string }))}
                    onChange={(v) => {
                      const next = { ...roles };
                      if (v === a.default_role) delete next[String(a.account_id)]; else next[String(a.account_id)] = v;
                      setRoles(next);
                    }} />
                  {value !== a.default_role && <Tag color="orange">معدّل</Tag>}
                </Space>
              );
            } },
            { title: '', width: 30, render: (_: any, a: any) => <Tag color={ROLE_COLORS[roles[String(a.account_id)] ?? a.default_role]}> </Tag> },
          ]} />
      </Card>

      {canEdit && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', padding: '10px 0' }}>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>حفظ الإعدادات</Button>
        </div>
      )}
    </div>
  );
};

export default IncomeSheet;
