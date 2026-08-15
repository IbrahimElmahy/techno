import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Divider, Input, InputNumber, Row, Select, Space,
  Statistic, Table, Tabs, Tag, message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import { TabModal } from '../components/TabModal';

/**
 * إعدادات المرتبات — البنود، والشرايح، وأرقام المسير.
 *
 * **الشرايح بتشحن فاضية.** No Egyptian rate is written into this system: the first set is entered
 * by the client's accountant and confirmed by them. Numbers invented by the software would travel
 * into a payroll that posts to the ledger, and that is not a responsibility it can carry.
 *
 * The live calculator below the brackets exists so the person entering them can check their work
 * before anything is posted — type a salary, see the tax, compare it to the table in front of you.
 *
 * A version that a posted payroll has used is FROZEN and says so. Correcting a rate afterwards
 * would silently rewrite every month behind it, and the ledger entries underneath cannot be edited
 * to match.
 */

interface Bracket {
  sequence: number;
  from_amount: string;
  to_amount: string | null;
  rate_pct: string;
  fixed_amount: string;
}

interface Version {
  id: number;
  scheme: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  annual_exemption: string | null;
  employee_pct: string | null;
  employer_pct: string | null;
  min_base: string | null;
  max_base: string | null;
  locked: boolean;
  active: boolean;
  brackets: Bracket[];
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * نفس حساب الضريبة اللي على السيرفر — للمعاينة الحيّة بس.
 *
 * Deliberately a mirror, not the authority: it lets somebody check the brackets they just typed
 * without saving anything. Every figure that reaches a payslip is computed server-side.
 */
export function previewTax(taxable: number, brackets: Bracket[], exemption = 0): number {
  const base = taxable - exemption;
  if (base <= 0 || !brackets.length) return 0;
  let total = 0;
  const ordered = [...brackets].sort((a, b) => Number(a.from_amount) - Number(b.from_amount));
  for (const band of ordered) {
    const lower = Number(band.from_amount);
    if (base <= lower) break;
    const upper = band.to_amount === null ? base : Number(band.to_amount);
    const width = Math.min(base, upper) - lower;
    if (width <= 0) continue;
    total += (width * Number(band.rate_pct)) / 100 + Number(band.fixed_amount || 0);
  }
  return Math.round(total * 100) / 100;
}

/** بيتأكد إن الشرايح متصلة قبل ما تتبعت — نفس قاعدة السيرفر، بس بتقولها بدري. */
export function bracketGap(brackets: Bracket[]): string | null {
  const ordered = [...brackets].sort((a, b) => Number(a.from_amount) - Number(b.from_amount));
  let top: number | null = null;
  for (const [i, band] of ordered.entries()) {
    const lower = Number(band.from_amount);
    if (top !== null && lower !== top) {
      return `الشريحة ${i + 1} بتبدأ من ${lower} والسابقة انتهت عند ${top}`;
    }
    if (band.to_amount !== null && Number(band.to_amount) <= lower) {
      return `الشريحة ${i + 1} نهايتها قبل بدايتها`;
    }
    top = band.to_amount === null ? null : Number(band.to_amount);
  }
  return null;
}

const emptyBracket = (): Bracket => ({
  sequence: 0, from_amount: '0', to_amount: null, rate_pct: '0', fixed_amount: '0',
});

export default function PayrollSettings() {
  const [tab, setTab] = useQueryTab('schemes', 'tab');
  const [versions, setVersions] = useState<Version[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<Version | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    scheme: 'income_tax', name: '', effective_from: dayjs().startOf('year') as Dayjs,
    annual_exemption: undefined, employee_pct: undefined, employer_pct: undefined,
    min_base: undefined, max_base: undefined,
  });
  const [bands, setBands] = useState<Bracket[]>([emptyBracket()]);
  const [trial, setTrial] = useState<number>(120000);

  const [compOpen, setCompOpen] = useState(false);
  const [compForm, setCompForm] = useState<any>({
    name: '', kind: 'earning', taxable: true, insurable: false,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [v, c, s] = await Promise.all([
        api.get('/api/v1/hr/payroll/schemes'),
        api.get('/api/v1/hr/payroll/components'),
        api.get('/api/v1/hr/payroll/settings'),
      ]);
      setVersions(v.data || []);
      setComponents(c.data || []);
      setSettings(s.data || null);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const fail = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    message.error(detail?.message || fallback, detail?.code === 'locked' ? 8 : 4);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...form, name: '', effective_from: dayjs().startOf('year') });
    setBands([emptyBracket()]);
    setOpen(true);
  };

  const openEdit = (v: Version) => {
    if (v.locked) {
      message.warning('الإصدار ده اتقفل لأن مرتب مرحّل استعمله — اعمل إصدار جديد.', 8);
      return;
    }
    setEditing(v);
    setForm({
      scheme: v.scheme, name: v.name, effective_from: dayjs(v.effective_from),
      annual_exemption: v.annual_exemption ? Number(v.annual_exemption) : undefined,
      employee_pct: v.employee_pct ? Number(v.employee_pct) : undefined,
      employer_pct: v.employer_pct ? Number(v.employer_pct) : undefined,
      min_base: v.min_base ? Number(v.min_base) : undefined,
      max_base: v.max_base ? Number(v.max_base) : undefined,
    });
    setBands(v.brackets.length ? v.brackets : [emptyBracket()]);
    setOpen(true);
  };

  const gap = useMemo(() => (form.scheme === 'income_tax' ? bracketGap(bands) : null), [bands, form.scheme]);

  const save = async () => {
    if (!form.name.trim()) { message.warning('اكتب اسم الإصدار'); return; }
    if (gap) { message.warning(gap); return; }
    const payload: any = {
      scheme: form.scheme,
      name: form.name.trim(),
      effective_from: form.effective_from.format('YYYY-MM-DD'),
      annual_exemption: form.annual_exemption ?? null,
      employee_pct: form.employee_pct ?? null,
      employer_pct: form.employer_pct ?? null,
      min_base: form.min_base ?? null,
      max_base: form.max_base ?? null,
      brackets: form.scheme === 'income_tax'
        ? bands.map((b) => ({
          from_amount: String(b.from_amount || 0),
          to_amount: b.to_amount === null || b.to_amount === '' ? null : String(b.to_amount),
          rate_pct: String(b.rate_pct || 0),
          fixed_amount: String(b.fixed_amount || 0),
        }))
        : [],
    };
    try {
      if (editing) {
        await api.patch(`/api/v1/hr/payroll/schemes/${editing.id}`, payload);
      } else {
        await api.post('/api/v1/hr/payroll/schemes', payload);
      }
      message.success('اتحفظ');
      setOpen(false);
      load();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const saveComponent = async () => {
    if (!compForm.name.trim()) { message.warning('اكتب اسم البند'); return; }
    try {
      await api.post('/api/v1/hr/payroll/components', {
        ...compForm, name: compForm.name.trim(),
      });
      message.success('اتضاف');
      setCompOpen(false);
      setCompForm({ ...compForm, name: '' });
      load();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const saveSettings = async (patch: any) => {
    try {
      const res = await api.patch('/api/v1/hr/payroll/settings', patch);
      setSettings(res.data);
      message.success('اتحفظ');
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const noSchemes = !versions.length;

  return (
    <Card
      title={<span><SettingOutlined /> إعدادات المرتبات</span>}
      extra={<Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>}
    >
      {noSchemes ? (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="لسه محدّدش شرايح"
          description={'النظام مابيشحنش بأي نسب — أول إصدار بيكتبه محاسب الشركة ويأكّده. '
            + 'من غيره المسير هيحسب الضريبة والتأمينات صفر.'}
        />
      ) : null}

      <Tabs
        activeKey={tab} onChange={setTab}
        items={[
          {
            key: 'schemes',
            label: 'الشرايح والنسب',
            children: (
              <>
                <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
                  onClick={openNew} style={{ marginBottom: 10 }}>إصدار جديد</Button>
                <Table
                  rowKey="id" size="small" loading={loading} dataSource={versions}
                  pagination={false}
                  onRow={(r) => ({ onDoubleClick: () => openEdit(r) })}
                  columns={[
                    { title: 'النوع', dataIndex: 'scheme', width: 150,
                      render: (v: string) => (v === 'income_tax'
                        ? <Tag color="blue">ضريبة كسب عمل</Tag>
                        : <Tag color="purple">تأمينات اجتماعية</Tag>) },
                    { title: 'الإصدار', dataIndex: 'name' },
                    { title: 'من تاريخ', dataIndex: 'effective_from', width: 120 },
                    { title: 'الشرايح', dataIndex: 'brackets', width: 90,
                      render: (b: Bracket[]) => (b.length ? b.length : '—') },
                    { title: 'حصة الموظف', dataIndex: 'employee_pct', width: 110,
                      render: (v: string | null) => (v ? `${Number(v)}%` : '—') },
                    { title: 'حصة الشركة', dataIndex: 'employer_pct', width: 110,
                      render: (v: string | null) => (v ? `${Number(v)}%` : '—') },
                    { title: '', dataIndex: 'locked', width: 130,
                      render: (v: boolean, r: Version) => (v
                        ? <Tag color="default" title="مرتب مرحّل استعمله">🔒 متجمّد</Tag>
                        : <Button size="small" onClick={() => openEdit(r)}>تعديل</Button>) },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'components',
            label: 'بنود الراتب',
            children: (
              <>
                <Button icon={<PlusOutlined />} onClick={() => setCompOpen(true)}
                  style={{ marginBottom: 10 }}>بند جديد</Button>
                <Table
                  rowKey="id" size="small" dataSource={components} pagination={false}
                  columns={[
                    { title: 'الكود', dataIndex: 'code', width: 90 },
                    { title: 'البند', dataIndex: 'name' },
                    { title: 'النوع', dataIndex: 'kind', width: 110,
                      render: (v: string) => (v === 'earning'
                        ? <Tag color="green">استحقاق</Tag> : <Tag color="red">استقطاع</Tag>) },
                    { title: 'داخل وعاء الضريبة', dataIndex: 'taxable', width: 150,
                      render: (v: boolean) => (v ? 'أيوه' : 'لأ') },
                    { title: 'داخل الأجر التأميني', dataIndex: 'insurable', width: 160,
                      render: (v: boolean) => (v ? 'أيوه' : 'لأ') },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'rules',
            label: 'أرقام المسير',
            children: settings ? (
              <Row gutter={[12, 12]} style={{ maxWidth: 640 }}>
                <Col span={12}>
                  <div style={{ marginBottom: 4 }}>أيام الشهر</div>
                  <InputNumber style={{ width: '100%' }} min={1} max={31}
                    value={settings.days_per_month}
                    onChange={(v) => saveSettings({ days_per_month: v })} />
                  <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                    «تلاتين» ولا «أيام الشهر الفعلية» — الاتنين مستعملين، ومحدش منهم غلط.
                  </div>
                </Col>
                <Col span={12}>
                  <div style={{ marginBottom: 4 }}>ساعات اليوم</div>
                  <InputNumber style={{ width: '100%' }} min={1} max={24}
                    value={Number(settings.hours_per_day)}
                    onChange={(v) => saveSettings({ hours_per_day: String(v) })} />
                </Col>
                <Col span={12}>
                  <div style={{ marginBottom: 4 }}>نسبة الإضافي العادي ٪</div>
                  <InputNumber style={{ width: '100%' }} min={0}
                    value={Number(settings.overtime_normal_pct)}
                    onChange={(v) => saveSettings({ overtime_normal_pct: String(v) })} />
                </Col>
                <Col span={12}>
                  <div style={{ marginBottom: 4 }}>نسبة إضافي العطلات ٪</div>
                  <InputNumber style={{ width: '100%' }} min={0}
                    value={Number(settings.overtime_holiday_pct)}
                    onChange={(v) => saveSettings({ overtime_holiday_pct: String(v) })} />
                </Col>
                <Col span={24}>
                  <Alert
                    type="info" showIcon
                    message={`سياسة التأخير: ${settings.late_policy === 'none'
                      ? 'بيتسجّل ومابيتخصمش' : settings.late_policy}`}
                    description="الافتراضي مابيخصمش. خصم صامت على التأخير أسرع طريقة الموديول يخسر ثقة الناس في أول شهر."
                  />
                </Col>
              </Row>
            ) : null,
          },
        ]}
      />

      <TabModal
        open={open} width={860}
        title={editing ? `تعديل «${editing.name}»` : 'إصدار شرايح جديد'}
        onCancel={() => setOpen(false)} onOk={save} okText="حفظ" cancelText="إلغاء"
        destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>النوع</div>
            <Select style={{ width: '100%' }} value={form.scheme} disabled={!!editing}
              onChange={(v) => setForm({ ...form, scheme: v })}
              options={[
                { value: 'income_tax', label: 'ضريبة كسب عمل' },
                { value: 'social_insurance', label: 'تأمينات اجتماعية' },
              ]} />
          </Col>
          <Col span={9}>
            <div style={{ marginBottom: 4 }}>اسم الإصدار *</div>
            <Input value={form.name} placeholder="قانون ٢٠٢٦"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Col>
          <Col span={7}>
            <div style={{ marginBottom: 4 }}>ساري من</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" disabled={!!editing}
              value={form.effective_from}
              onChange={(v) => setForm({ ...form, effective_from: v || dayjs() })} />
          </Col>

          {form.scheme === 'social_insurance' ? (
            <>
              <Col span={6}>
                <div style={{ marginBottom: 4 }}>حصة الموظف ٪</div>
                <InputNumber style={{ width: '100%' }} value={form.employee_pct}
                  onChange={(v) => setForm({ ...form, employee_pct: v })} />
              </Col>
              <Col span={6}>
                <div style={{ marginBottom: 4 }}>حصة الشركة ٪</div>
                <InputNumber style={{ width: '100%' }} value={form.employer_pct}
                  onChange={(v) => setForm({ ...form, employer_pct: v })} />
              </Col>
              <Col span={6}>
                <div style={{ marginBottom: 4 }}>الحد الأدنى للأجر</div>
                <InputNumber style={{ width: '100%' }} value={form.min_base}
                  onChange={(v) => setForm({ ...form, min_base: v })} />
              </Col>
              <Col span={6}>
                <div style={{ marginBottom: 4 }}>الحد الأقصى للأجر</div>
                <InputNumber style={{ width: '100%' }} value={form.max_base}
                  onChange={(v) => setForm({ ...form, max_base: v })} />
                <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                  الأجر فوق السقف بيدفع على السقف.
                </div>
              </Col>
            </>
          ) : (
            <>
              <Col span={8}>
                <div style={{ marginBottom: 4 }}>الإعفاء الشخصي السنوي</div>
                <InputNumber style={{ width: '100%' }} value={form.annual_exemption}
                  onChange={(v) => setForm({ ...form, annual_exemption: v })} />
              </Col>
              <Col span={24}>
                <Divider style={{ margin: '6px 0' }}>الشرايح</Divider>
                {gap ? <Alert type="error" showIcon message={gap} style={{ marginBottom: 8 }} /> : null}
                {bands.map((band, i) => (
                  <Row gutter={[6, 6]} key={i} style={{ marginBottom: 6 }}>
                    <Col span={6}>
                      <InputNumber style={{ width: '100%' }} addonBefore="من"
                        value={Number(band.from_amount)}
                        onChange={(v) => {
                          const next = [...bands];
                          next[i] = { ...band, from_amount: String(v ?? 0) };
                          setBands(next);
                        }} />
                    </Col>
                    <Col span={6}>
                      <InputNumber style={{ width: '100%' }} addonBefore="إلى"
                        placeholder="وما زاد"
                        value={band.to_amount === null ? null : Number(band.to_amount)}
                        onChange={(v) => {
                          const next = [...bands];
                          next[i] = { ...band, to_amount: v === null ? null : String(v) };
                          setBands(next);
                        }} />
                    </Col>
                    <Col span={5}>
                      <InputNumber style={{ width: '100%' }} addonAfter="٪"
                        value={Number(band.rate_pct)}
                        onChange={(v) => {
                          const next = [...bands];
                          next[i] = { ...band, rate_pct: String(v ?? 0) };
                          setBands(next);
                        }} />
                    </Col>
                    <Col span={7}>
                      <Space>
                        <Button danger size="small" disabled={bands.length === 1}
                          onClick={() => setBands(bands.filter((_, j) => j !== i))}>حذف</Button>
                        {i === bands.length - 1 ? (
                          <Button size="small" onClick={() => setBands([...bands, {
                            ...emptyBracket(),
                            from_amount: band.to_amount ?? band.from_amount,
                          }])}>+ شريحة</Button>
                        ) : null}
                      </Space>
                    </Col>
                  </Row>
                ))}
              </Col>
              <Col span={24}>
                <Divider style={{ margin: '6px 0' }}>تجربة</Divider>
                <Space align="end" wrap>
                  <div>
                    <div style={{ marginBottom: 4 }}>وعاء سنوي تجريبي</div>
                    <InputNumber style={{ width: 180 }} value={trial}
                      onChange={(v) => setTrial(Number(v) || 0)} />
                  </div>
                  <Statistic title="الضريبة السنوية"
                    value={money(previewTax(trial, bands, form.annual_exemption || 0))} />
                  <Statistic title="شهرياً"
                    value={money(previewTax(trial, bands, form.annual_exemption || 0) / 12)} />
                </Space>
                <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
                  المعاينة دي عشان تراجع الشرايح قبل ما تحفظ — كل رقم بيوصل قسيمة راتب بيتحسب
                  على السيرفر.
                </div>
              </Col>
            </>
          )}
        </Row>
      </TabModal>

      <TabModal
        open={compOpen} title="بند راتب جديد" onCancel={() => setCompOpen(false)}
        onOk={saveComponent} okText="حفظ" cancelText="إلغاء" destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={14}>
            <div style={{ marginBottom: 4 }}>الاسم *</div>
            <Input value={compForm.name} autoFocus
              onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} />
          </Col>
          <Col span={10}>
            <div style={{ marginBottom: 4 }}>النوع</div>
            <Select style={{ width: '100%' }} value={compForm.kind}
              onChange={(v) => setCompForm({ ...compForm, kind: v })}
              options={[
                { value: 'earning', label: 'استحقاق' },
                { value: 'deduction', label: 'استقطاع' },
              ]} />
          </Col>
          <Col span={12}>
            <Select style={{ width: '100%' }} value={compForm.taxable}
              onChange={(v) => setCompForm({ ...compForm, taxable: v })}
              options={[
                { value: true, label: 'داخل وعاء الضريبة' },
                { value: false, label: 'خارج وعاء الضريبة' },
              ]} />
          </Col>
          <Col span={12}>
            <Select style={{ width: '100%' }} value={compForm.insurable}
              onChange={(v) => setCompForm({ ...compForm, insurable: v })}
              options={[
                { value: false, label: 'خارج الأجر التأميني' },
                { value: true, label: 'داخل الأجر التأميني' },
              ]} />
          </Col>
          <Col span={24}>
            <div style={{ color: '#888', fontSize: 12 }}>
              الاتنين سؤالين مختلفين: بدل انتقالات ممكن يكون برّه الأجر التأميني وجوه وعاء الضريبة.
            </div>
          </Col>
        </Row>
      </TabModal>
    </Card>
  );
}
