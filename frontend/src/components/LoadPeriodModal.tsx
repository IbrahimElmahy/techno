import React from 'react';
import { Button, Space, Table, message } from 'antd';
import { TabModal } from './TabModal';
import DateRangeFilter from './DateRangeFilter';
import { api } from '../api/client';
import { money } from '../utils/money';

/**
 * **«تحميل»: فترة ← كشف ← تدوس على اللي عايزه.**
 *
 * الزرار كان بيعيد تحميل المستند المفتوح أو القوايم — يعني بيشتغل من غير ما يحصل
 * حاجة تبان، وده بالظبط شكل الزرار المكسور: تدوس ومافيش رد.
 *
 * وهو سؤال حقيقي بيتسأل كل يوم — «وريني فواتير الأسبوع اللي فات» — والإجابة كانت
 * الرجوع للكشف وضبط فلاتر. بقى: تختار الفترة، الكشف بييجي في شباك، تدوس على اللي
 * عايزه فيفتح.
 *
 * **والكشف بيفضل.** الدوسة التانية على «تحميل» بترجّعه بدل ما تمسحه، وجوّه الكشف
 * زرار «فترة تانية» — فمحدش بيخسر تحميل بالغلط.
 *
 * والمكوّن واحد للأربع شاشات (بيع · مرتجع بيع · شرا · مرتجع شرا) عشان السلوك واحد:
 * أربع نسخ معناها أربع سلوكيات بتفرق مع الوقت — وده اللي حصل في منتقي الأطراف.
 */
export interface PeriodColumn {
  title: string;
  key: string;
  width?: number;
  money?: boolean;
}

/** الأعمدة الافتراضية — مستند وتاريخ وطرف وإجمالي. */
const DEFAULT_COLS: PeriodColumn[] = [
  { title: 'المستند', key: 'document_number', width: 150 },
  { title: 'التاريخ', key: 'date', width: 120 },
  { title: 'الطرف', key: 'party' },
  { title: 'الإجمالي', key: 'total', width: 130, money: true },
];

export default function LoadPeriodModal({
  open, onCancel, title, endpoint, params, columns = DEFAULT_COLS, onPick, rowsRef,
  onLoaded,
}: {
  open: boolean;
  onCancel: () => void;
  /** «تحميل فواتير فترة» */
  title: string;
  /** المسار اللي بيرجّع الكشف، مثلاً `/api/v1/sales`. */
  endpoint: string;
  /** فلاتر زيادة بتتبعت مع التاريخين. */
  params?: Record<string, unknown>;
  columns?: PeriodColumn[];
  /** بيتنده لما يدوس على سطر — بيقفل الشباك ويفتح المستند. */
  onPick: (row: any) => void;
  /** الكشف اللي اتحمّل، عشان الشاشة تعرف ترجّعه بدل ما تبدأ من الأول. */
  rowsRef?: React.MutableRefObject<any[] | null>;
  /**
   * بيتنده بالكشف أول ما يوصل.
   *
   * شاشة الفاتورة بتستعمله عشان تحط الفترة في كشفها هي كمان — فأسهم «السابق»
   * و«التالى» تمشي جوّه الفترة اللي اتحمّلت مش جوّه آخر صفحة كانت مفتوحة.
   */
  onLoaded?: (rows: any[]) => void;
}) {
  const [range, setRange] = React.useState<any>(null);
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (rowsRef) rowsRef.current = rows;
  }, [rows, rowsRef]);

  const run = async () => {
    const from = range?.[0];
    const to = range?.[1];
    if (!from || !to) { message.warning('اختار الفترة الأول'); return; }
    setBusy(true);
    try {
      const res = await api.get(endpoint, {
        params: {
          ...(params || {}),
          date_from: from.format('YYYY-MM-DD'),
          date_to: to.format('YYYY-MM-DD'),
          limit: 500,
        },
      });
      // الكشوف مش كلها بنفس الشكل: المبيعات بترجّع مصفوفة، والمشتريات بترجّع
      // `{rows, total, limit, offset}`. قراءة `items` وحدها كانت بتطلّع كشف فاضي
      // على المشتريات — والشباك بيفضل على شاشة التاريخ وكأن الزرار مش شغال.
      const d: any = res.data;
      const data = Array.isArray(d) ? d : (d?.rows ?? d?.items ?? []);
      setRows(data);
      onLoaded?.(data);
      if (!data.length) message.info('مافيش مستندات في الفترة دي');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الفترة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TabModal
      open={open}
      onCancel={onCancel}
      width={rows?.length ? 760 : 520}
      title={rows?.length ? `${title} — ${rows.length}` : title}
      destroyOnHidden={false}
      footer={rows?.length ? (
        <Space>
          <Button onClick={() => { setRows(null); setRange(null); }}>فترة تانية</Button>
          <Button onClick={onCancel}>إغلاق</Button>
        </Space>
      ) : (
        <Space>
          <Button onClick={onCancel}>إلغاء</Button>
          <Button type="primary" loading={busy}
            disabled={!(range?.[0] && range?.[1])} onClick={run}>تحميل</Button>
        </Space>
      )}
    >
      {rows?.length ? (
        <Table size="small" rowKey="id" dataSource={rows}
          pagination={{ pageSize: 10, size: 'small' }}
          onRow={(r: any) => ({
            style: { cursor: 'pointer' },
            onClick: () => { onCancel(); onPick(r); },
          })}
          columns={columns.map((c) => ({
            title: c.title,
            dataIndex: c.key,
            width: c.width,
            ellipsis: !c.width,
            align: (c.money ? 'left' : undefined) as any,
            render: (v: any) => (c.money ? <b>{money(v ?? 0)}</b> : (v ?? '-')),
          }))} />
      ) : (
        <>
          <DateRangeFilter value={range} onChange={(v: any) => setRange(v)} />
          <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
            هيتحمّل مستندات الفترة دي في كشف، وتدوس على اللي عايزه فيفتح.
          </div>
        </>
      )}
    </TabModal>
  );
}
