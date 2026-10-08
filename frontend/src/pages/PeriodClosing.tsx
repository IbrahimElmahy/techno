import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, DatePicker, Divider, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Tag, Typography, message,
} from 'antd';
import {
  CheckCircleOutlined, DeleteOutlined, FileExcelOutlined, LinkOutlined, PlusOutlined, PrinterOutlined,
  ReloadOutlined, RollbackOutlined, SaveOutlined, SettingOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getViewBranch } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { fromServer, type ClosingLine, type ViewProps } from './periodClosing/shared';
import InventoryView from './periodClosing/InventoryView';
import BalancesView from './periodClosing/BalancesView';
import BalanceSheetView from './periodClosing/BalanceSheetView';
import SettlementView from './periodClosing/SettlementView';
import AdvancesView from './periodClosing/AdvancesView';
import ConfigModal from './periodClosing/ConfigModal';
import { printClosing } from './periodClosing/print';

const VIEWS: Record<string, { title: string; blocks: string[] }> = {
  inventory: { title: 'تقييم المخزون', blocks: ['inventory'] },
  balances: { title: 'ملخص الأرصدة', blocks: ['balances'] },
  'balance-sheet': { title: 'الميزانية العمومية الإدارية', blocks: ['balance_sheet'] },
  settlement: { title: 'تسوية فرع / منطقة', blocks: ['settlement'] },
  advances: { title: 'سلف الموظفين في تاريخ', blocks: ['advances'] },
  package: {
    title: 'حزمة الإقفال',
    blocks: ['inventory', 'balances', 'balance_sheet', 'settlement', 'advances'],
  },
};

function lastQuarterEnd(): Dayjs {
  const now = dayjs();
  const qStart = now.month(Math.floor(now.month() / 3) * 3).startOf('month');
  return qStart.subtract(1, 'day');
}

export default function PeriodClosing() {
  const [search, setSearch] = useSearchParams();
  const view = VIEWS[search.get('view') || ''] ? (search.get('view') as string) : 'package';
  const meta = VIEWS[view];
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const canWrite = can('ledger.post');

  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [branchId, setBranchId] = useState<number | undefined>(
    Number(search.get('branch')) || getViewBranch() || user?.branch_id || undefined,
  );
  const [asOf, setAsOf] = useState<Dayjs>(search.get('as_of') ? dayjs(search.get('as_of')) : lastQuarterEnd());
  const [pkg, setPkg] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [lines, setLinesState] = useState<ClosingLine[]>([]);
  const [params, setParamsState] = useState<any>({});
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [advDates, setAdvDates] = useState<string[]>([]);
  const [closings, setClosings] = useState<any[]>([]);

  const seesAll = !user?.branch_id || user?.role === 'system_admin' || (user?.role as string) === 'owner';
  const iso = asOf.format('YYYY-MM-DD');

  useEffect(() => {
    if (!seesAll) return;
    api.get('/api/v1/branches').then((r) => {
      const list = (r.data || []).filter((b: any) => b.active !== false);
      setBranches(list);
      if (!branchId && list.length) setBranchId(list[0].id);
    }).catch(() => setBranches([]));
  }, []);

  const load = useCallback(async () => {
    if (seesAll && !branchId) return;
    setLoading(true);
    try {
      const res = await api.get('/api/v1/period-closing/package', {
        params: {
          as_of: iso, branch_id: branchId, blocks: meta.blocks.join(','),
          ...(advDates.length ? { advance_dates: advDates.join(',') } : {}),
        },
        timeout: 120000,
      });
      setPkg(res.data);
      const c = res.data.closing;
      setLinesState(fromServer(c?.lines));
      setParamsState(c?.params || res.data.balances?.params || {});
      setNotes(c?.notes || '');
      setDirty(false);
      api.get('/api/v1/period-closing/closings', { params: { branch_id: branchId } })
        .then((r) => setClosings(r.data || [])).catch(() => setClosings([]));
    } catch {
      setPkg(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, iso, view, advDates.join(',')]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const next = new URLSearchParams(search);
    next.set('view', view);
    next.set('as_of', iso);
    if (branchId) next.set('branch', String(branchId));
    setSearch(next, { replace: true });
  }, [iso, branchId, view]);

  const closing = pkg?.closing;
  const editable = Boolean(closing && closing.status === 'draft' && canWrite);
  const setLines = (l: ClosingLine[]) => { setLinesState(l); setDirty(true); };
  const setParams = (p: any) => { setParamsState(p); setDirty(true); };

  const confirmDiscard = (go: () => void) => {
    if (!dirty) { go(); return; }
    Modal.confirm({
      title: 'توجد تعديلات غير محفوظة', content: 'سيتم فقد التعديلات غير المحفوظة. هل تريد المتابعة؟',
      okText: 'متابعة', cancelText: 'إلغاء', onOk: go,
    });
  };

  const createClosing = async () => {
    try {
      await api.post('/api/v1/period-closing/closings', { closing_date: iso, copy_previous: true },
        { params: { branch_id: branchId } });
      message.success('تم إنشاء الإقفال');
      load();
    } catch { setLoading(false); }
  };

  const save = async () => {
    if (!closing) return;
    setSaving(true);
    try {
      await api.put(`/api/v1/period-closing/closings/${closing.id}`, {
        notes, params,
        lines: lines.map((l, i) => ({
          section: l.section, group_key: l.group_key ?? null, label: l.label || '',
          quantity: l.quantity === '' ? null : l.quantity ?? null, rate: l.rate === '' ? null : l.rate ?? null,
          amount: l.amount === '' ? null : l.amount ?? null, sign: l.sign, sort_order: i, note: l.note ?? null,
        })),
      });
      message.success('تم الحفظ');
      await load();
    } catch { setSaving(false); }
    setSaving(false);
  };

  const act = async (path: string, ok: string) => {
    if (!closing) return;
    try {
      await api.post(`/api/v1/period-closing/closings/${closing.id}/${path}`);
      message.success(ok);
      load();
    } catch { setLoading(false); }
  };

  const remove = async () => {
    if (!closing) return;
    try {
      await api.delete(`/api/v1/period-closing/closings/${closing.id}`);
      message.success('تم حذف الإقفال');
      load();
    } catch { setLoading(false); }
  };

  const exportXlsx = async () => {
    try {
      const res = await api.get('/api/v1/period-closing/package.xlsx', {
        params: {
          as_of: iso, branch_id: branchId, blocks: meta.blocks.join(','),
          ...(advDates.length ? { advance_dates: advDates.join(',') } : {}),
        },
        responseType: 'blob', timeout: 120000,
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${meta.title} ${pkg?.branch_name || ''} ${iso}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { setLoading(false); }
  };

  const openStatement = (accountId: number) => {
    navigate(`/account-statement?account=${accountId}&from=2000-01-01&to=${iso}`);
  };
  const goto = (v: string) => confirmDiscard(() => {
    const next = new URLSearchParams(search);
    next.set('view', v);
    setSearch(next);
  });

  const viewProps: ViewProps = {
    pkg, lines, setLines, editable, params, setParams, asOf: iso, openStatement, goto,
  };

  const quarterStart = asOf.subtract(2, 'month').startOf('month').format('YYYY-MM-DD');
  const statusTag = closing
    ? (closing.status === 'final'
      ? <Tag color="green" icon={<CheckCircleOutlined />}>معتمد {closing.finalized_at ? closing.finalized_at.slice(0, 10) : ''}</Tag>
      : <Tag color="gold">مسودة</Tag>)
    : <Tag>غير محفوظ</Tag>;

  const body = useMemo(() => {
    if (!pkg) return null;
    const sec = (title: string, el: React.ReactNode) => (
      <div style={{ marginBottom: 24 }}>
        <Divider orientation="right" style={{ fontSize: 16, fontWeight: 700 }}>{title}</Divider>
        {el}
      </div>
    );
    switch (view) {
      case 'inventory': return <InventoryView {...viewProps} />;
      case 'balances': return <BalancesView {...viewProps} />;
      case 'balance-sheet': return <BalanceSheetView {...viewProps} />;
      case 'settlement': return <SettlementView {...viewProps} />;
      case 'advances': return <AdvancesView {...viewProps} dates={advDates} setDates={setAdvDates} />;
      default:
        return (
          <>
            {sec('الميزانية العمومية الإدارية', <BalanceSheetView {...viewProps} />)}
            {sec('تقييم المخزون', <InventoryView {...viewProps} />)}
            {sec('العملاء والنقدية والموردون', <BalancesView {...viewProps} />)}
            {sec('قائمة الدخل', (
              <Button icon={<LinkOutlined />}
                onClick={() => navigate(`/income-sheet?from=${quarterStart}&to=${iso}${branchId ? `&branch=${branchId}` : ''}`)}>
                قائمة الدخل من {quarterStart} إلى {iso}
              </Button>
            ))}
            {sec('تسوية المناطق', <SettlementView {...viewProps} />)}
            {sec('سلف الموظفين', <AdvancesView {...viewProps} dates={advDates} setDates={setAdvDates} />)}
          </>
        );
    }
  }, [pkg, lines, params, editable, view, advDates]);

  return (
    <Card>
      <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>{meta.title}</Typography.Title>
          {statusTag}
          {pkg?.frozen && <Tag color="purple">نسخة الاعتماد</Tag>}
        </Space>
        <Space wrap>
          {seesAll && (
            <Select style={{ width: 140 }} value={branchId} placeholder="الفرع"
              onChange={(v) => confirmDiscard(() => setBranchId(v))}
              options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          )}
          <DatePicker value={asOf} allowClear={false} format="YYYY-MM-DD"
            onChange={(d) => d && confirmDiscard(() => setAsOf(d))} />
          {!!closings.length && (
            <Select style={{ width: 170 }} placeholder="الإقفالات السابقة" value={null as any}
              onChange={(d: string) => confirmDiscard(() => setAsOf(dayjs(d)))}
              options={closings.map((c) => ({ value: c.closing_date, label: `${c.closing_date} — ${c.status === 'final' ? 'معتمد' : 'مسودة'}` }))} />
          )}
          <Button icon={<ReloadOutlined />} onClick={() => confirmDiscard(load)}>تحديث</Button>
          <Button icon={<SettingOutlined />} onClick={() => setCfgOpen(true)}>الإعدادات</Button>
          <Button icon={<PrinterOutlined />} disabled={!pkg} onClick={() => printClosing(pkg, meta.blocks, meta.title)}>طباعة</Button>
          <Button icon={<FileExcelOutlined />} disabled={!pkg} onClick={exportXlsx}>Excel</Button>
        </Space>
      </Space>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space wrap>
          {!closing && canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={createClosing} disabled={loading}>
              إنشاء إقفال {iso}
            </Button>
          )}
          {editable && (
            <>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} disabled={!dirty}>
                حفظ
              </Button>
              <Popconfirm title="هل تريد اعتماد الإقفال؟" okText="اعتماد" cancelText="إلغاء"
                onConfirm={() => (dirty ? message.warning('يجب حفظ التعديلات أولاً') : act('finalize', 'تم اعتماد الإقفال'))}>
                <Button icon={<CheckCircleOutlined />}>اعتماد</Button>
              </Popconfirm>
              <Popconfirm title="هل تريد حذف الإقفال؟" okText="حذف" cancelText="إلغاء" onConfirm={remove}>
                <Button danger icon={<DeleteOutlined />}>حذف</Button>
              </Popconfirm>
            </>
          )}
          {closing?.status === 'final' && canWrite && (
            <Popconfirm title="هل تريد إعادة الإقفال إلى مسودة؟" okText="إعادة" cancelText="إلغاء"
              onConfirm={() => act('reopen', 'تمت إعادة الإقفال إلى مسودة')}>
              <Button icon={<RollbackOutlined />}>إعادة إلى مسودة</Button>
            </Popconfirm>
          )}
          {editable && (
            <Input placeholder="ملاحظات" value={notes} style={{ width: 320 }}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
          )}
          {!editable && closing?.notes && <Typography.Text>{closing.notes}</Typography.Text>}
        </Space>
        <Spin spinning={loading}>
          {pkg ? body : <Empty description={seesAll && !branchId ? 'اختر الفرع' : 'لا توجد بيانات'} />}
        </Spin>
      </Space>
      <ConfigModal open={cfgOpen} branchId={branchId} editable={canWrite}
        onClose={() => setCfgOpen(false)} onSaved={() => { setCfgOpen(false); load(); }} />
    </Card>
  );
}
