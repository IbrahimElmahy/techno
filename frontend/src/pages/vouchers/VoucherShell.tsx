/**
 * إطار بوباب السند — قبض / صرف / مصروف (٢٠٢٦-١٠-٠٧).
 *
 * التلات بوبابات كانوا عمود واحد من خانات بعرض ثابت ورا بعض، وزرار «تسجيل السند» مرتين
 * (في الفورم وفي الفوتر). اللي اتاخد من التانيين:
 *
 *   من a5:   شاشة لكل نوع، نفس الخانات (التاريخ · الخزينة · الطرف · المبلغ · البيان ·
 *            رقم المستند)، Enter للخانة اللي بعدها، والطباعة على طول بعد الحفظ.
 *   من Odoo: ترويسة ملوّنة بتقول النوع (داخل/خارج)، رصيد الطرف تحت اختياره، رصيد الخزنة
 *            تحتها وتحذير لو الصرف أكبر منه، معاينة القيد قبل الحفظ، والخانات الثانوية في
 *            «تفاصيل إضافية» مقفولة، و«حفظ» / «حفظ وطباعة» / «حفظ وجديد».
 *
 * **الحفظ نفسه مش هنا.** كل بوباب بيبني الـpayload بتاعه (`buildPayload`) زي ما كان، والإطار
 * بيندَه `submit` اللي الشاشة الأم إدّتهوله — فالعقد مع السيرفر مااتغيّرش حرف.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Col, Collapse, DatePicker, Form, Input, Row, Space, Tag, theme,
} from 'antd';
import type { FormInstance } from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, PlusOutlined, PrinterOutlined, SaveOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { InputNumber, toLatinDigits } from '../../components/NumberInput';
import { TabModal } from '../../components/TabModal';
import { TreasuryField } from '../../components/VoucherFields';
import { printVoucher, VoucherDoc } from '../../components/VoucherDocument';
import { amountToArabicWords } from '../../utils/arabicNumberWords';
import { api } from '../../api/client';
import { money } from '../../utils/money';
import { loadPostableAccounts } from './PartyKind';

/**
 * توقيع الحفظ اللي الشاشة الأم بتدّيه — نفس القديم، وزيادة عليه:
 *  - بيرجّع السند المحفوظ (أو `null` لو فشل) عشان «حفظ وطباعة».
 *  - `keepOpen` لـ«حفظ وجديد»: الفورم بيتفضّى والبوباب يفضل مفتوح.
 * اللي بيرجّع `void` لسه بيشتغل — بس من غير طباعة ولا «جديد».
 */
export type VoucherSubmit = (
  url: string, values: any, form: FormInstance, ok: string, opts?: { keepOpen?: boolean },
) => void | Promise<any>;

export type ShellKind = 'receipt' | 'payment' | 'expense';
type SaveMode = 'save' | 'print' | 'new';

/** الطرف التاني في القيد — «العميل — أحمد»، «حساب المصروف — بنزين». */
export interface Counterpart { label: string; name?: string | null }

/** رصيد مين يتعرض تحت الطرف. `known` = رصيد جاي مع القايمة (الموردين) فمش محتاج طلب. */
export interface BalanceTarget {
  side: 'customer' | 'supplier' | 'account';
  id?: number | null;
  known?: string | number | null;
}

const META: Record<ShellKind, {
  title: string; sub: string; color: 'green' | 'volcano' | 'orange'; icon: React.ReactNode;
}> = {
  receipt: {
    title: 'سند قبض', sub: 'استلام نقدية — الفلوس داخلة الخزينة',
    color: 'green', icon: <ArrowDownOutlined />,
  },
  payment: {
    title: 'سند صرف', sub: 'صرف نقدية — الفلوس خارجة من الخزينة',
    color: 'volcano', icon: <ArrowUpOutlined />,
  },
  expense: {
    title: 'سند مصروف', sub: 'مصروف من الخزينة على حساب مصروف',
    color: 'orange', icon: <ShoppingOutlined />,
  },
};

/** اللي خانات الطرف محتاجاه من الإطار عشان «بعد السند». */
const ShellCtx = createContext<{ kind: ShellKind; amount: number; editing: boolean }>({
  kind: 'receipt', amount: 0, editing: false,
});

// ── المبلغ: فاصلة آلاف وأرقام إنجليزي (زي a5 والورقة المطبوعة) ──
const withThousands = (v: any): string => {
  if (v === undefined || v === null || v === '') return '';
  const [i, d] = String(v).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d !== undefined ? `.${d}` : '');
};
const parseThousands = (v?: string): any => toLatinDigits(String(v ?? '')).replace(/,/g, '');

/** «عليه / له» من رصيد موقّع بجانب الحساب الطبيعي. */
function describe(netDebit: number, party: boolean): string {
  const abs = money(Math.abs(netDebit));
  if (Math.abs(netDebit) < 0.005) return party ? 'صفر — مفيش رصيد' : money(0);
  if (party) return netDebit > 0 ? `عليه ${abs}` : `له ${abs}`;
  return netDebit > 0 ? `${abs} مدين` : `${abs} دائن`;
}

/** رصيد الطرف — مدين صافي (موجب = عليه). */
function usePartyNetDebit(t?: BalanceTarget): number | null {
  const [net, setNet] = useState<number | null>(null);
  const side = t?.side;
  const id = t?.id;
  const known = t?.known;
  useEffect(() => {
    setNet(null);
    if (!side || !id) return;
    let alive = true;
    const done = (v: number) => { if (alive) setNet(v); };
    if (side === 'customer') {
      // العميل حساب ذمم مدين — موجب = عليه. الإجمالي على كل خطوطه (أبيض + بولي).
      api.get(`/api/v1/customers/${id}/accounts`)
        .then((r) => done(Number(r.data?.total_balance || 0))).catch(() => {});
    } else if (side === 'supplier') {
      // المورد دائن — موجب = له، فبيتقلب.
      if (known !== undefined && known !== null) done(-Number(known));
      else {
        api.get(`/api/v1/suppliers/${id}/account`)
          .then((r) => done(-Number(r.data?.balance || 0))).catch(() => {});
      }
    } else {
      loadPostableAccounts().then((list) => {
        const a = list.find((x: any) => x.id === id);
        if (a) done((a.normal_side === 'credit' ? -1 : 1) * Number(a.balance || 0));
      });
    }
    return () => { alive = false; };
  }, [side, id, known]);
  return net;
}

/**
 * رصيد الطرف تحت اختياره — «عليه ٥٬٠٠٠ ← بعد السند: عليه ٣٬٥٠٠».
 *
 * بيتحط في `extra` بتاع خانة الطرف. السؤال اللي في دماغ اللي بيكتب سند قبض هو «عليه كام»،
 * وكان لازم يفتح كشف الحساب في شاشة تانية عشان يعرف.
 */
export function PartyBalance({ target }: { target?: BalanceTarget }) {
  const { kind, amount, editing } = useContext(ShellCtx);
  const { token } = theme.useToken();
  const net = usePartyNetDebit(target);
  if (!target?.id) return null;
  if (net === null) return <span style={{ color: token.colorTextTertiary }}>جاري جلب الرصيد…</span>;
  const party = target.side !== 'account';
  // القبض بيدخّل الطرف دائن (الصافي المدين يقل)، والصرف مدين (يزيد).
  const after = net + (kind === 'receipt' ? -amount : amount);
  return (
    <span className="vs-hint">
      الرصيد الحالي: <b style={{ color: token.colorText }}>{describe(net, party)}</b>
      {/* في التعديل الرصيد شايل السند القديم — «بعد» هيبقى غلط فمش بيتعرض. */}
      {amount > 0 && !editing && (
        <> &nbsp;←&nbsp; بعد السند: <b style={{ color: token.colorText }}>{describe(after, party)}</b></>
      )}
    </span>
  );
}

/** المعاينة: سطرين — مدين ودائن — زي القيد اللي هيتسجّل بالظبط. */
function JournalPreview({
  kind, amount, treasuryName, counterpart, note,
}: {
  kind: ShellKind; amount: number; treasuryName?: string | null;
  counterpart: Counterpart; note?: React.ReactNode;
}) {
  const { token } = theme.useToken();
  const treasury = { label: 'الخزينة', name: treasuryName };
  const [dr, cr] = kind === 'receipt' ? [treasury, counterpart] : [counterpart, treasury];
  const amt = amount > 0 ? money(amount) : '—';
  const cell: React.CSSProperties = {
    padding: '6px 10px', borderTop: `1px solid ${token.colorBorderSecondary}`, fontSize: 14,
  };
  const name = (l: Counterpart) => (
    <>
      <span style={{ color: token.colorTextSecondary }}>{l.label}</span>
      {' — '}
      {l.name
        ? <b>{l.name}</b>
        : <span style={{ color: token.colorTextQuaternary }}>لسه مااتختارش</span>}
    </>
  );
  const rows = [
    { dir: 'مدين', color: 'blue', line: dr, debit: amt, credit: '' },
    { dir: 'دائن', color: 'purple', line: cr, debit: '', credit: amt },
  ];
  return (
    <div style={{
      marginTop: 14, border: `1px dashed ${token.colorBorder}`, borderRadius: token.borderRadiusLG,
      background: token.colorFillAlter, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 8, padding: '8px 10px', flexWrap: 'wrap',
      }}>
        <b>القيد اللي هيتسجّل</b>
        <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>
          {note ?? 'معاينة — بيتسجّل مع الحفظ'}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 380 }}>
          <thead>
            <tr style={{ color: token.colorTextSecondary, fontSize: 13 }}>
              <th style={{ ...cell, textAlign: 'start', width: 70 }} />
              <th style={{ ...cell, textAlign: 'start' }}>الحساب</th>
              <th style={{ ...cell, textAlign: 'end', width: 120 }}>مدين</th>
              <th style={{ ...cell, textAlign: 'end', width: 120 }}>دائن</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dir}>
                <td style={cell}><Tag color={r.color} style={{ marginInlineEnd: 0 }}>{r.dir}</Tag></td>
                <td style={cell}>{name(r.line)}</td>
                <td style={{ ...cell, textAlign: 'end', fontWeight: 700 }}>{r.debit}</td>
                <td style={{ ...cell, textAlign: 'end', fontWeight: 700 }}>{r.credit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** الخانات اللي Enter بيمشي عليها جوّه جسم البوباب — بالترتيب اللي العين بتقرا بيه. */
function fieldsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'input:not([type=hidden]):not([disabled]), textarea:not([disabled])',
  )]
    .filter((f) => !['radio', 'checkbox'].includes((f as HTMLInputElement).type))
    .filter((f) => !f.closest('.ant-segmented'))
    .filter((f) => !f.hasAttribute('readonly') || f.closest('.ant-select') !== null)
    // جوّه «تفاصيل إضافية» وهي مقفولة = مش مكان ينزل فيه.
    .filter((f) => ((f.closest('.ant-select') as HTMLElement | null) ?? f).offsetParent !== null);
}

export default function VoucherShell({
  kind, open, onCancel, editing = false, posting, form, submit, url, okMsg, buildPayload,
  party, counterpart, treasuries, treasuryOptional = false, treasuryPlaceholder,
  details, detailsLabel, journalNote, methodOptions = [], onAfterNew,
}: {
  kind: ShellKind;
  open: boolean;
  onCancel: () => void;
  editing?: boolean;
  posting: boolean;
  form: FormInstance;
  submit: VoucherSubmit;
  /** مسار الـPOST — `/api/v1/vouchers/receipts` … */
  url: string;
  okMsg: string;
  /** قيم الفورم ← الـpayload. `null` = اتمنع (البوباب بيقول السبب بنفسه). */
  buildPayload: (values: any) => any | null;
  /** قسم الطرف — نوعه وخانته ورصيده (أو حساب المصروف). */
  party: React.ReactNode;
  counterpart: Counterpart;
  treasuries: any[];
  treasuryOptional?: boolean;
  treasuryPlaceholder?: string;
  /** خانات «تفاصيل إضافية» — كل عنصر خانة، والإطار بيرصّهم عمودين. */
  details: React.ReactNode[];
  detailsLabel?: string;
  journalNote?: React.ReactNode;
  /** لاسم طريقة الدفع على الورقة المطبوعة. */
  methodOptions?: { value: string; label: string }[];
  /** بعد «حفظ وجديد» — البوباب بيصفّر حالته الخاصة (الخط المختار مثلاً). */
  onAfterNew?: () => void;
}) {
  const { token } = theme.useToken();
  const meta = META[kind];
  const c6 = (token as any)[`${meta.color}6`] as string;
  const c1 = (token as any)[`${meta.color}1`] as string;

  const wrapRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<SaveMode | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // في التعديل التفاصيل مفتوحة — اللي بيعدّل محتاج يشوف المرجع وطريقة الدفع اللي اتكتبوا.
  useEffect(() => { if (open) setDetailsOpen(editing); }, [open]);

  const amount = Number(Form.useWatch('amount', form) || 0);
  const treasuryId = Form.useWatch('treasury_id', form);
  const treasury = treasuries.find((t) => t.id === treasuryId);
  const treasuryName = treasury?.name ?? (treasuryOptional && !treasuryId ? 'عهدة المندوب' : null);

  // ── رصيد الخزنة وبعد السند ──
  const tBal = Number(treasury?.balance || 0);
  const outgoing = kind !== 'receipt';
  const tAfter = tBal + (outgoing ? -amount : amount);
  const overdraw = outgoing && !editing && !!treasury && amount > 0 && amount > tBal;
  const treasuryExtra = treasury ? (
    <div>
      <span className="vs-hint">
        رصيدها الحالي: <b style={{ color: token.colorText }}>{money(tBal)}</b>
        {amount > 0 && !editing && (
          <> &nbsp;←&nbsp; بعد السند: <b style={{ color: tAfter < 0 ? token.colorError : token.colorText }}>
            {money(tAfter)}</b></>
        )}
      </span>
      {overdraw && (
        <Alert type="warning" showIcon style={{ marginTop: 6, padding: '4px 10px' }}
          message={`المبلغ أكبر من اللي في الخزينة (${money(tBal)}) — رصيدها هيطلع بالسالب`} />
      )}
    </div>
  ) : treasuryOptional ? 'فاضي = السند يفضل في عهدة المندوب' : undefined;

  // ── الطباعة من رد السيرفر، والأسماء من اللي كان على الشاشة لحظة الحفظ ──
  const docOf = (res: any, payload: any, cp: Counterpart, tName?: string | null): VoucherDoc => {
    const method = res?.payment_method ?? payload.payment_method ?? null;
    return {
      kind,
      document_number: res?.document_number ?? '',
      date: res?.voucher_date ?? payload.voucher_date?.format?.('YYYY-MM-DD') ?? null,
      amount: res?.amount ?? payload.amount,
      partyLabel: cp.label,
      partyName: cp.name ?? undefined,
      treasury: treasuries.find((t) => t.id === res?.treasury_id)?.name ?? tName ?? null,
      paymentMethod: methodOptions.find((o) => o.value === method)?.label ?? method,
      reference: res?.reference ?? payload.reference ?? null,
      description: res?.description ?? payload.description ?? null,
      statement: res?.statement1 ?? payload.statement1 ?? null,
      family: res?.family ?? payload.family ?? null,
      entryId: res?.ledger_entry_id ?? null,
      isReversal: !!res?.is_reversal,
    };
  };

  const focusFirst = () => {
    const body = wrapRef.current?.querySelector<HTMLElement>('.ant-modal-body');
    const first = body ? fieldsIn(body)[0] : undefined;
    first?.focus({ preventScroll: true });
  };

  const save = async (m: SaveMode) => {
    if (posting || mode) return;
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    const payload = buildPayload(v);
    if (!payload) return;
    // اللي هيتطبع واللي هيفضل لـ«جديد» — قبل ما الحفظ يفضّي الفورم.
    const cp = { ...counterpart };
    const tName = treasuryName;
    const keep = { treasury_id: v.treasury_id, voucher_date: v.voucher_date };
    setMode(m);
    let res: any;
    try {
      res = await submit(url, payload, form, okMsg, m === 'new' ? { keepOpen: true } : undefined);
    } finally {
      setMode(null);
    }
    if (!res) return;
    if (m === 'print') printVoucher(docOf(res, payload, cp, tName));
    if (m === 'new') {
      // سند ورا سند من نفس الخزنة وبنفس التاريخ — زي دفتر a5.
      form.setFieldsValue({ ...keep, voucher_date: keep.voucher_date ?? dayjs() });
      onAfterNew?.();
      setTimeout(focusFirst, 60);
    }
  };

  /** الخانة اللي بعد `el` — وبعد الأخيرة زرار الحفظ (من غير ما يدوسه). */
  const moveNext = (el: HTMLElement) => {
    const body = wrapRef.current?.querySelector<HTMLElement>('.ant-modal-body');
    if (!body) return;
    const fields = fieldsIn(body);
    const sel = el.closest('.ant-select');
    const current = (sel ? sel.querySelector('input') : el) as HTMLElement | null;
    const i = current ? fields.indexOf(current) : -1;
    if (i === -1) return;
    const next = fields[i + 1];
    if (next) {
      next.focus({ preventScroll: false });
      if (next instanceof HTMLInputElement && !next.closest('.ant-select')) next.select();
    } else saveRef.current?.focus();
  };

  /**
   * الكيبورد — قبل antd (مرحلة الالتقاط):
   *  - Ctrl+Enter = حفظ، من أي خانة.
   *  - Enter على قايمة مقفولة **فيها اختيار** = الخانة اللي بعدها. antd بيفتح القايمة تاني
   *    مع كل Enter، فاللي ماشي بالكيبورد كان بيلف في نفس الخانة.
   *  - Enter على قايمة مفتوحة = antd بيختار، وبعدها ننزل للي بعدها.
   *  - Enter على خانة طرف فاضية = يفتح شباك اختيار الطرف.
   */
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    // شبابيك جوّه البوباب (اختيار الطرف، حساب جديد) بتبعت أحداثها هنا عن طريق React —
    // مالناش دعوة بيها.
    if (!wrapRef.current?.contains(el) || e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      save('save');
      return;
    }
    if (e.shiftKey || e.altKey) return;
    const sel = el.closest('.ant-select') as HTMLElement | null;
    if (!sel || !el.closest('.ant-modal-body')) return;
    if (sel.classList.contains('ant-select-open')) {
      setTimeout(() => {
        if (!sel.classList.contains('ant-select-open')
          && sel.querySelector('.ant-select-selection-item')) moveNext(el);
      }, 0);
      return;
    }
    const filled = !!sel.querySelector('.ant-select-selection-item');
    if (filled) {
      e.preventDefault();
      e.stopPropagation();
      moveNext(el);
    } else if (el.closest('[data-vs-picker]')) {
      e.preventDefault();
      e.stopPropagation();
      sel.click();
    }
  };

  /** Enter في خانة كتابة (المبلغ، التاريخ، البيان) — بعد ما الخانة نفسها تاخده. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (!wrapRef.current?.contains(el) || e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (el.tagName !== 'INPUT' || el.closest('.ant-select') || !el.closest('.ant-modal-body')) return;
    e.preventDefault();
    moveNext(el);
  };

  const busy = posting || mode !== null;

  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingInlineEnd: 28 }}>
      <span style={{
        width: 40, height: 40, borderRadius: 12, background: c6, color: '#fff',
        display: 'grid', placeItems: 'center', fontSize: 20, flex: '0 0 auto',
      }}>{meta.icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: token.colorText, lineHeight: 1.3 }}>
          {editing ? `تعديل ${meta.title}` : meta.title}
          {editing && <Tag color="gold" style={{ marginInlineStart: 8, verticalAlign: 2 }}>تعديل</Tag>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 400, color: token.colorTextSecondary }}>{meta.sub}</div>
      </div>
    </div>
  );

  const footer = (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>
        Enter: الخانة التالية · Ctrl+Enter: حفظ
      </span>
      <Space wrap size={8}>
        <Button onClick={onCancel} disabled={busy}>إلغاء</Button>
        {!editing && (
          <Button icon={<PlusOutlined />} loading={mode === 'new'} disabled={busy && mode !== 'new'}
            onClick={() => save('new')}>
            حفظ وجديد
          </Button>
        )}
        <Button icon={<PrinterOutlined />} loading={mode === 'print'} disabled={busy && mode !== 'print'}
          onClick={() => save('print')}>
          حفظ وطباعة
        </Button>
        <Button ref={saveRef} type="primary" icon={<SaveOutlined />}
          loading={mode === 'save' || (posting && !mode)} disabled={busy && mode !== 'save'}
          onClick={() => save('save')}>
          {editing ? 'حفظ التعديل' : 'حفظ'}
        </Button>
      </Space>
    </div>
  );

  return (
    <TabModal
      open={open}
      title={title}
      footer={footer}
      onCancel={onCancel}
      destroyOnHidden
      width={860}
      afterOpenChange={(o) => { if (o) setTimeout(focusFirst, 30); }}
      modalRender={(node) => (
        <div ref={wrapRef} onKeyDownCapture={onKeyDownCapture} onKeyDown={onKeyDown}>{node}</div>
      )}
      styles={{
        content: { padding: 0, overflow: 'hidden' },
        header: {
          background: c1, borderBottom: `3px solid ${c6}`, padding: '14px 20px', marginBottom: 0,
        },
        body: { padding: '16px 20px 6px' },
        footer: {
          padding: '10px 20px 14px', marginTop: 0, borderTop: `1px solid ${token.colorBorderSecondary}`,
        },
      }}
    >
      <ShellCtx.Provider value={{ kind, amount, editing }}>
        <Form form={form} layout="vertical" requiredMark={false} className="vs-form">
          <Row gutter={[20, 0]}>
            <Col xs={24} md={12}>{party}</Col>
            <Col xs={24} md={12}>
              <Form.Item name="amount" label="المبلغ" style={{ marginBottom: 4 }}
                rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                <InputNumber
                  className="vs-amount" size="large" min={0.01} controls={false} keyboard={false}
                  style={{ width: '100%', borderColor: amount > 0 ? c6 : undefined }}
                  placeholder="0.00" formatter={withThousands} parser={parseThousands}
                />
              </Form.Item>
              <div className="vs-words" style={{
                color: amount > 0 ? token.colorText : token.colorTextQuaternary,
                background: amount > 0 ? c1 : 'transparent',
              }}>
                {amount > 0 ? amountToArabicWords(amount) : 'المبلغ بالحروف هيتكتب هنا'}
              </div>
            </Col>
            <Col xs={24} md={12}>
              <TreasuryField treasuries={treasuries} amount={amount} width="100%"
                optional={treasuryOptional} placeholder={treasuryPlaceholder} extra={treasuryExtra} />
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear={false} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="description" label="البيان">
                <Input placeholder="وصف الحركة — بيظهر في القيد وكشف الحساب" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              {/* رقم الورقة اللي في الإيد — بيتحفظ جنب رقم السند عندنا مش بداله. */}
              <Form.Item name="external_document_number" label="رقم المستند">
                <Input placeholder="رقم السند الورقي" />
              </Form.Item>
            </Col>
          </Row>

          <Collapse
            size="small"
            className="vs-details"
            activeKey={detailsOpen ? ['d'] : []}
            onChange={(k) => setDetailsOpen((Array.isArray(k) ? k : [k]).includes('d'))}
            items={[{
              key: 'd',
              // متركّبة حتى وهي مقفولة — القيم (في التعديل خصوصاً) لازم تتبعت مع الحفظ.
              forceRender: true,
              label: (
                <span>
                  <b>تفاصيل إضافية</b>
                  {detailsLabel && (
                    <span style={{ color: token.colorTextTertiary, fontSize: 13, marginInlineStart: 8 }}>
                      {detailsLabel}
                    </span>
                  )}
                </span>
              ),
              children: (
                <Row gutter={[20, 0]}>
                  {details.map((d, i) => <Col key={i} xs={24} md={12}>{d}</Col>)}
                </Row>
              ),
            }]}
          />

          <JournalPreview kind={kind} amount={amount} treasuryName={treasuryName}
            counterpart={counterpart} note={journalNote} />
        </Form>
      </ShellCtx.Provider>
    </TabModal>
  );
}
