import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space,
  Statistic, Table, Tag, message,
} from 'antd';
import { CheckOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';

/**
 * جرد المخازن و جرد عام — the counting cycle.
 *
 * «جرد حتى تاريخ» already answered what the books said on a day. That is one half of one stocktake;
 * this is the half the warehouse actually does — open a sheet, walk the shelves, write what is
 * there, settle the difference.
 *
 * The two entries are one screen: a general count is the same document with no warehouse named, and
 * building it as a second screen would mean two of everything to keep in step.
 */

interface Line {
  id: number; item_id: number; item_name: string | null;
  warehouse_id: number; warehouse_name: string | null;
  book_quantity: string; counted_quantity: string | null; difference: string | null;
  stock_movement_id: number | null;
}

interface Sheet {
  id: number; document_number: string;
  warehouse_id: number | null; warehouse_name: string | null;
  count_date: string; status: 'draft' | 'posted' | 'cancelled';
  notes: string | null; created_at: string; posted_at: string | null;
  line_count: number; counted_count: number; lines?: Line[];
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function StockCounts() {
  const navigate = useNavigate();
  // Their «جرد المخازن» and «جرد عام» turned out to be filtered stock listings, not counting
  // sheets, so those two entries open رصيد صنف instead. This screen is the counting cycle itself,
  // which theirs has no counterpart for — and one sheet or all warehouses is a choice made in the
  // dialog rather than by arriving through a different menu entry.

  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [openVisible, setOpenVisible] = useState(false);
  const [opening, setOpening] = useState(false);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [countDate, setCountDate] = useState<Dayjs>(dayjs());
  const [notes, setNotes] = useState('');

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  // Typed counts, keyed by line. Empty until somebody writes a number — a blank line means «nobody
  // reached this shelf», and pre-filling it with the book figure would turn not-counted into
  // counted-and-agrees on every line nobody touched.
  const [entered, setEntered] = useState<Record<number, number | null>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        api.get('/api/v1/stock-counts'),
        api.get('/api/v1/warehouses'),
      ]);
      setSheets(s.data || []); setWarehouses(w.data || []);
    } catch {
      message.error('تعذر تحميل الجرد');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openSheet = async () => {
    setOpening(true);
    try {
      const res = await api.post('/api/v1/stock-counts', {
        // Empty means every active warehouse — the general count, chosen here rather than by route.
        warehouse_id: warehouseId ?? null,
        count_date: countDate.format('YYYY-MM-DD'),
        notes: notes || null,
      });
      message.success(`اتفتح كشف الجرد ${res.data.document_number}`);
      setOpenVisible(false);
      setSheet(res.data); setEntered({}); setDetailVisible(true);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر فتح الجرد');
    } finally { setOpening(false); }
  };

  const openDetail = async (row: Sheet) => {
    try {
      const res = await api.get(`/api/v1/stock-counts/${row.id}`);
      setSheet(res.data);
      const seed: Record<number, number | null> = {};
      (res.data.lines || []).forEach((ln: Line) => {
        seed[ln.id] = ln.counted_quantity === null ? null : Number(ln.counted_quantity);
      });
      setEntered(seed);
      setDetailVisible(true);
    } catch {
      message.error('تعذر فتح الكشف');
    }
  };

  const saveCounts = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      const res = await api.put(`/api/v1/stock-counts/${sheet.id}/counts`, {
        counts: Object.entries(entered).map(([lineId, v]) => ({
          line_id: Number(lineId),
          counted_quantity: v === null || v === undefined ? null : String(v),
        })),
      });
      setSheet(res.data);
      message.success('اتحفظ العدّ');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ العدّ');
    } finally { setBusy(false); }
  };

  const postSheet = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/v1/stock-counts/${sheet.id}/post`);
      setSheet(res.data);
      message.success('اترحّل الجرد والفروق اتسوّت');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر ترحيل الجرد');
    } finally { setBusy(false); }
  };

  const cancelSheet = async (id: number) => {
    try {
      await api.post(`/api/v1/stock-counts/${id}/cancel`);
      message.success('اتلغى الكشف');
      setDetailVisible(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الكشف');
    }
  };

  const filter = useListFilter<Sheet>(sheets, {
    search: (s) => [s.document_number, s.warehouse_name, s.notes],
    filters: { status: (s, v) => s.status === v },
    dateOf: (s) => s.count_date,
  });

  const draftLines = sheet?.lines ?? [];
  const isDraft = sheet?.status === 'draft';
  // Computed live from what is typed rather than from the saved line, so the person sees the
  // difference as they enter it instead of after a round trip.
  const diffOf = (ln: Line) => {
    const v = entered[ln.id];
    if (v === null || v === undefined) return null;
    return v - Number(ln.book_quantity);
  };
  const countedNow = draftLines.filter(
    (ln) => entered[ln.id] !== null && entered[ln.id] !== undefined).length;
  const differing = draftLines.filter((ln) => {
    const d = diffOf(ln);
    return d !== null && d !== 0;
  }).length;

  return (
    <div>
      <Card
        title="دورة الجرد — عدّ وتسوية"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
              onClick={() => { setWarehouseId(undefined); setNotes(''); setOpenVisible(true); }}>
              فتح كشف جرد
            </Button>
          </Space>
        }
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="الجرد بيسوّي الفرق لحد ما الرصيد يساوي المعدود"
          description="الكشف بيفتح بأرصدة الدفاتر وقتها. لو حصلت بيعة أو صرف أثناء العدّ، التسوية بتتحسب على الرصيد الحالي مش على الفرق القديم — فالحركة دي ماتتحسبش مرتين."
        />

        <ListToolbar
          searchPlaceholder="بحث برقم الكشف أو المخزن"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset} total={sheets.length} shown={filter.filtered.length}
          filters={[{ key: 'status', placeholder: 'الحالة', span: 6, options: [
            { value: 'draft', label: 'مفتوح' },
            { value: 'posted', label: 'مترحّل' },
            { value: 'cancelled', label: 'ملغي' }] }]}
        />

        <Table
          dataSource={filter.filtered} rowKey="id" loading={loading} size="middle"
          tableLayout="fixed"
          onRow={(r) => ({ onClick: () => openDetail(r), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'مفيش كشوف جرد' }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}` }}
          columns={[
            { title: 'التاريخ', dataIndex: 'count_date', width: 110 },
            { title: 'رقم الكشف', dataIndex: 'document_number', width: 130,
              render: (v: string) => <Tag color="cyan">{v}</Tag> },
            { title: 'المخزن', dataIndex: 'warehouse_name', ellipsis: true,
              render: (v: string | null) => v ?? <Tag>كل المخازن</Tag> },
            { title: 'السطور', key: 'lines', width: 150,
              render: (_: any, r: Sheet) => `${r.counted_count} / ${r.line_count} متعدود` },
            { title: 'الحالة', dataIndex: 'status', width: 120,
              render: (v: Sheet['status']) => (v === 'posted' ? <Tag color="green">مترحّل</Tag>
                : v === 'cancelled' ? <Tag>ملغي</Tag> : <Tag color="blue">مفتوح</Tag>) },
          ]}
        />
      </Card>

      <Modal
        centered title="فتح كشف جرد" open={openVisible} onCancel={() => setOpenVisible(false)}
        onOk={openSheet} confirmLoading={opening} okText="فتح الكشف" cancelText="إلغاء"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="المخزن"
            help="سيبه فاضي والكشف هيفتح على كل المخازن النشطة (جرد عام)">
            <Select allowClear showSearch optionFilterProp="label"
              placeholder="كل المخازن النشطة"
              value={warehouseId} onChange={setWarehouseId}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          </Form.Item>
          <Form.Item label="تاريخ الجرد">
            <DatePicker style={{ width: '100%' }} value={countDate} allowClear={false}
              onChange={(d) => setCountDate(d || dayjs())} />
          </Form.Item>
          <Form.Item label="ملاحظات" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        centered width={880} destroyOnHidden
        title={`كشف الجرد ${sheet?.document_number ?? ''}`}
        open={detailVisible} onCancel={() => setDetailVisible(false)}
        footer={isDraft ? (
          <Space>
            <Popconfirm title="إلغاء الكشف؟" okText="إلغاء الكشف" cancelText="رجوع"
              onConfirm={() => sheet && cancelSheet(sheet.id)}>
              <Button danger icon={<StopOutlined />}>إلغاء الكشف</Button>
            </Popconfirm>
            <Button onClick={saveCounts} loading={busy}>حفظ العدّ</Button>
            <Popconfirm
              title="ترحيل الجرد؟"
              description="الفروق هتتسوّى في المخزن. السطور اللي مفيهاش رقم مش هتتغيّر."
              okText="ترحيل" cancelText="رجوع" onConfirm={postSheet}>
              <Button type="primary" icon={<CheckOutlined />} loading={busy}>ترحيل الجرد</Button>
            </Popconfirm>
          </Space>
        ) : (
          <Button onClick={() => setDetailVisible(false)}>إغلاق</Button>
        )}
      >
        {sheet && (
          <>
            <Space size="large" style={{ marginBottom: 12 }}>
              <Statistic title="متعدود" value={`${countedNow} / ${draftLines.length}`} />
              <Statistic title="سطور بفرق" value={differing}
                valueStyle={{ color: differing ? '#cf1322' : undefined }} />
              {sheet.status !== 'draft' && (
                <Tag color={sheet.status === 'posted' ? 'green' : 'default'}>
                  {sheet.status === 'posted' ? 'مترحّل' : 'ملغي'}
                </Tag>
              )}
            </Space>

            <Table
              size="small" rowKey="id" dataSource={draftLines} pagination={{ pageSize: 12 }}
              columns={[
                { title: 'الصنف', dataIndex: 'item_name', ellipsis: true,
                  // A difference on a line is the moment somebody wants the item's history.
                  render: (v: string | null, r: Line) => (
                    <a onClick={() => navigate(`/catalog/${r.item_id}`)}>
                      {v ?? `صنف #${r.item_id}`}
                    </a>
                  ) },
                ...(sheet.warehouse_id === null ? [{
                  title: 'المخزن', dataIndex: 'warehouse_name', width: 150,
                }] : []),
                { title: 'رصيد الدفاتر', dataIndex: 'book_quantity', width: 120,
                  render: (v: string) => qty(v) },
                {
                  title: 'المعدود', width: 140,
                  render: (_: any, ln: Line) => (isDraft ? (
                    <InputNumber
                      data-grid-col="qty" keyboard={false}
                      style={{ width: '100%' }} min={0} placeholder="—"
                      value={entered[ln.id] ?? null}
                      onChange={(v) => setEntered((p) => ({ ...p, [ln.id]: v as number | null }))}
                    />
                  ) : (ln.counted_quantity === null
                    ? <span style={{ color: '#bbb' }}>مش متعدود</span>
                    : qty(ln.counted_quantity))),
                },
                {
                  title: 'الفرق', width: 110, align: 'left' as const,
                  render: (_: any, ln: Line) => {
                    const d = isDraft ? diffOf(ln)
                      : (ln.difference === null ? null : Number(ln.difference));
                    if (d === null) return <span style={{ color: '#bbb' }}>-</span>;
                    if (d === 0) return <Tag color="green">مطابق</Tag>;
                    return (
                      <b style={{ color: d < 0 ? '#cf1322' : '#6AB42D' }}>
                        {d > 0 ? `+${qty(d)}` : qty(d)}
                      </b>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
