import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Input, Row, Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import { PlusOutlined, ReloadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { TabModal } from '../components/TabModal';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';

/**
 * الأصول الثابتة والإهلاك — an asset is paid for once and consumed over years, so its cost
 * belongs to the months that used it rather than the month it was bought.
 *
 * The monthly run is a button, not a schedule, and it is safe to press twice: an asset already
 * booked for that month is skipped. The screen reports how many were skipped precisely so that a
 * second press reads as "nothing to do" instead of looking like it failed.
 */

interface Asset {
  id: number; code: string; name: string; category: string | null;
  acquisition_date: string; cost: string; salvage_value: string;
  useful_life_months: number; method: string; status: string;
  accumulated_depreciation: string; book_value: string;
  disposal_date: string | null; disposal_proceeds: string | null;
  gain_loss: string | null; notes: string | null;
  branch_id: number | null;
}

interface ScheduleRow {
  year: number; month: number; amount: string; ledger_entry_id: number | null;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const METHOD_LABELS: Record<string, string> = {
  straight_line: 'القسط الثابت',
  declining_balance: 'القسط المتناقص',
};

export default function FixedAssets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({
    name: '', cost: undefined, salvage_value: 0, useful_life_months: 60,
    method: 'straight_line', category: '', notes: '', branch_id: undefined,
  });
  const [acquired, setAcquired] = useState<Dayjs>(dayjs());
  const [saving, setSaving] = useState(false);

  const [period, setPeriod] = useState<Dayjs>(dayjs());
  const [running, setRunning] = useState(false);

  const [disposing, setDisposing] = useState<Asset | null>(null);
  const [proceeds, setProceeds] = useState<number>(0);
  const [disposalDate, setDisposalDate] = useState<Dayjs>(dayjs());

  const load = async () => {
    setLoading(true);
    try {
      const [res, br] = await Promise.all([
        api.get('/api/v1/fixed-assets'),
        api.get('/api/v1/branches'),
      ]);
      setBranches(br.data);
      setAssets(res.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Ours that used to be columns. The book value is the number an accountant opens this screen
  // for, but eight of their columns plus five of ours is a table nobody can read across.
  const expandedRow = (r: Asset) => (
    <Space size={32} wrap style={{ paddingInlineStart: 8 }}>
      <span><span style={{ color: '#888' }}>الفئة: </span>{r.category || '—'}</span>
      <span>
        <span style={{ color: '#888' }}>مجمع الإهلاك: </span>
        <span style={{ color: '#cf1322' }}>{money(r.accumulated_depreciation)}</span>
      </span>
      <span>
        <span style={{ color: '#888' }}>القيمة الدفترية: </span>
        <b style={{ color: '#0B5CA8' }}>{money(r.book_value)}</b>
      </span>
      <span><span style={{ color: '#888' }}>الطريقة: </span>{METHOD_LABELS[r.method] || r.method}</span>
      <span><span style={{ color: '#888' }}>قيمة الخردة: </span>{money(r.salvage_value)}</span>
      {r.status === 'active'
        ? <Tag color="green">قائم</Tag>
        : <Tag>متصرّف فيه {r.disposal_date ? `· ${String(r.disposal_date).slice(0, 10)}` : ''}</Tag>}
    </Space>
  );

  useEffect(() => {
    if (!detail) { setSchedule([]); return; }
    api.get(`/api/v1/fixed-assets/${detail.id}/schedule`)
      .then((r) => setSchedule(r.data || []))
      .catch(console.error);
  }, [detail]);

  const filter = useListFilter(assets, {
    search: (a) => [a.code, a.name, a.category],
    filters: {
      status: (a, v) => a.status === v,
      method: (a, v) => a.method === v,
    },
  });

  const save = async () => {
    if (!form.name || !form.cost) { message.warning('الاسم والتكلفة مطلوبين'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/fixed-assets', {
        ...form,
        cost: String(form.cost),
        salvage_value: String(form.salvage_value || 0),
        acquisition_date: acquired.format('YYYY-MM-DD'),
        category: form.category || null,
        notes: form.notes || null,
      });
      message.success('اتسجّل الأصل');
      setCreating(false);
      setForm({ name: '', cost: undefined, salvage_value: 0, useful_life_months: 60,
        method: 'straight_line', category: '', notes: '' });
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الأصل');
    } finally { setSaving(false); }
  };

  const runDepreciation = async () => {
    setRunning(true);
    try {
      const res = await api.post('/api/v1/fixed-assets/depreciation/run', {
        year: period.year(), month: period.month() + 1,
      });
      const { total, assets: count, skipped } = res.data;
      if (Number(total) === 0) {
        message.info(skipped
          ? `الشهر ده مرحّل قبل كده (${skipped} أصل) — مافيش حاجة اتغيّرت.`
          : 'مافيش إهلاك مستحق للشهر ده.');
      } else {
        message.success(`اترحّل إهلاك ${count} أصل بإجمالي ${money(total)}`);
      }
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر ترحيل الإهلاك');
    } finally { setRunning(false); }
  };

  const reverseDepreciation = async () => {
    try {
      await api.post('/api/v1/fixed-assets/depreciation/reverse', {
        year: period.year(), month: period.month() + 1,
      });
      message.success('اتعكس إهلاك الشهر');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر عكس الإهلاك');
    }
  };

  const dispose = async () => {
    if (!disposing) return;
    try {
      await api.post(`/api/v1/fixed-assets/${disposing.id}/dispose`, {
        disposal_date: disposalDate.format('YYYY-MM-DD'), proceeds: String(proceeds || 0),
      });
      message.success('اتسجّل استبعاد الأصل');
      setDisposing(null); setDetail(null); setProceeds(0); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر استبعاد الأصل');
    }
  };

  const active = assets.filter((a) => a.status === 'active');
  const totalCost = active.reduce((s, a) => s + Number(a.cost), 0);
  const totalBook = active.reduce((s, a) => s + Number(a.book_value), 0);

  /**
   * صفحة الأصل — واحدة، سواء بتسجّل أصل أو بتقرا واحد.
   *
   * Registered in a Modal and read in a Drawer: two shapes for one record. The list steps aside
   * while one is open.
   */
  const docOpen = creating || !!detail;

  const columns: ColumnsType<Asset> = [
    // Their eight, in their order: `رقم · تاريخ البداية · الاسم · الفرع · فترة الاهلاك ·
    // نسبه الاهلاك · التكلفه · وصف`. Ours moved into the expanded row.
    { title: 'رقم', dataIndex: 'code', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'تاريخ البداية', dataIndex: 'acquisition_date', width: 120,
      render: (d: string) => String(d).slice(0, 10) },
    { title: 'الاسم', dataIndex: 'name', ellipsis: true,
      render: (v: string, r: Asset) => (
        <Space size={4}>
          <b>{v}</b>
          {r.status !== 'active' && <Tag>متصرّف فيه</Tag>}
        </Space>
      ) },
    { title: 'الفرع', dataIndex: 'branch_id', ellipsis: true,
      render: (id: number | null) => branches.find((b) => b.id === id)?.name || '-' },
    { title: 'فترة الاهلاك', dataIndex: 'useful_life_months', width: 110,
      render: (m: number) => `${m} شهر` },
    // Derived, not stored. Their form asks for the rate AND the period, which lets the two
    // contradict each other; one is the other, so we keep the period and show the rate.
    { title: 'نسبه الاهلاك', key: 'rate', width: 110,
      render: (_: any, r: Asset) => (r.useful_life_months
        ? `${(1200 / r.useful_life_months).toFixed(2)}%` : '-') },
    { title: 'التكلفه', dataIndex: 'cost', align: 'left', width: 130,
      render: (v: string) => money(v) },
    { title: 'وصف', dataIndex: 'notes', ellipsis: true,
      render: (v: string | null) => v || '-' },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('fixed-assets', columns);

  return (
    <>
    {!docOpen && (
    <Card
      title="الاصول الثابتة"
      extra={(
        <Space>
          {tableCols.control}
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
            onClick={() => setCreating(true)}>أصل جديد</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      <Card size="small" style={{ marginBottom: 12 }} title="ترحيل إهلاك الشهر">
        <Space wrap align="center">
          <DatePicker picker="month" value={period} allowClear={false}
            onChange={(v) => v && setPeriod(v)} />
          <Button type="primary" loading={running} onClick={runDepreciation}>
            ترحيل الإهلاك
          </Button>
          <Popconfirm title="عكس إهلاك الشهر؟"
            description="هيتعمل قيد عكسي والشهر يرجع متاح للترحيل تاني."
            onConfirm={reverseDepreciation} okText="عكس" cancelText="إلغاء">
            <Button danger>عكس الشهر</Button>
          </Popconfirm>
          <span style={{ color: '#888' }}>
            آمن تضغط أكتر من مرة — الأصل المرحّل للشهر ده بيتخطّى، فالمصروف ما بيتضاعفش.
          </span>
        </Space>
      </Card>

      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={8}>
          <Card size="small"><Statistic title="أصول قائمة" value={active.length} /></Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="إجمالي التكلفة" value={money(totalCost)} />
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="القيمة الدفترية" value={money(totalBook)}
              valueStyle={{ color: '#0B5CA8' }} />
          </Card>
        </Col>
      </Row>

      <ListToolbar
        searchPlaceholder="بحث بالكود أو الاسم أو الفئة"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset} total={assets.length} shown={filter.filtered.length}
        filters={[
          { key: 'status', placeholder: 'الحالة', options: [
            { value: 'active', label: 'قائم' }, { value: 'disposed', label: 'متصرّف فيه' }] },
          { key: 'method', placeholder: 'طريقة الإهلاك', options: [
            { value: 'straight_line', label: 'القسط الثابت' },
            { value: 'declining_balance', label: 'القسط المتناقص' }] },
        ]}
      />

      <Table<Asset>
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد أصول مسجّلة' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        tableLayout="fixed"
        expandable={{ expandedRowRender: expandedRow }}
        columns={tableCols.columns}
      />
    </Card>
    )}

      {creating && (
      <Card title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setCreating(false)}>رجوع</Button>
          <span>تسجيل أصل ثابت</span>
        </Space>
      )}>
        <Row gutter={[8, 8]}>
          <Col xs={24} md={12}>
            <Input placeholder="اسم الأصل" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Col>
          <Col xs={24} md={12}>
            <Input placeholder="الفئة (مباني، سيارات، أجهزة…)" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Col>
          <Col xs={24} md={12}>
            <DatePicker style={{ width: '100%' }} value={acquired} allowClear={false}
              onChange={(v) => v && setAcquired(v)} placeholder="تاريخ الشراء" />
          </Col>
          <Col xs={24} md={12}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="التكلفة"
              value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
          </Col>
          <Col xs={24} md={12}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="القيمة التخريدية"
              value={form.salvage_value}
              onChange={(v) => setForm({ ...form, salvage_value: v })} />
          </Col>
          <Col xs={24} md={12}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="العمر الإنتاجي (شهور)"
              value={form.useful_life_months}
              onChange={(v) => setForm({ ...form, useful_life_months: v })} />
          </Col>
          <Col xs={24} md={12}>
            <Select style={{ width: '100%' }} value={form.method}
              onChange={(v) => setForm({ ...form, method: v })}
              options={[
                { value: 'straight_line', label: 'القسط الثابت' },
                { value: 'declining_balance', label: 'القسط المتناقص' },
              ]} />
          </Col>
          {/* الفرع — their fourth column. The API has accepted it since the feature shipped; the
              form never asked, so it was always null and the column had nothing to show. */}
          <Col xs={24} md={12}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="الفرع"
              value={form.branch_id}
              onChange={(v) => setForm({ ...form, branch_id: v })}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          </Col>
          <Col xs={24}>
            <Input.TextArea rows={2} placeholder="ملاحظات" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Col>
        </Row>
        <Alert type="info" showIcon style={{ marginTop: 12 }}
          message="القيمة التخريدية ما بتتهلكش أبداً — الأصل بينزل لحد عندها ويقف." />

        <div style={{
          marginTop: 16, padding: 16, borderRadius: 10,
          background: '#f6faf3', border: '1px solid #e6efe3',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <Button type="primary" size="large" loading={saving} onClick={save}>حفظ</Button>
          <Button size="large" onClick={() => setCreating(false)}>إلغاء</Button>
        </div>
      </Card>
      )}

      {/* الاستبعاد يفضل نافذة: ده قرار على أصل مفتوح قدامك، مش مستند لوحده. */}
      <TabModal
        open={!!disposing} onCancel={() => setDisposing(null)} onOk={dispose}
        title={`استبعاد ${disposing?.name || ''}`} okText="تسجيل الاستبعاد" cancelText="إلغاء"
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <DatePicker style={{ width: '100%' }} value={disposalDate} allowClear={false}
            onChange={(v) => v && setDisposalDate(v)} placeholder="تاريخ الاستبعاد" />
          <InputNumber style={{ width: '100%' }} min={0} placeholder="قيمة البيع"
            value={proceeds} onChange={(v) => setProceeds(v as number)} />
          {disposing && (
            <Alert
              type="info" showIcon
              message={`القيمة الدفترية دلوقتي ${money(disposing.book_value)}`}
              description={`الفرق بين قيمة البيع والقيمة الدفترية هو الربح أو الخسارة، وبيترحّل
                لحسابه تلقائياً.`}
            />
          )}
        </Space>
      </TabModal>

      {/* الأصل مفتوح — نفس الصفحة. Its cost and its life are what every past depreciation entry
          was computed from, so they are not editable: the way an asset leaves the books is
          استبعاد, which posts the disposal instead of rewriting the history. */}
      {detail && (
      <Card
        title={(
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />}
              onClick={() => setDetail(null)}>رجوع</Button>
            <span>{detail.name}</span>
          </Space>
        )}
        extra={detail.status === 'active' && (
          <Button danger onClick={() => { setDisposing(detail); setProceeds(0); }}>
            استبعاد الأصل
          </Button>
        )}
      >
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="الكود">{detail.code}</Descriptions.Item>
              <Descriptions.Item label="الفئة">{detail.category || '-'}</Descriptions.Item>
              <Descriptions.Item label="تاريخ الشراء">
                {String(detail.acquisition_date).slice(0, 10)}
              </Descriptions.Item>
              <Descriptions.Item label="التكلفة">{money(detail.cost)}</Descriptions.Item>
              <Descriptions.Item label="القيمة التخريدية">
                {money(detail.salvage_value)}
              </Descriptions.Item>
              <Descriptions.Item label="العمر الإنتاجي">
                {detail.useful_life_months} شهر
              </Descriptions.Item>
              <Descriptions.Item label="الطريقة">
                {METHOD_LABELS[detail.method] || detail.method}
              </Descriptions.Item>
              <Descriptions.Item label="مجمع الإهلاك">
                {money(detail.accumulated_depreciation)}
              </Descriptions.Item>
              <Descriptions.Item label="القيمة الدفترية">
                <b>{money(detail.book_value)}</b>
              </Descriptions.Item>
              {detail.status === 'disposed' && (
                <Descriptions.Item label="نتيجة الاستبعاد">
                  <span style={{ color: Number(detail.gain_loss) < 0 ? '#cf1322' : '#6AB42D' }}>
                    {money(detail.gain_loss)}
                  </span>{' '}
                  (بيع بـ {money(detail.disposal_proceeds)} يوم{' '}
                  {String(detail.disposal_date).slice(0, 10)})
                </Descriptions.Item>
              )}
            </Descriptions>

            <Table<ScheduleRow>
              rowKey={(r) => `${r.year}-${r.month}`} size="small" dataSource={schedule}
              locale={{ emptyText: 'لسه مافيش إهلاك مرحّل' }}
              pagination={{ defaultPageSize: 12 }}
              columns={[
                { title: 'الشهر', render: (_: any, r) => `${r.year}-${String(r.month).padStart(2, '0')}` },
                { title: 'قيمة الإهلاك', dataIndex: 'amount',
                  render: (v: string) => money(v) },
                { title: 'القيد', dataIndex: 'ledger_entry_id',
                  render: (v: number | null) => (v ? <Tag>#{v}</Tag> : '-') },
              ]}
            />
          </>
        )}

        <div style={{ marginTop: 16, textAlign: 'left' }}>
          <Button size="large" onClick={() => setDetail(null)}>إغلاق</Button>
        </div>
      </Card>
      )}
    </>
  );
}
