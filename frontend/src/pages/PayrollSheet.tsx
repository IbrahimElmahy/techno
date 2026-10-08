import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, DatePicker, Empty, Input, Popover, Select, Space, Spin, Table, Tag, Tooltip, message,
} from 'antd';
import {
  AppstoreOutlined, CheckCircleOutlined, ClearOutlined, DeleteOutlined, FileExcelOutlined,
  FileTextOutlined, PrinterOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined,
  SendOutlined, TableOutlined, UnlockOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';

import { api, getViewBranch } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import ListPage, { ListStat } from '../components/ListPage';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import { useTabsOptional } from '../components/TabsContext';
import { useQueryTab } from '../components/useQueryTab';
import { useScreenShortcuts } from '../components/keyboard';
import { printDocument } from '../print/brand';
import { esc, printMoney, printPayslip } from '../print/reportSheet';
import { matchesWords, normalizeAr, searchFilter, searchRank } from '../utils/arabicSort';
import { money } from '../utils/money';

/**
 * شيت المرتبات — نفس ورقة الإكسل اللي العميل بيعمل عليها المرتبات (طلب ٢٠٢٦-١٠-٠٨).
 *
 * الورقة: جدول لكل مجموعة (البيع، الإدارية، خدمة العملاء) بأعمدتها هي، وإجمالي تحت كل جدول،
 * وفي الآخر صافي كل مجموعة والإجمالي العام. الشاشة بتعرضها بالظبط كده — الاستحقاقات، وبعدها
 * «الاجمالي»، والاستقطاعات، وبعدها «الصافي» — عشان المحاسب يقرا الورقة اللي متعوّد عليها.
 *
 * **كل خانة تتكتب فوقها.** الرقم المحسوب (من إعدادات الراتب، محرك العمولات، الحضور، السلف،
 * الجزاءات) بيظهر عادي، والمكتوب بالإيد بيظهر بخلفية ملوّنة — والماوس عليه بيقول المحسوب كان
 * كام وجه منين، وفيه «رجّع المحسوب». و«تحديث من المصادر» بيعيد المحسوب بس ومايلمسش المكتوب.
 *
 * **المراحل:** مسودة (تعديل) ← معتمد (مقفول، بيتطبع ويتمضي) ← مرحّل (قيد المرتبات في الأستاذ).
 * الترحيل زرار لوحده، والعكس بيرجّع الشهر وتجهيزه تاني بيحتفظ بكل اللي اتكتب بالإيد.
 */

interface Col {
  key: string; label: string; source: string; ref: any; kind: 'earning' | 'deduction';
  posting: string | null;
}
interface Cell { value: string; computed: string; override: string | null; note: string | null }
interface Row {
  row_id: number; employee_id: number; code: string; name: string;
  absent_days: string; absent_days_override: string | null;
  cells: Record<string, Cell>; earnings: string; deductions: string; net: string;
  no_salary: boolean; hidden_components: { name: string; amount: string }[]; notes: string | null;
}
interface Group {
  id: number; group_id: number | null; name: string; columns: Col[];
  absence_base: string[]; absence_divisor: number; rows: Row[]; totals: Record<string, string>;
}
interface RunInfo {
  id: number; document_number: string; year: number; month: number; branch_id: number;
  status: 'draft' | 'closed' | 'posted' | 'reversed'; reversal_seq: number; net: string;
  accrual_entry_id: number | null; reversal_entry_id: number | null; posted_at: string | null;
  commission_note: string | null;
}
interface Sheet {
  run: RunInfo | null; groups: Group[]; summary: { name: string; net: string }[];
  totals: Record<string, string>; unassigned: { id: number; code: string; name: string }[];
}
interface SheetListRow {
  id: number; document_number: string; year: number; month: number; branch_id: number;
  status: string; employees: number; earnings: string; total_deductions: string; net: string;
  posted_at: string | null;
}

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'مسودة', color: 'default' },
  closed: { label: 'معتمد', color: 'blue' },
  posted: { label: 'مرحّل', color: 'green' },
  reversed: { label: 'متعكس', color: 'red' },
};
const MONTHS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر',
  'اكتوبر', 'نوفمبر', 'ديسمبر'];

const n = (v: any) => Number(v || 0);
const fail = (err: any, fallback: string) => {
  const detail = err?.response?.data?.detail;
  message.error((typeof detail === 'string' ? detail : detail?.message) || fallback, 6);
};

/** الأعمدة بترتيب الورقة: الاستحقاقات، الاجمالي، الاستقطاعات، الصافي. */
function ordered(cols: Col[]) {
  return { earn: cols.filter((c) => c.kind === 'earning'), ded: cols.filter((c) => c.kind !== 'earning') };
}

/** خانة فلوس — عرض، ولما تتضغط في المسودة بتبقى خانة كتابة. */
function MoneyCell({ cell, editable, onSave, strong }: {
  cell: Cell; editable: boolean; strong?: boolean; onSave: (v: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const overridden = cell.override !== null && cell.override !== undefined;

  const commit = async (v: number | null) => {
    setEditing(false);
    if (v === null || v === undefined || Number.isNaN(v)) return;
    if (n(v) === n(cell.value)) return;
    setBusy(true);
    try { await onSave(v); } finally { setBusy(false); }
  };

  if (editing) {
    return (
      <InputNumber size="small" autoFocus min={0} style={{ width: 100 }} value={val as any}
        onChange={(v) => setVal(v === null || v === undefined ? null : Number(v))}
        onBlur={() => commit(val)}
        onPressEnter={() => commit(val)}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
    );
  }
  const info = (
    <div style={{ maxWidth: 320, fontSize: 13 }}>
      {cell.note ? <div>{cell.note}</div> : null}
      {overridden ? (
        <div style={{ marginTop: 4 }}>
          مكتوب بالإيد — المحسوب: <b>{money(cell.computed)}</b>
          {editable ? (
            <div style={{ marginTop: 4 }}>
              <Button size="small" icon={<RollbackOutlined />}
                onClick={async () => { setBusy(true); try { await onSave(null); } finally { setBusy(false); } }}>
                رجّع المحسوب
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {editable ? <div style={{ color: '#888', marginTop: 4 }}>اضغط على الخانة للكتابة فوقها</div> : null}
    </div>
  );
  return (
    <Popover content={info} mouseEnterDelay={0.4} placement="top">
      <div
        className="ps-cell"
        onClick={() => { if (editable && !busy) { setVal(n(cell.value)); setEditing(true); } }}
        style={{
          cursor: editable ? 'pointer' : 'default', padding: '1px 4px', borderRadius: 3,
          minWidth: 56, textAlign: 'left', whiteSpace: 'nowrap',
          background: overridden ? '#fff7e6' : undefined,
          outline: overridden ? '1px dashed #fa8c16' : undefined,
          fontWeight: strong ? 700 : undefined, opacity: busy ? 0.5 : 1,
          color: n(cell.value) ? undefined : '#bbb',
        }}
      >
        {n(cell.value) ? money(cell.value) : '—'}
      </div>
    </Popover>
  );
}

/** أيام الغياب — من الحضور، أو مكتوبة بالإيد. */
function DaysCell({ row, editable, onSave }: {
  row: Row; editable: boolean; onSave: (v: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<number | null>(null);
  const overridden = row.absent_days_override !== null;
  const days = overridden ? row.absent_days_override : row.absent_days;
  if (editing) {
    const done = async (v: number | null) => {
      setEditing(false);
      if (v === null || n(v) === n(days)) return;
      await onSave(v);
    };
    return (
      <InputNumber size="small" autoFocus min={0} max={31} style={{ width: 64 }} value={val as any}
        onChange={(v) => setVal(v === null || v === undefined ? null : Number(v))}
        onBlur={() => done(val)} onPressEnter={() => done(val)}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
    );
  }
  return (
    <Popover
      mouseEnterDelay={0.4}
      content={(
        <div style={{ fontSize: 13 }}>
          <div>من الحضور: <b>{n(row.absent_days)}</b> يوم</div>
          {overridden ? (
            <div>مكتوبة بالإيد: <b>{n(row.absent_days_override)}</b>
              {editable ? (
                <Button size="small" style={{ marginInlineStart: 6 }} onClick={() => onSave(null)}>
                  رجّع الحضور
                </Button>
              ) : null}
            </div>
          ) : null}
          {editable ? (
            <div style={{ color: '#888' }}>
              اضغط لكتابة عدد الأيام — والعمولة بتتخصم بيها بعد «تحديث من المصادر»
            </div>
          ) : null}
        </div>
      )}
    >
      <span
        onClick={() => { if (editable) { setVal(n(days)); setEditing(true); } }}
        style={{
          cursor: editable ? 'pointer' : 'default', fontSize: 12, padding: '0 4px', borderRadius: 3,
          color: n(days) ? '#cf1322' : '#aaa', background: overridden ? '#fff7e6' : undefined,
          whiteSpace: 'nowrap',
        }}
      >
        {n(days)} يوم
      </span>
    </Popover>
  );
}

export default function PayrollSheet() {
  const { user } = useAuth();
  const tabs = useTabsOptional();
  const seesAll = !user?.branch_id || ['system_admin', 'owner'].includes(String(user?.role));
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [branchId, setBranchId] = useState<number | null>(
    seesAll ? (getViewBranch() ?? null) : (user?.branch_id ?? null));
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [data, setData] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useQueryTab('sheet');
  const [history, setHistory] = useState<SheetListRow[]>([]);
  const [histYear, setHistYear] = useState<number | null>(null);
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  useEffect(() => {
    api.get('/api/v1/branches').then((r) => {
      const list = (r.data || []).filter((b: any) => b.active !== false);
      setBranches(list);
      if (seesAll && branchId === null && list.length) setBranchId(list[0].id);
    }).catch(() => {});
  }, []);

  const branchName = (id: number | null | undefined) => branches.find((b) => b.id === id)?.name || '';

  const load = async (b = branchId, m = month) => {
    if (!b) return;
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/payroll-sheet/sheet',
        { params: { branch_id: b, year: m.year(), month: m.month() + 1 } });
      setData(res.data);
    } catch (err: any) { fail(err, 'تعذر تحميل الشيت'); setData(null); } finally { setLoading(false); }
  };

  const loadHistory = async (b = branchId, y = histYear) => {
    try {
      const res = await api.get('/api/v1/hr/payroll-sheet/sheets',
        { params: { branch_id: b ?? undefined, year: y ?? undefined } });
      setHistory(res.data || []);
    } catch (err: any) { fail(err, 'تعذر تحميل الشهور'); }
  };

  useEffect(() => { load(); }, [branchId, month]);
  useEffect(() => { if (tab === 'months') loadHistory(); }, [tab, branchId, histYear]);

  const run = data?.run || null;
  const editable = run?.status === 'draft';

  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setActing(key);
    try {
      const res = await fn();
      if (res?.data?.groups) setData(res.data);
      else await load();
      message.success(ok);
    } catch (err: any) { fail(err, 'تعذر التنفيذ'); } finally { setActing(null); }
  };

  const prepare = () => act('prepare', () => api.post('/api/v1/hr/payroll-sheet/sheet/prepare', {
    branch_id: branchId, year: month.year(), month: month.month() + 1,
  }), run && run.status === 'draft' ? 'اتحدّث من المصادر — المكتوب بالإيد زي ما هو' : 'الشهر اتجهّز');

  const runAction = (path: string, ok: string) => act(path,
    () => api.post(`/api/v1/hr/payroll-sheet/sheet/${run!.id}/${path}`), ok);

  const removeDraft = () => act('delete', async () => {
    await api.delete(`/api/v1/hr/payroll-sheet/sheet/${run!.id}`);
    return null;
  }, 'المسودة اتمسحت');

  /** الخانة اللي اتعدّلت بترجع بصفها وإجماليات مجموعتها والشيت — من غير تحميل الكل. */
  const applyRow = (res: any) => {
    setData((prev) => {
      if (!prev || !res?.row) return prev;
      return {
        ...prev,
        run: res.run ?? prev.run,
        totals: res.totals ?? prev.totals,
        summary: res.summary ?? prev.summary,
        groups: prev.groups.map((g) => (g.id !== res.group_id ? g : {
          ...g,
          totals: res.group_totals,
          rows: g.rows.map((r) => (r.employee_id === res.row.employee_id ? res.row : r)),
        })),
      };
    });
  };

  const saveCell = async (row: Row, col: Col, v: number | null) => {
    try {
      const res = await api.put(`/api/v1/hr/payroll-sheet/sheet/${run!.id}/cell`,
        { employee_id: row.employee_id, col_key: col.key, value: v === null ? null : String(v) });
      applyRow(res.data);
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const saveDays = async (row: Row, v: number | null) => {
    try {
      const res = await api.put(`/api/v1/hr/payroll-sheet/sheet/${run!.id}/absence`,
        { employee_id: row.employee_id, days: v === null ? null : String(v) });
      applyRow(res.data);
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const payslip = async (row: Row) => {
    try {
      const res = await api.get(`/api/v1/hr/payroll/runs/${run!.id}/payslip/${row.employee_id}`);
      printPayslip({ ...res.data, employee_name: row.name });
    } catch (err: any) { fail(err, 'تعذر طباعة القسيمة'); }
  };

  const matches = (r: Row) => {
    const q = query.trim();
    if (!q) return true;
    return matchesWords(normalizeAr(`${r.code} ${r.name}`), normalizeAr(q));
  };

  // ------------------------------------------------------------ أعمدة جدول المجموعة

  const columnsFor = (g: Group): ColumnsType<Row> => {
    const { earn, ded } = ordered(g.columns);
    const cellCol = (c: Col) => ({
      title: c.label, key: c.key, align: 'left' as const, width: 92,
      render: (_: any, r: Row) => {
        const cell = r.cells[c.key] || { value: '0', computed: '0', override: null, note: null };
        const money = (
          <MoneyCell cell={cell} editable={editable} onSave={(v) => saveCell(r, c, v)} />
        );
        if (c.source !== 'absence') return money;
        return (
          <Space size={2} direction="vertical" style={{ alignItems: 'flex-end' }}>
            {money}
            <DaysCell row={r} editable={editable} onSave={(v) => saveDays(r, v)} />
          </Space>
        );
      },
    });
    return [
      { title: 'م', key: 'idx', width: 40, fixed: 'right',
        render: (_: any, __: Row, i: number) => i + 1 },
      { title: 'الاسم', key: 'name', width: 170, fixed: 'right',
        render: (_: any, r: Row) => (
          <Space size={4} wrap>
            <b>{r.name}</b>
            {r.no_salary ? (
              <Tooltip title="مالوش إعدادات راتب — حطّها من «رواتب الموظفين»">
                <Tag color="orange" style={{ marginInlineEnd: 0 }}>بدون إعدادات</Tag>
              </Tooltip>
            ) : null}
            {r.hidden_components.length ? (
              <Tooltip title={`بنود في إعدادات راتبه مالهاش عمود في المجموعة دي: ${r.hidden_components
                .map((h) => `${h.name} ${money(h.amount)}`).join('، ')}`}>
                <WarningOutlined style={{ color: '#fa8c16' }} />
              </Tooltip>
            ) : null}
          </Space>
        ) },
      ...earn.map(cellCol),
      { title: 'الاجمالي', key: '__earn', align: 'left', width: 110,
        render: (_: any, r: Row) => <b>{money(r.earnings)}</b> },
      ...ded.map(cellCol),
      { title: 'الصافي', key: '__net', align: 'left', width: 120,
        render: (_: any, r: Row) => (
          <b style={{ color: n(r.net) < 0 ? '#cf1322' : '#237804' }}>{money(r.net)}</b>
        ) },
      ...(run && run.status !== 'draft' && run.status !== 'reversed' ? [{
        title: '', key: '__slip', width: 44,
        render: (_: any, r: Row) => (
          <Button type="text" size="small" icon={<FileTextOutlined />} title="قسيمة الراتب"
            onClick={() => payslip(r)} />
        ),
      }] : []),
    ];
  };

  const groupSummary = (g: Group) => {
    const { earn, ded } = ordered(g.columns);
    const cells = [
      <Table.Summary.Cell key="i" index={0} />,
      <Table.Summary.Cell key="n" index={1}><b>الاجمالى</b></Table.Summary.Cell>,
      ...earn.map((c, i) => (
        <Table.Summary.Cell key={c.key} index={2 + i} align="left"><b>{money(g.totals[c.key])}</b></Table.Summary.Cell>
      )),
      <Table.Summary.Cell key="e" index={2 + earn.length} align="left"><b>{money(g.totals.earnings)}</b></Table.Summary.Cell>,
      ...ded.map((c, i) => (
        <Table.Summary.Cell key={c.key} index={3 + earn.length + i} align="left">
          <b style={{ color: '#cf1322' }}>{money(g.totals[c.key])}</b>
        </Table.Summary.Cell>
      )),
      <Table.Summary.Cell key="t" index={3 + earn.length + ded.length} align="left">
        <b style={{ color: '#237804' }}>{money(g.totals.net)}</b>
      </Table.Summary.Cell>,
    ];
    if (run && run.status !== 'draft' && run.status !== 'reversed') {
      cells.push(<Table.Summary.Cell key="s" index={4 + earn.length + ded.length} />);
    }
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#f0f5f0' }}>{cells}</Table.Summary.Row>
      </Table.Summary>
    );
  };

  // ------------------------------------------------------------ الطباعة (A4 بالعرض زي الإكسل)

  const print = () => {
    if (!data || !run) return;
    const title = `مرتبات شهر ${MONTHS[run.month - 1]} ${run.year}`;
    const parts: string[] = ['<style>@page { size: A4 landscape; margin: 7mm; } '
      + '.ps-t{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px} '
      + '.ps-t th,.ps-t td{border:1px solid #000;padding:2px 4px;text-align:center} '
      + '.ps-t td.num{text-align:left;white-space:nowrap} .ps-t tfoot td{font-weight:700} '
      + '.ps-g{font-weight:800;font-size:13px;margin:8px 0 3px}</style>'];
    for (const g of data.groups) {
      const { earn, ded } = ordered(g.columns);
      const head = `<tr><th rowspan="2">م</th><th rowspan="2">الاسم</th>`
        + `<th colspan="${earn.length + 1}">الاجور</th>`
        + (ded.length ? `<th colspan="${ded.length}">الاستقطاعات</th>` : '')
        + '<th rowspan="2">الصافي</th></tr><tr>'
        + earn.map((c) => `<th>${esc(c.label)}</th>`).join('') + '<th>الاجمالي</th>'
        + ded.map((c) => `<th>${esc(c.label)}</th>`).join('') + '</tr>';
      const body = g.rows.map((r, i) => `<tr><td>${i + 1}</td><td style="text-align:start">${esc(r.name)}</td>`
        + earn.map((c) => `<td class="num">${n(r.cells[c.key]?.value) ? printMoney(r.cells[c.key].value) : ''}</td>`).join('')
        + `<td class="num"><b>${printMoney(r.earnings)}</b></td>`
        + ded.map((c) => `<td class="num">${n(r.cells[c.key]?.value) ? printMoney(r.cells[c.key].value) : ''}</td>`).join('')
        + `<td class="num"><b>${printMoney(r.net)}</b></td></tr>`).join('');
      const foot = '<tr><td></td><td>الاجمالى</td>'
        + earn.map((c) => `<td class="num">${printMoney(g.totals[c.key])}</td>`).join('')
        + `<td class="num">${printMoney(g.totals.earnings)}</td>`
        + ded.map((c) => `<td class="num">${printMoney(g.totals[c.key])}</td>`).join('')
        + `<td class="num">${printMoney(g.totals.net)}</td></tr>`;
      parts.push(`<div class="ps-g">${esc(g.name)}</div><table class="ps-t"><thead>${head}</thead>`
        + `<tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`);
    }
    parts.push('<table class="ps-t" style="width:auto;min-width:260px">'
      + data.summary.map((s) => `<tr><td style="text-align:start">م ${esc(s.name)}</td><td class="num">${printMoney(s.net)}</td></tr>`).join('')
      + `<tr><td style="text-align:start"><b>الاجمالى</b></td><td class="num"><b>${printMoney(data.totals.net)}</b></td></tr></table>`);
    parts.push('<div style="display:flex;justify-content:space-around;margin-top:24px;font-size:12px">'
      + '<span>المحاسب: ..................</span><span>المراجع: ..................</span>'
      + '<span>المدير: ..................</span></div>');
    printDocument({
      title, number: run.document_number,
      fileName: `${title} — ${branchName(run.branch_id)}`,
      meta: [['الفرع', branchName(run.branch_id)], ['الحالة', STATUS[run.status]?.label || run.status]],
    }, parts.join(''));
  };

  const exportXlsx = async () => {
    if (!run) return;
    try {
      const res = await api.get(`/api/v1/hr/payroll-sheet/sheet/${run.id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `مرتبات ${MONTHS[run.month - 1]} ${run.year} — ${branchName(run.branch_id)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) { fail(err, 'تعذر التصدير'); }
  };

  const openGroups = (tabKey?: string) => {
    const path = `/payroll-groups${tabKey ? `?tab=${tabKey}` : ''}`;
    if (tabs) tabs.openTab(path); else window.location.assign(path);
  };

  const employees = data?.groups.reduce((t, g) => t + g.rows.length, 0) ?? 0;
  const overrides = useMemo(() => (data?.groups || []).reduce((t, g) => t + g.rows.reduce(
    (s, r) => s + Object.values(r.cells).filter((c) => c.override !== null).length
      + (r.absent_days_override !== null ? 1 : 0), 0), 0), [data]);

  // ------------------------------------------------------------ الشاشة

  const actions = (
    <>
      {tab === 'sheet' && (!run || run.status === 'draft' || run.status === 'reversed') ? (
        <Button type="primary" icon={<ReloadOutlined />} loading={acting === 'prepare'}
          disabled={!branchId} onClick={prepare}>
          {run && run.status === 'draft' ? 'تحديث من المصادر' : 'تجهيز الشهر'}
        </Button>
      ) : null}
      {tab === 'sheet' && run?.status === 'draft' ? (
        <Button icon={<CheckCircleOutlined />} loading={acting === 'close'}
          onClick={() => runAction('close', 'الشيت اتعمد')}>اعتماد</Button>
      ) : null}
      {tab === 'sheet' && run?.status === 'closed' ? (<>
        <Button icon={<UnlockOutlined />} loading={acting === 'reopen'}
          onClick={() => runAction('reopen', 'رجع مسودة')}>إلغاء الاعتماد</Button>
        <Popconfirm onConfirm={() => runAction('post', 'قيد المرتبات اترحّل')}>
          <Button type="primary" icon={<SendOutlined />} loading={acting === 'post'}>ترحيل</Button>
        </Popconfirm>
      </>) : null}
      {tab === 'sheet' && run?.status === 'posted' ? (
        <Popconfirm onConfirm={() => runAction('reverse', 'الترحيل اتعكس — الشهر رجع مفتوح')}>
          <Button danger icon={<RollbackOutlined />} loading={acting === 'reverse'}>عكس الترحيل</Button>
        </Popconfirm>
      ) : null}
      {tab === 'sheet' && run ? (<>
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<FileExcelOutlined />} onClick={exportXlsx}>إكسل</Button>
      </>) : null}
      {tab === 'sheet' && run?.status === 'draft' ? (
        <Popconfirm onConfirm={removeDraft}>
          <Button danger icon={<DeleteOutlined />} loading={acting === 'delete'}
            title="مسح المسودة — الشهر يرجع من غير شيت">مسح</Button>
        </Popconfirm>
      ) : null}
      <Button icon={<AppstoreOutlined />} onClick={() => openGroups()}>مجموعات المرتبات</Button>
    </>
  );

  const filters = tab === 'sheet' ? (<>
    {seesAll ? (
      <Select placeholder="الفرع" style={{ minWidth: 150 }} value={branchId ?? undefined}
        onChange={(v) => setBranchId(v)}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        showSearch filterOption={searchFilter} filterSort={searchRank} />
    ) : null}
    <DatePicker picker="month" allowClear={false} value={month} format="MM/YYYY"
      onChange={(v) => v && setMonth(v.startOf('month'))} />
    <Input className="sl-f-search" allowClear ref={searchRef} value={query}
      placeholder="بحث بالاسم أو الكود" prefix={<SearchOutlined />}
      onChange={(e) => setQuery(e.target.value)} />
    <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={() => setQuery('')}>مسح</Button>
  </>) : (<>
    {seesAll ? (
      <Select allowClear placeholder="كل الفروع" style={{ minWidth: 150 }} value={branchId ?? undefined}
        onChange={(v) => setBranchId(v ?? null)}
        options={branches.map((b) => ({ value: b.id, label: b.name }))} />
    ) : null}
    <DatePicker picker="year" placeholder="السنة" value={histYear ? dayjs(`${histYear}-01-01`) : null}
      onChange={(v) => setHistYear(v ? v.year() : null)} />
  </>);

  return (
    <ListPage
      icon={<TableOutlined />}
      title="شيت المرتبات"
      muted={run ? `${MONTHS[run.month - 1]} ${run.year} — ${branchName(run.branch_id)}` : undefined}
      subtitle="نفس ورقة الإكسل: مجموعة تحت مجموعة، وأي خانة تتكتب فوقها"
      tabs={[{ key: 'sheet', label: 'الشيت' }, { key: 'months', label: 'الشهور', count: tab === 'months' ? history.length : null }]}
      activeTab={tab as any}
      onTabChange={(k) => setTab(k)}
      actions={actions}
      filters={filters}
      summary={tab === 'sheet' && run ? (<>
        <ListStat label="المستند" value={<Space size={4}>{run.document_number}
          <Tag color={STATUS[run.status]?.color}>{STATUS[run.status]?.label}</Tag></Space>} />
        <ListStat label="الموظفين" value={employees} />
        <ListStat label="الاستحقاقات" value={money(data?.totals.earnings)} tone="pos" />
        <ListStat label="الاستقطاعات" value={money(data?.totals.deductions)} tone="neg" />
        <ListStat label="الصافي" value={money(data?.totals.net)} tone="strong" />
        <ListStat label="خانات مكتوبة بالإيد" value={overrides} tone={overrides ? 'warn' : undefined} />
      </>) : undefined}
    >
      {tab === 'months' ? (
        <Table<SheetListRow>
          className="sl-table" size="small" rowKey="id" dataSource={history}
          pagination={false} scroll={{ x: 'max-content' }}
          onRow={(r) => ({
            onClick: () => {
              if (seesAll) setBranchId(r.branch_id);
              setMonth(dayjs(`${r.year}-${String(r.month).padStart(2, '0')}-01`));
              setTab('sheet');
            },
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: 'مافيش شهور متجهّزة' }}
          columns={[
            { title: 'المستند', dataIndex: 'document_number' },
            { title: 'الشهر', key: 'm', render: (_: any, r) => `${MONTHS[r.month - 1]} ${r.year}` },
            { title: 'الفرع', key: 'b', render: (_: any, r) => branchName(r.branch_id) },
            { title: 'الحالة', dataIndex: 'status',
              render: (v: string) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.label || v}</Tag> },
            { title: 'الموظفين', dataIndex: 'employees' },
            { title: 'الاستحقاقات', dataIndex: 'earnings', align: 'left', render: (v) => money(v) },
            { title: 'الاستقطاعات', dataIndex: 'total_deductions', align: 'left', render: (v) => money(v) },
            { title: 'الصافي', dataIndex: 'net', align: 'left', render: (v) => <b>{money(v)}</b> },
          ]}
        />
      ) : (
        <Spin spinning={loading}>
          {!branchId ? (
            <Empty description="اختار الفرع" />
          ) : !run ? (
            <Empty description={`مرتبات ${MONTHS[month.month()]} ${month.year()} لسه ماتجهّزتش`}>
              <Space direction="vertical">
                <span style={{ color: '#888' }}>
                  «تجهيز الشهر» بيعمل الشيت من مجموعات المرتبات وإعدادات راتب كل موظف، والعمولات
                  والغياب والسلف والجزاءات بتتملى لوحدها.
                </span>
                <Space>
                  <Button type="primary" icon={<ReloadOutlined />} loading={acting === 'prepare'}
                    onClick={prepare}>تجهيز الشهر</Button>
                  <Button onClick={() => openGroups()}>مجموعات المرتبات</Button>
                </Space>
              </Space>
            </Empty>
          ) : (
            <>
              {run.status === 'reversed' ? (
                <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                  message={`المستند ${run.document_number} اتعكس`}
                  description="«تجهيز الشهر» بيعمل شيت جديد للشهر وبيحتفظ بكل الخانات اللي اتكتبت بالإيد." />
              ) : null}
              {run.commission_note && run.status === 'draft' ? (
                <Alert type="info" showIcon style={{ marginBottom: 8 }}
                  message="أعمدة العمولة يدوي الشهر ده" description={run.commission_note} />
              ) : null}
              {data!.unassigned.length && run.status === 'draft' ? (
                <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                  message={`${data!.unassigned.length} موظف في الفرع مش في أي مجموعة — مش في الشيت`}
                  description={data!.unassigned.slice(0, 12).map((e) => e.name).join('، ')
                    + (data!.unassigned.length > 12 ? '، …' : '')}
                  action={<Button size="small" onClick={() => openGroups('members')}>توزيع الموظفين</Button>} />
              ) : null}
              {data!.groups.map((g) => {
                const rows = g.rows.filter(matches);
                return (
                  <div key={g.id} style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, margin: '6px 2px' }}>
                      {g.name} <span style={{ color: '#888', fontWeight: 400, fontSize: 13 }}>
                        ({g.rows.length} موظف — صافي {money(g.totals.net)})
                      </span>
                    </div>
                    <Table<Row>
                      className="sl-table" size="small" rowKey="employee_id" bordered
                      dataSource={rows} pagination={false} sticky
                      scroll={{ x: 'max-content' }}
                      columns={columnsFor(g)}
                      summary={() => groupSummary(g)}
                      locale={{ emptyText: query ? 'مافيش نتايج' : 'مافيش موظفين في المجموعة دي' }}
                    />
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 8 }}>
                <table className="ps-summary" style={{ borderCollapse: 'collapse', minWidth: 300 }}>
                  <tbody>
                    {data!.summary.map((s) => (
                      <tr key={s.name}>
                        <td style={{ border: '1px solid #d9d9d9', padding: '4px 10px' }}>م {s.name}</td>
                        <td style={{ border: '1px solid #d9d9d9', padding: '4px 10px', textAlign: 'left' }}>{money(s.net)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f0f5f0' }}>
                      <td style={{ border: '1px solid #d9d9d9', padding: '4px 10px' }}><b>الاجمالى</b></td>
                      <td style={{ border: '1px solid #d9d9d9', padding: '4px 10px', textAlign: 'left' }}>
                        <b>{money(data!.totals.net)}</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Spin>
      )}
    </ListPage>
  );
}
