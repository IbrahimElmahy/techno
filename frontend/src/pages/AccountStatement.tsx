import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Input, Row, Select, Spin,
  Statistic, Table, Tag, message,
} from 'antd';
import {
  DownloadOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import DocumentLink, { DocKind, docKindOf, useOpenDocument } from '../components/DocumentLink';
import { entryTypeLabel } from '../components/labels';
import JournalEntryLines from '../components/JournalEntryLines';
import DocumentItemLines, { hasItemLines } from '../components/DocumentItemLines';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

/**
 * كشف حساب — any account in the chart, not only customers and suppliers.
 *
 * The party statements on the customer and supplier files already ran a balance; the same
 * question applies to a treasury, a bank, an expense or a revenue account, and there was no
 * reason only two account types could be asked it. Every row carries the balance before the
 * movement and after it, so a disputed figure can be read off one line.
 */

/**
 * موضوع الكشف — الحساب ولا الصنف.
 *
 * السؤال واحد: «إيه اللي حصل على ده؟». والشاشة كانت بتجاوبه لحسابات الشجرة بس، والصنف
 * ليه شاشة تانية بأعمدة تانية وفلاتر تانية وطباعة تانية — فاللي عايز يعرف تاريخ صنف
 * بيتنطّط بين شاشتين على نفس السؤال، ومابيلاقيش عند الصنف الحاجات اللي اتبنت هنا:
 * فلاتر الأعمدة، وإخفاء الأعمدة، والطباعة، والأهم — إن السطر يفتح مستنده **للتعديل**.
 *
 * الصف بيتحوّل لنفس الشكل: تاريخ، ونوع، وبيان، وحركة، ورصيد قبلها وبعدها، ومستند.
 * الفرق الوحيد إن «مدين/دائن» عند الصنف بيبقوا «داخل/خارج» — نفس العمود بنفس المعنى،
 * والوحدة مختلفة.
 */
type Subject = 'account' | 'item';

interface StatementLine {
  doc_kind?: DocKind | null;
  doc_id?: number | null;
  doc_number?: string | null;
  entry_id: number;
  entry_date: string;
  entry_type: string;
  description: string;
  debit: string;
  credit: string;
  balance_before: string;
  balance: string;
  // Both are returned by the API and were rendered through `dataIndex` without ever being
  // declared, so nothing typed could reach them — which is why the filters could not either.
  rep_name?: string | null;
  cost_center_name?: string | null;
  /**
   * الصف زي ما المصدر رجّعه.
   *
   * كارت الصنف بيرجّع على كل حركة أكتر بكتير من اللي بيتعرض: سعر الوحدة، والخصم، والضريبة،
   * وإجمالي السطر، والوحدة اللي اتباع بيها، وتاريخ الصلاحية. الكشف كان بيرمي ده كله وهو
   * بيحوّل الصف لسطر كشف، فاللي عايز يعرف «السطر ده اتحسب إزاي» كان لازم يفتح المستند.
   * بنحتفظ بيه هنا عشان التوسعة تعرضه من غير طلب تاني.
   */
  raw?: any;
}

interface StatementOut {
  account_id: number;
  account_name: string;
  opening_balance: string;
  closing_balance: string;
  total_debit: string;
  total_credit: string;
  lines: StatementLine[];
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function AccountStatement() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState<number | undefined>();
  // Their screen asks الحساب الرئيسي first, then الحساب الفرعي under it. A flat list of every
  // account in the chart is a list nobody scrolls: the person already knows which book they are
  // in, and narrowing by it turns hundreds of options into a handful.
  const [mainKey, setMainKey] = useState<string | undefined>();
  const [subject, setSubject] = useState<Subject>('account');
  const [items, setItems] = useState<any[]>([]);
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  /**
   * السطر بيتفتح تحته.
   *
   * الكشف بيقول إن حاجة حصلت وبكام، ومابيقولش **إيه** اللي حصل: القيد بيتقفل على أكتر من
   * حساب — العميل والإيراد والضريبة — والكشف بيوري طرف واحد منهم، وهو الحساب اللي انت
   * فاتح كشفه أصلاً. يعني العمود بيرد على سؤال انت عارف إجابته، والسؤال الحقيقي — «مقابل
   * إيه؟» — كان لازمله إنك تسيب الشاشة وتفتح القيد في اليومية وتدوّر على رقمه.
   *
   * والقيد بيتجاب أول ما السطر يتفتح مش مع الكشف: كشف فيه ٤٠٠ حركة يبقى ٤٠٠ طلب على حاجة
   * مافيش حد هيبصلها كلها.
   */
  const [expandedKeys, setExpandedKeys] = useState<readonly React.Key[]>([]);
  const [entryCache, setEntryCache] = useState<Record<number, any>>({});
  const [entryBusy, setEntryBusy] = useState<Record<number, boolean>>({});
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [statement, setStatement] = useState<StatementOut | null>(null);
  const [loading, setLoading] = useState(false);
  // ?account=<id> — the customer and supplier files hand the account over rather than making the
  // reader find it again in a dropdown they have just come from.
  const [search] = useSearchParams();
  const asked = Number(search.get('account')) || undefined;
  useEffect(() => { if (asked) setAccountId(asked); }, [asked]);

  useEffect(() => {
    api.get('/api/v1/accounts')
      .then((r) => setAccounts(r.data || []))
      .catch(console.error);
    // سطور القيد بتحمل مركز التكلفة برقمه؛ من غير الأسماء دي بتتعرض «#7».
    api.get('/api/v1/cost-centers?active=true')
      .then((r) => setCostCenters(r.data || []))
      .catch(() => {});
  }, []);

  // الأصناف والمخازن بيتحملوا مع الشاشة — مش بس لكشف الصنف: توسعة أي سطر وراه فاتورة
  // بتعرض أصنافها بأساميها ومخازنها، وكشف حساب من غير الكتالوجات كان هيوري «صنف #11».
  useEffect(() => {
    api.get('/api/v1/items').then((r) => setItems(r.data || [])).catch(() => {});
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data || [])).catch(() => {});
  }, []);

  /**
   * بيحمّل الكشف — من مصدرين على حسب الموضوع، وبيطلّع نفس الشكل.
   *
   * التحويل هنا مش تجميل: الجدول والفلاتر والطباعة والروابط كلها متبنية على `StatementLine`،
   * فأي مصدر جديد بيتكلّم لغتها بيورث كل ده من غير سطر زيادة في أي منهم.
   *
   * والأرقام بتفضل صادقة: عند الصنف «مدين/دائن» هما الكمية الداخلة والخارجة، والرصيد قبل
   * وبعد هما رصيد المخزون — نفس المعنى بوحدة مختلفة، والعناوين بتقول الوحدة دي.
   */
  const load = async () => {
    // اللي كان مفتوح بيبقى بتاع كشف راح؛ سيبانه مفتوح على كشف تاني بيوري تفاصيل حركة
    // مش موجودة في اللي قدامك.
    setExpandedKeys([]);
    if (subject === 'account') {
      if (!accountId) { setStatement(null); return; }
      setLoading(true);
      try {
        const params: any = {};
        if (range) {
          params.date_from = range[0].format('YYYY-MM-DD');
          params.date_to = range[1].format('YYYY-MM-DD');
        }
        const res = await api.get(`/api/v1/accounts/${accountId}/statement`, { params });
        setStatement(res.data);
      } catch (err: any) {
        message.error(err?.response?.data?.detail?.message || 'تعذر تحميل كشف الحساب');
        setStatement(null);
      } finally { setLoading(false); }
      return;
    }

    if (!itemId) { setStatement(null); return; }
    setLoading(true);
    try {
      const params: any = {};
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
      }
      if (warehouseId) {
        params.location_kind = 'warehouse';
        params.location_id = warehouseId;
      }
      const res = await api.get(`/api/v1/items/${itemId}/card`, { params });
      const d = res.data || {};
      setStatement({
        account_id: itemId,
        account_name: `${d.item_name ?? ''}${d.item_code ? ` (${d.item_code})` : ''}`,
        opening_balance: d.opening_balance ?? '0',
        closing_balance: d.closing_balance ?? '0',
        total_debit: d.total_in ?? '0',
        total_credit: d.total_out ?? '0',
        lines: (d.rows || []).map((r: any) => ({
          entry_id: r.movement_id,
          entry_date: r.date,
          entry_type: r.movement_type,
          // البيان بيتركّب من اللي على الحركة: الطرف والمكان. الكارت بيرجّعهم، وسطر من
          // غيرهم بيبقى رقم مالوش قصة.
          description: [r.party, r.location].filter(Boolean).join(' — ') || '-',
          debit: r.quantity_in ?? '0',
          credit: r.quantity_out ?? '0',
          balance_before: r.balance_before ?? '0',
          balance: r.balance_after ?? '0',
          rep_name: r.rep_name ?? null,
          cost_center_name: null,
          // نفس محرك الروابط — فالسطر بيفتح فاتورته **للتعديل** زي كشف الحساب بالظبط.
          doc_kind: docKindOf(r.source_doc_type),
          doc_id: r.source_doc_id ?? null,
          doc_number: r.document_number ?? null,
          raw: r,
        })),
      });
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل كشف الصنف');
      setStatement(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [subject, accountId, itemId, warehouseId, range]);

  /** What a row reads as. Party accounts carry no `name` at all — the customer's name lives in
   *  `owner_name` — so a picker that only read `name` showed «حساب #16» for every customer and
   *  supplier in the chart, which are precisely the accounts people open statements for. */
  const labelOf = (a: any) => {
    const named = a.name || a.owner_name || `حساب #${a.id}`;
    return a.code ? `${a.code} — ${named}` : named;
  };

  /**
   * «الحساب الرئيسي» is two different things in this chart, and the box offers both.
   *
   * The coded roots — الأصول · الالتزامات · حقوق الملكية · الإيرادات · المصروفات — are real
   * accounts with a subtree under them. The party accounts are NOT under any of them: every
   * customer and supplier account is parentless and carries an `owner_group` instead. Offering
   * only the roots would leave «العملاء» — the most-asked-for book on this screen — unreachable
   * from the first box.
   */
  const mainOptions = useMemo(() => {
    const roots = accounts.filter((a: any) => !a.parent_id && a.code)
      .map((a: any) => ({ value: `acc:${a.id}`, label: labelOf(a) }));
    const groups = [...new Set(accounts
      .filter((a: any) => !a.parent_id && !a.code && a.owner_group)
      .map((a: any) => a.owner_group))]
      .map((g) => ({ value: `grp:${g}`, label: String(g) }));
    return [...roots, ...groups];
  }, [accounts]);

  /** What the second box offers. With a book chosen it is that book's accounts; with none it is
   *  the whole chart, so somebody who knows the name can still find it without the first box. */
  const visibleAccounts = useMemo(() => {
    if (!mainKey) return accounts;
    if (mainKey.startsWith('grp:')) {
      const group = mainKey.slice(4);
      return accounts.filter((a: any) => a.owner_group === group);
    }
    const rootId = Number(mainKey.slice(4));
    // The whole subtree, not just the children: the chart goes three deep (`1 → 1.01 →
    // 1.01.001`), and stopping at one level would hide «الخزينة» under «الأصول».
    const byId = new Map<number, any>(accounts.map((a: any) => [a.id, a]));
    const inTree = (a: any) => {
      let cur: any = a;
      for (let hops = 0; cur && hops < 12; hops += 1) {
        if (cur.id === rootId) return true;
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      return false;
    };
    return accounts.filter(inTree);
  }, [accounts, mainKey]);

  // A statement opened by deep link (`?account=`) arrives with no book chosen, so the first box
  // is filled in from the account rather than left blank beside a filled second box.
  useEffect(() => {
    if (!accountId || mainKey || !accounts.length) return;
    const chosen = accounts.find((a: any) => a.id === accountId);
    if (!chosen) return;
    if (chosen.owner_group && !chosen.code) { setMainKey(`grp:${chosen.owner_group}`); return; }
    const byId = new Map<number, any>(accounts.map((a: any) => [a.id, a]));
    let cur: any = chosen;
    for (let hops = 0; cur?.parent_id && hops < 12; hops += 1) cur = byId.get(cur.parent_id);
    if (cur && cur.id !== chosen.id) setMainKey(`acc:${cur.id}`);
  }, [accountId, accounts, mainKey]);

  const exportCsv = () => {
    if (!statement?.lines?.length) { message.info('لا توجد حركات للتصدير'); return; }
    const cols: CsvColumn<any>[] = [
      { title: 'التاريخ', value: (l) => String(l.entry_date).slice(0, 10) },
      { title: 'النوع', value: (l) => entryTypeLabel(l.entry_type) },
      { title: 'البيان', value: 'description' },
      { title: 'الرصيد قبل', value: 'balance_before' },
      { title: 'مدين', value: 'debit' },
      { title: 'دائن', value: 'credit' },
      { title: 'الرصيد بعد', value: 'balance' },
    ];
    writeCsv(`statement-${statement.account_id}`, cols, statement.lines);
  };

  const printIt = () => {
    if (!statement) return;
    const cols: PrintColumn<any>[] = [
      { title: 'التاريخ', value: (l) => String(l.entry_date).slice(0, 10) },
      { title: 'النوع', value: (l) => entryTypeLabel(l.entry_type) },
      { title: 'البيان', value: 'description' },
      { title: 'مدين', value: 'debit', numeric: true },
      { title: 'دائن', value: 'credit', numeric: true },
      { title: 'الرصيد', value: 'balance', numeric: true },
    ];
    printReport(
      {
        title: isItem ? 'كشف صنف' : 'كشف حساب',
        meta: [
          [isItem ? 'الصنف' : 'الحساب', statement.account_name ?? ''],
          // الفلاتر بتتكتب على الورقة — أرقام من غير سياقها بتبقى مالهاش معنى بعد أسبوع.
          ...(range ? [[
            'الفترة',
            `${range[0].format('YYYY/MM/DD')} ← ${range[1].format('YYYY/MM/DD')}`,
          ] as [string, string]] : []),
          ...(isItem && warehouseId
            ? [['المخزن',
                warehouses.find((w: any) => w.id === warehouseId)?.name ?? ''] as [string, string]]
            : []),
        ],
      },
      cols, statement.lines,
      [
        { label: 'رصيد أول المدة', value: money(statement.opening_balance) },
        { label: 'إجمالي مدين', value: money(statement.total_debit) },
        { label: 'إجمالي دائن', value: money(statement.total_credit) },
        { label: 'الرصيد الختامي', value: money(statement.closing_balance) },
      ],
    );
  };

  // «إيه السطر ده؟» — السطر كله يفتح مستنده، مش عمود المستند لوحده. اللي بيقرا كشف حساب
  // بيمشي بعينه على الأرقام على الشمال، والزرار في آخر السطر بعيد عن اللي بيبصّ عليه.
  // Distinct values come from the whole statement, not the visible page.
  const lines: StatementLine[] = statement?.lines ?? [];

  /**
   * فلتر المندوب — «المندوب ده حرّك إيه على الحساب ده».
   *
   * The rep column already carried a per-column dropdown, but a filter buried in a column header
   * is one nobody finds while looking at a statement — and «شوفلي حركة المندوب» is a question
   * asked out loud, not hunted for. It sits with the date range because it is the same kind of
   * narrowing: which slice of this account am I reading.
   *
   * The list of names comes from the statement itself, not from the users table: offering every
   * rep in the company on an account only two of them ever touched is a list nobody can use.
   */
  const [repFilter, setRepFilter] = useState<string | undefined>();

  /**
   * بحث نصي على الكشف.
   *
   * الفلاتر اللي على رؤوس الأعمدة بتشتغل لما تعرف **أنهي عمود** فيه اللي بتدوّر عليه.
   * واللي بيفتح كشف بتمنميت سطر بيبقى معاه رقم مستند أو اسم، مش عمود — و«فين الحركة
   * اللي فيها ١٢٥٠؟» سؤال مالوش إجابة في فلتر عمود واحد.
   */
  const [query, setQuery] = useState('');

  /**
   * فلتر نوع الحركة — «ورّيني المبيعات بس» أو «التحصيلات بس».
   *
   * كان موجود كفلتر على رأس عمود «النوع»، ودي حاجة محدش بيلاقيها وهو بيقرا كشف: الفلتر
   * اللي جوّه رأس عمود بيتفتح بضغطة على أيقونة صغيرة مالهاش عنوان. وده سؤال بيتقال بصوت
   * عالي، فمكانه فوق مع الفترة والمندوب.
   *
   * والأنواع بتتقرا من الكشف نفسه مش من قايمة ثابتة — عرض كل أنواع الحركات في النظام على
   * حساب اتحرك بنوعين هو قايمة بتوعد بحاجات مش موجودة.
   */
  // متعدد زي نظامهم — «المبيعات والتحصيلات مع بعض» سؤال حقيقي، واختيار واحد كان بيجبر
  // اللي بيسأله يقارن كشفين ورا بعض من الذاكرة.
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const repOptions = [...new Set(lines.map((l) => l.rep_name).filter(Boolean))]
    .map((r) => ({ value: r as string, label: r as string }));
  const typeOptions = [...new Set(lines.map((l) => l.entry_type).filter(Boolean))]
    .map((t) => ({ value: t as string, label: entryTypeLabel(t as string) }));

  /**
   * اللي على الشاشة بعد الفلاتر — وده اللي الرصيد التراكمي بيتحسب عليه كمان.
   *
   * البحث بيدوّر في البيان ورقم المستند واسم المندوب والنوع — الأربعة اللي حد ممكن
   * يكون فاكرهم عن سطر بيدوّر عليه.
   */
  const shownLines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (repFilter && l.rep_name !== repFilter) return false;
      if (typeFilter.length && !typeFilter.includes(l.entry_type)) return false;
      if (!q) return true;
      return [l.description, l.doc_number, l.rep_name, entryTypeLabel(l.entry_type)]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [lines, repFilter, typeFilter, query]);

  /**
   * الرصيد التراكمي **للمعروض**.
   *
   * عمود «الرصيد بعد» بتاع الحساب كله: بيتحسب على كل الحركات، وبيفضل كده حتى لما تفلتر.
   * وده صح — الرصيد بتاع الحساب مش بتاع اللي انت شايفه — بس النتيجة إن اللي بيفلتر بمندوب
   * بيقرا عمود أرقامه مالهاش علاقة بالسطور اللي قدامه: سطر بـ٥٠٠ ورصيد ٢٠ ألف جنبه.
   *
   * فالعمود ده بيمشي على المعروض وبس: بيبدأ من صفر وبيجمع اللي بيتشاف. مش رصيد الحساب،
   * وعنوانه بيقول كده — «تراكمي المعروض» — عشان محدش يقراه على إنه الرصيد.
   *
   * وبيبان بس لما يكون فيه فلتر شغّال؛ من غير فلتر هو نفس عمود الرصيد بالظبط، وعمودين
   * بنفس الأرقام بيخلّوا الواحد يدوّر على الفرق بينهم.
   */
  const filtering = !!(repFilter || typeFilter.length || query.trim());
  const runningOf = useMemo(() => {
    const m = new Map<string, number>();
    let acc = 0;
    for (const l of shownLines) {
      acc += Number(l.debit || 0) - Number(l.credit || 0);
      m.set(`${l.entry_id}-${l.entry_date}-${l.balance}`, acc);
    }
    return m;
  }, [shownLines]);
  const openDoc = useOpenDocument();

  /**
   * بيجيب القيد اللي السطر طالع منه.
   *
   * الفشل بيتخزّن كـ`null` زي النجاح بالظبط، عشان سطر مالوش قيد يتقرا مايفضلش يطلب نفس
   * الحاجة كل مرة يتفتح فيها.
   */
  const loadEntry = async (entryId: number) => {
    if (entryId in entryCache || entryBusy[entryId]) return;
    setEntryBusy((b) => ({ ...b, [entryId]: true }));
    try {
      const r = await api.get(`/api/v1/journal-entries/${entryId}`);
      setEntryCache((c) => ({ ...c, [entryId]: r.data }));
    } catch {
      setEntryCache((c) => ({ ...c, [entryId]: null }));
    } finally {
      setEntryBusy((b) => ({ ...b, [entryId]: false }));
    }
  };

  const rowKeyOf = (l: StatementLine) => `${l.entry_id}-${l.entry_date}-${l.balance}`;

  const toggleRow = (l: StatementLine) => {
    const k = rowKeyOf(l);
    setExpandedKeys((keys) => (keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]));
    // القيد بيتجاب بس للسطور اللي مالهاش مستند بأصناف — سطر الفاتورة بيوري أصنافها،
    // ومايحتاجش سطور القيد أصلاً.
    if (subject === 'account' && !hasItemLines(l.doc_kind)) loadEntry(l.entry_id);
  };

  const kb = useTableKeyboard<StatementLine>({
    rows: lines,
    rowKey: rowKeyOf,
    /**
     * الضغطة بتفتح السطر، مش المستند.
     *
     * كانت بتودّي على المستند على طول، فالطريقة الوحيدة للإجابة على «السطر ده إيه؟» كانت
     * إنك تسيب الكشف. والسطور اللي مالهاش مستند — القيود اليدوية والأرصدة الافتتاحية —
     * ماكانتش بتعمل حاجة خالص، وهي بالظبط السطور اللي محتاجة شرح. دلوقتي بتتفتح تحتها،
     * والمستند ليه زراره جوّه.
     */
    onOpen: toggleRow,
  });

  /**
   * عناوين الأعمدة بتتغيّر مع الموضوع، والمعنى ثابت.
   *
   * «مدين/دائن» عند الحساب هما نفس «داخل/خارج» عند الصنف: حاجة زادت وحاجة نقصت، والرصيد
   * قبل وبعد بيمشوا معاهم. اللي بيتغيّر هو الوحدة — جنيه ولا قطعة — والعنوان لازم يقولها،
   * لأن عمود مكتوب عليه «مدين» فوق كميات هو أسوأ من عمود من غير عنوان.
   */
  const isItem = subject === 'item';
  const LABELS = isItem
    ? { debit: 'داخل', credit: 'خارج', before: 'الرصيد قبل', after: 'الرصيد بعد' }
    : { debit: 'مدين', credit: 'دائن', before: 'الرصيد قبل', after: 'الرصيد بعد' };
  /** الكميات بتتعرض بمنازلها، والفلوس بمنزلتين. */
  const num = (v: any) => (isItem
    ? Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 })
    : money(v));

  const columns: ColumnsType<StatementLine> = [
    { title: 'التاريخ', dataIndex: 'entry_date',
      ...dateColumn<StatementLine>((l) => l.entry_date),
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'النوع', dataIndex: 'entry_type',
      ...textColumn(lines, (l: StatementLine) => entryTypeLabel(l.entry_type)),
      render: (t: string) => <Tag>{entryTypeLabel(t)}</Tag> },
    { title: 'البيان', dataIndex: 'description',
      ...textColumn(lines, (l: StatementLine) => l.description) },
    // Their statement has a cost-centre column. The journal line has always carried one
    // and this screen dropped it, so «against which project?» meant opening the entry.
    // The line never held a rep; the document that posted it did. A manual journal
    // entry has none and says so rather than borrowing one.
    { title: 'مندوب', dataIndex: 'rep_name', width: 140, ellipsis: true,
      ...textColumn(lines, (l: StatementLine) => l.rep_name),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: 'مركز التكلفة', dataIndex: 'cost_center_name', width: 160,
      ...textColumn(lines, (l: StatementLine) => l.cost_center_name),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: LABELS.before, dataIndex: 'balance_before', align: 'left',
      ...numberColumn<StatementLine>((l) => l.balance_before),
      render: (v: string) => <span style={{ color: '#6b6b6b' }}>{num(v)}</span> },
    { title: LABELS.debit, dataIndex: 'debit', align: 'left',
      ...numberColumn<StatementLine>((l) => l.debit),
      render: (v: string) => (Number(v) ? num(v) : '-') },
    { title: LABELS.credit, dataIndex: 'credit', align: 'left',
      ...numberColumn<StatementLine>((l) => l.credit),
      render: (v: string) => (Number(v) ? num(v) : '-') },
    ...(filtering ? [{
      title: 'تراكمي المعروض',
      key: 'running',
      align: 'left' as const,
      render: (_: unknown, l: StatementLine) => (
        <span style={{ color: '#b26a00' }}>
          {num(runningOf.get(`${l.entry_id}-${l.entry_date}-${l.balance}`) ?? 0)}
        </span>
      ),
    }] : []),
    { title: LABELS.after, dataIndex: 'balance', align: 'left',
      ...numberColumn<StatementLine>((l) => l.balance),
      render: (v: string) => <b>{num(v)}</b> },
    // The whole point of a statement is to answer «إيه السطر ده؟» — so the answer is
    // one click away rather than a number to memorise and search for elsewhere.
    { title: 'المستند', key: 'doc', align: 'center',
      ...textColumn(lines, (l: StatementLine) => l.doc_number),
      render: (_: unknown, l: StatementLine) => (l.doc_kind && l.doc_id ? (
        <DocumentLink kind={l.doc_kind} id={l.doc_id} size="small"
          label={l.doc_number || undefined}
          // كل المستندات اللي شاشتها بتعدّل — `DocumentLink` هي اللي بتعرف مين فيهم،
          // فالقايمة موجودة في مكان واحد بدل ما كل شاشة تفتكرها.
          allowEdit />
      ) : <span style={{ color: '#8c8c8c' }}>قيد يدوي</span>) },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('account-statement', columns);

  const itemNameOf = (id: number) => {
    const it = items.find((x: any) => x.id === id);
    return it ? (it.code ? `${it.code} — ${it.name}` : it.name) : `صنف #${id}`;
  };
  const whName = (id: number | null | undefined) => {
    if (!id) return null;
    const w = warehouses.find((x: any) => x.id === id);
    return w ? w.name : `مخزن #${id}`;
  };

  const acctName = (id: number) => {
    const a = accounts.find((x: any) => x.id === id);
    return a ? labelOf(a) : `حساب #${id}`;
  };
  const ccName = (id: number | null | undefined) => {
    if (!id) return null;
    const c = costCenters.find((x: any) => x.id === id);
    return c ? (c.name || `#${id}`) : `#${id}`;
  };

  /**
   * بيروح لكشف حساب تاني من جوّه القيد.
   *
   * ده اللي بيخلّي التوسعة رد فعلي مش عرض: القيد بيقول إن الفلوس دي راحت على حساب فلان،
   * والسؤال اللي بعده على طول هو «طب وفلان ده رصيده إيه؟» — والإجابة كانت محتاجة إنك
   * تفتكر الاسم وتدوّر عليه في قايمة الحسابات تاني.
   *
   * و«الحساب الرئيسي» بيتفضّى لأن الحساب اللي رايح ليه ممكن مايبقاش تحت اللي متحدد،
   * وساعتها الخانة بتفضل فاضية وهو مش عارف ليه.
   */
  const openAccount = (id: number) => {
    if (!id || id === accountId) return;
    setSubject('account');
    setMainKey(undefined);
    setAccountId(id);
  };

  /**
   * اللي بيتعرض تحت السطر.
   *
   * الحساب والصنف بيوصلوا لنفس الحتة من طريقين: القيد بسطوره عند الحساب، وتفاصيل الحركة
   * عند الصنف. والاتنين بيبدأوا بنفس الشريط — النوع والتاريخ والبيان وزرار المستند — عشان
   * اللي بيقرا مايتعلّمش شاشتين.
   */
  const rowDetail = (l: StatementLine) => {
    const head = (
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10,
      }}>
        <Tag>{entryTypeLabel(l.entry_type)}</Tag>
        <span style={{ color: '#8c8c8c' }}>{String(l.entry_date || '').slice(0, 10)}</span>
        <span>{l.description}</span>
        <span style={{ marginInlineStart: 'auto' }}>
          {l.doc_kind && l.doc_id ? (
            <DocumentLink kind={l.doc_kind} id={l.doc_id}
              label={l.doc_number ? `المستند ${l.doc_number}` : 'فتح المستند'} allowEdit />
          ) : (
            // مافيش رابط لأنه مافيش مستند — القيد اليدوي والرصيد الافتتاحي اتكتبوا هنا
            // مباشرة، وزرار بيوعد بفاتورة مش موجودة أوحش من نص بيقول الحقيقة.
            <span style={{ color: '#8c8c8c' }}>قيد يدوي — مافيش مستند وراه</span>
          )}
        </span>
      </div>
    );

    // زي علامة «حركة مخزنية» في نظامهم: السطر اللي وراه فاتورة بيفرد أصنافها —
    // المخزن والصنف والكمية والسعر والإجمالي. اللي بيراجع كشف عميل مش بيسأل «القيد اتقفل
    // على أنهي حساب» — بيسأل «العميل ده خد إيه». سطور القيد إجابة محاسب؛ الأصناف إجابة
    // صاحب الشغل، وهي دي اللي بتتفرد. القيود اليدوية بس هي اللي بتوري سطور القيد،
    // لأنها كل اللي عندها.
    if (l.doc_kind && l.doc_id && hasItemLines(l.doc_kind)) {
      return (
        <div style={{ padding: '4px 8px' }}>
          {head}
          <DocumentItemLines kind={l.doc_kind} id={l.doc_id}
            itemName={itemNameOf} warehouseName={whName} money={money} />
        </div>
      );
    }

    if (isItem) {
      const r = l.raw || {};
      const facts: Array<[string, React.ReactNode]> = [];
      if (r.quantity_in_unit) facts.push(['الكمية بالوحدة', `${r.quantity_in_unit} ${r.unit ?? ''}`]);
      if (r.unit_price != null) facts.push(['سعر الوحدة', money(r.unit_price)]);
      if (r.discount_pct != null && Number(r.discount_pct)) {
        facts.push(['الخصم', `${Number(r.discount_pct).toLocaleString('ar-EG')}%`]);
      }
      if (r.tax_amount != null && Number(r.tax_amount)) facts.push(['الضريبة', money(r.tax_amount)]);
      if (r.line_total != null) facts.push(['إجمالي السطر', <b key="t">{money(r.line_total)}</b>]);
      if (r.party) facts.push(['الطرف', r.party]);
      if (r.location) facts.push(['المكان', r.location]);
      if (r.expiry_date) facts.push(['تاريخ الصلاحية', String(r.expiry_date).slice(0, 10)]);
      if (r.is_reversal) facts.push(['ملاحظة', <Tag key="rv" color="red">حركة عكسية</Tag>]);

      return (
        <div style={{ padding: '4px 8px' }}>
          {head}
          {facts.length ? (
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
              {facts.map(([k, v]) => (
                <Descriptions.Item key={k} label={k}>{v}</Descriptions.Item>
              ))}
            </Descriptions>
          ) : (
            <span style={{ color: '#8c8c8c' }}>الحركة دي مالهاش تفاصيل زيادة عن اللي في السطر</span>
          )}
        </div>
      );
    }

    if (entryBusy[l.entry_id] || !(l.entry_id in entryCache)) {
      return <div style={{ padding: '4px 8px' }}>{head}<Spin size="small" /></div>;
    }
    const entry = entryCache[l.entry_id];
    if (!entry) {
      return (
        <div style={{ padding: '4px 8px' }}>
          {head}
          <span style={{ color: '#8c8c8c' }}>تعذر تحميل سطور القيد</span>
        </div>
      );
    }

    return (
      <div style={{ padding: '4px 8px' }}>
        {head}
        <JournalEntryLines
          lines={entry.lines || []}
          currentAccountId={accountId}
          accountLabel={acctName}
          costCenterName={ccName}
          onOpenAccount={openAccount}
          money={money}
        />
      </div>
    );
  };

  return (
    <Card
      title={isItem ? 'كشف صنف' : 'كشف حساب'}
      extra={(
        <>
          {tableCols.control}
          <Button icon={<DownloadOutlined />} onClick={exportCsv}
            disabled={!statement?.lines?.length} style={{ marginInlineEnd: 8 }}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />} onClick={printIt}
            disabled={!statement?.lines?.length}
            style={{ marginInlineEnd: 8 }}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={!accountId}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={4}>
          {/* الموضوع الأول: بنسأل «كشف إيه؟» قبل «مين؟» — لأن الإجابة بتغيّر الخانة اللي
              بعدها. وتغييره بيفضّي اللي اتحدّد قبله، عشان مايفضلش على الشاشة كشف حاجة
              والخانة بتقول حاجة تانية. */}
          <Select
            style={{ width: '100%' }} value={subject}
            onChange={(v) => {
              setSubject(v as Subject);
              setAccountId(undefined); setItemId(undefined);
              setWarehouseId(undefined); setStatement(null);
            }}
            options={[
              { value: 'account', label: 'كشف حساب' },
              { value: 'item', label: 'كشف صنف' },
            ]}
          />
        </Col>

        {isItem ? (
          <>
            <Col xs={24} md={8}>
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }}
                placeholder="اختر الصنف" value={itemId} onChange={setItemId}
                options={items.map((i: any) => ({
                  value: i.id,
                  label: i.code ? `${i.code} — ${i.name}` : i.name,
                }))}
              />
            </Col>
            <Col xs={24} md={4}>
              {/* من غير مخزن = كل المواقع، وده اللي الكارت بيعمله لوحده. */}
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }} allowClear
                placeholder="كل المخازن" value={warehouseId} onChange={setWarehouseId}
                options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))}
              />
            </Col>
          </>
        ) : (
          <>
        <Col xs={24} md={4}>
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%' }} allowClear
            placeholder="الحساب الرئيسي" value={mainKey}
            // Changing the book clears the account under it: keeping a sub-account from the
            // previous book would leave the two fields disagreeing about what is on screen.
            onChange={(v) => { setMainKey(v); setAccountId(undefined); }}
            options={mainOptions}
          />
        </Col>
        <Col xs={24} md={8}>
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder={mainKey ? 'الحساب الفرعي' : 'اختر الحساب'}
            value={accountId} onChange={setAccountId}
            options={visibleAccounts.map((a: any) => ({ value: a.id, label: labelOf(a) }))}
          />
        </Col>
          </>
        )}
        <Col xs={24} md={6}>
          <DatePicker.RangePicker
            style={{ width: '100%' }} value={range as any} allowClear
            onChange={(v) => setRange(v as any)} placeholder={['من تاريخ', 'إلى تاريخ']}
          />
        </Col>
        <Col xs={24} md={4}>
          {/* البحث النصي — على البيان ورقم المستند والمندوب والنوع. */}
          <Input allowClear prefix={<SearchOutlined />} placeholder="بحث في الكشف"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </Col>
        <Col xs={24} md={4}>
          {/* نوع الحركة فوق مش في رأس عمود — ده سؤال بيتقال بصوت عالي. */}
          <Select
            mode="multiple" showSearch optionFilterProp="label" style={{ width: '100%' }}
            allowClear maxTagCount="responsive"
            placeholder="نوع الحركة" value={typeFilter} onChange={setTypeFilter}
            options={typeOptions} disabled={!typeOptions.length}
          />
        </Col>
        <Col xs={24} md={4}>
          {/* Only offered once the statement is on screen and somebody's name is actually on it —
              an empty rep box on an account no rep has touched is a control that can only
              disappoint. */}
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%' }} allowClear
            placeholder="المندوب" value={repFilter} onChange={setRepFilter}
            options={repOptions}
            disabled={!repOptions.length}
          />
        </Col>
      </Row>

      {((isItem && !itemId) || (!isItem && !accountId)) && (
        <Empty description={isItem ? 'اختر صنفاً لعرض كشفه' : 'اختر حساباً لعرض كشفه'} />
      )}

      {statement && (
        <>
          {/* With a rep filter on, the account's own totals describe rows that are NOT on
              screen. Debit and credit are recomputed over what is shown; the opening and closing
              balance are not, because «رصيد أول المدة لمندوب» is not a number that exists — a
              balance is the whole account or it is nothing. So they say whose they are instead of
              quietly meaning something else. */}
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={isItem ? 'رصيد أول المدة' : 'رصيد أول المدة (الحساب كله)'}
                  value={num(statement.opening_balance)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={repFilter ? `${LABELS.debit} — ${repFilter}` : `إجمالي ${LABELS.debit}`}
                  value={num(repFilter
                    ? shownLines.reduce((t, l) => t + Number(l.debit || 0), 0)
                    : statement.total_debit)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={repFilter ? `${LABELS.credit} — ${repFilter}` : `إجمالي ${LABELS.credit}`}
                  value={num(repFilter
                    ? shownLines.reduce((t, l) => t + Number(l.credit || 0), 0)
                    : statement.total_credit)} />
              </Card>
            </Col>
            <Col xs={12} md={3}>
              <Card size="small">
                {/* «رصيد الحركة» زي نظامهم: صافي الفترة المعروضة — مدينها ناقص دائنها.
                    الرصيد الختامي بيقول انت واقف فين؛ ده بيقول الفترة دي لوحدها عملت إيه،
                    ومن غيره كانوا بيتطرحوا على آلة حاسبة جنب الشاشة. */}
                <Statistic title="رصيد الحركة"
                  value={num(Number(statement.total_debit || 0) - Number(statement.total_credit || 0))} />
              </Card>
            </Col>
            <Col xs={12} md={3}>
              <Card size="small">
                <Statistic title={`الرصيد — ${statement.account_name}`}
                  value={num(statement.closing_balance)}
                  valueStyle={{ color: '#0B5CA8' }} />
              </Card>
            </Col>
          </Row>

          {/* أي فلتر شغّال بيتقال، مش المندوب وحده.
              اللي بيقرا كشف مفلتر وهو فاكره كامل بيطلع باستنتاج غلط — والإجماليات فوق
              بتاعة الحساب كله، فالفرق لازم يكون مكتوب. */}
          {filtering && (
            <Alert
              type="info" showIcon style={{ marginBottom: 12 }}
              message={[
                repFilter && `حركة «${repFilter}»`,
                typeFilter.length && `نوع «${typeFilter.map(entryTypeLabel).join('، ')}»`,
                query.trim() && `بحث «${query.trim()}»`,
              ].filter(Boolean).join(' · ')}
              description={`${shownLines.length} حركة من إجمالي ${lines.length}. `
                + 'الرصيد أول وآخر المدة للحساب كله — والعمود «تراكمي المعروض» هو اللي بيمشي '
                + 'مع السطور اللي قدامك.'}
            />
          )}

          <Table<StatementLine>
            {...kb.tableProps}
            rowKey={rowKeyOf}
            size="small" loading={loading} dataSource={shownLines}
            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
            pagination={{ defaultPageSize: 25, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={tableCols.columns}
            expandable={{
              expandedRowKeys: expandedKeys,
              // الضغط على الصف نفسه بيفتحه كمان (من `onOpen`)، والسهم موجود عشان اللي
              // بيدوّر بعينه على حاجة تتفتح يلاقيها.
              onExpand: (_open, l) => toggleRow(l),
              expandedRowRender: rowDetail,
            }}
          />
        </>
      )}
    </Card>
  );
}
