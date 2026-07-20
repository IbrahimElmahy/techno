import React, { useCallback, useEffect, useState } from 'react';
import {
  Table,
  Card,
  Drawer,
  Tag,
  DatePicker,
  Select,
  Space,
  Button,
  Descriptions,
  Statistic,
  Row,
  Col,
  Input,
  InputNumber,
  Radio,
  Popconfirm,
  message,
} from 'antd';
import {
  ReloadOutlined,
  MobileOutlined,
  PrinterOutlined,
  FilePdfOutlined,
  CloseCircleOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useLookup } from '../hooks/useLookup';

interface InspectionLine {
  id: number;
  item_id: number | null;
  item_name: string;
  quantity: string;
  points: string;
  total: string;
}

interface InspectionRecord {
  id: number;
  document_number: string;
  certificate_number: number | null;
  status: 'accepted' | 'rejected';
  visit_type: string;
  printed: boolean;
  visit_kind: 'technician' | 'regular';
  inspection_date: string;
  owner_name: string;
  owner_phone: string | null;
  national_id: string | null;
  owner_address: string | null;
  floor_number: string | null;
  description: string | null;
  inspection_type: string | null;
  technician_name: string | null;
  technician_phone: string | null;
  purchase_shop: string | null;
  visit_details: string | null;
  total_points: string;
  rep_user_id: number;
  items: InspectionLine[];
}

interface UserRecord {
  id: number;
  full_name: string | null;
  username: string;
}

const KIND_LABEL: Record<string, string> = {
  technician: 'معاينة فنيين',
  regular: 'زيارة عادية',
};

const fmt = (v: string) => {
  const n = Number(v);
  return Number.isNaN(n) ? v : String(n);
};

const Inspections: React.FC = () => {
  const [rows, setRows] = useState<InspectionRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<InspectionRecord | null>(null);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [repId, setRepId] = useState<number | undefined>(undefined);
  const [statusF, setStatusF] = useState<string | undefined>(undefined);
  const [printedF, setPrintedF] = useState<string | undefined>(undefined);
  const [visitTypeF, setVisitTypeF] = useState<string | undefined>(undefined);
  const [certNo, setCertNo] = useState<number | null>(null);
  const [ownerF, setOwnerF] = useState('');
  const [technicianF, setTechnicianF] = useState('');
  const [traderF, setTraderF] = useState('');
  const [visitTypeEdit, setVisitTypeEdit] = useState<string>('معاينة');
  const [saving, setSaving] = useState(false);
  const { options: visitTypeOptions } = useLookup('visit_type');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (range?.[0]) params.date_from = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.date_to = range[1].format('YYYY-MM-DD');
      if (kind) params.visit_kind = kind;
      if (repId) params.rep_id = String(repId);
      if (statusF) params.status = statusF;
      if (printedF) params.printed = printedF;
      if (visitTypeF) params.visit_type = visitTypeF;
      if (certNo) params.certificate_number = String(certNo);
      if (ownerF.trim()) params.owner = ownerF.trim();
      if (technicianF.trim()) params.technician = technicianF.trim();
      if (traderF.trim()) params.trader = traderF.trim();
      const { data } = await api.get<InspectionRecord[]>('/inspections', { params });
      setRows(data);
    } catch (e: any) {
      message.error(e?.message || 'تعذر تحميل المعاينات');
    } finally {
      setLoading(false);
    }
  }, [range, kind, repId, statusF, printedF, visitTypeF, certNo, ownerF, technicianF, traderF]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<UserRecord[]>('/users')
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]));
  }, []);

  const repName = (id: number) => {
    const u = users.find((x) => x.id === id);
    return u ? u.full_name || u.username : `#${id}`;
  };

  const openDetail = (record: InspectionRecord) => {
    setDetail(record);
    setVisitTypeEdit(record.visit_type || 'معاينة');
  };

  const patchDetail = (updated: InspectionRecord) => {
    setDetail(updated);
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const saveVisitType = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const { data } = await api.patch<InspectionRecord>(`/inspections/${detail.id}`, {
        visit_type: visitTypeEdit,
      });
      patchDetail(data);
      message.success('تم حفظ نوع الزيارة ✔');
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const rejectInspection = async () => {
    if (!detail) return;
    try {
      const { data } = await api.post<InspectionRecord>(`/inspections/${detail.id}/reject`);
      patchDetail(data);
      message.success('تم رفض المعاينة وإرجاع البضاعة لعهدة المندوب');
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'فشل الرفض');
    }
  };

  // شهادة الضمان — نافذة طباعة (الطباعة أو الحفظ PDF من نفس النافذة).
  const printCertificate = async () => {
    if (!detail) return;
    const d = detail;
    const linesHtml = d.items
      .map(
        (l) =>
          `<tr><td>${l.item_name}</td><td>${fmt(l.quantity)}</td><td>${fmt(l.points)}</td><td>${fmt(l.total)}</td></tr>`
      )
      .join('');
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>شهادة ضمان ${d.certificate_number ?? ''}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; padding: 28px; color: #12303f; }
  .frame { border: 3px double #0e4c6d; border-radius: 14px; padding: 28px; }
  .head { display: flex; justify-content: space-between; align-items: center;
          border-bottom: 2px solid #0e4c6d; padding-bottom: 14px; }
  .brand { font-size: 26px; font-weight: 800; color: #0e4c6d; }
  .sub { color: #5b7686; font-size: 13px; }
  .cert { text-align: center; margin: 18px 0 6px; font-size: 22px; font-weight: 800; }
  .no { text-align: center; color: #b26a00; font-size: 16px; font-weight: 700; }
  table.info { width: 100%; border-collapse: collapse; margin-top: 18px; }
  table.info td { padding: 7px 10px; border: 1px solid #d5e2ea; font-size: 14px; }
  table.info td.k { background: #f2f7fa; font-weight: 700; width: 150px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 16px; }
  table.items th { background: #0e4c6d; color: #fff; padding: 8px; font-size: 13px; }
  table.items td { border: 1px solid #d5e2ea; padding: 7px; text-align: center; font-size: 14px; }
  .total { margin-top: 12px; text-align: left; font-size: 16px; font-weight: 800; color: #0e4c6d; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; font-size: 13px; }
  .sig { border-top: 1px solid #98acb9; padding-top: 6px; width: 180px; text-align: center; }
  @media print { body { padding: 0; } }
</style></head><body><div class="frame">
  <div class="head">
    <div><div class="brand">تكنو ثيرم</div><div class="sub">Techno Therm — أنظمة السباكة والتغذية</div></div>
    <div class="sub">التاريخ: ${d.inspection_date}</div>
  </div>
  <div class="cert">شهادة ضمان</div>
  <div class="no">رقم الشهادة: ${d.certificate_number ?? '—'}</div>
  <table class="info">
    <tr><td class="k">اسم المالك</td><td>${d.owner_name}</td><td class="k">تليفون المالك</td><td>${d.owner_phone ?? '—'}</td></tr>
    <tr><td class="k">العنوان</td><td>${d.owner_address ?? '—'}</td><td class="k">الدور</td><td>${d.floor_number ?? '—'}</td></tr>
    <tr><td class="k">توصيف المعاينة</td><td>${d.description ?? '—'}</td><td class="k">نوع المعاينة</td><td>${d.inspection_type ?? '—'}</td></tr>
    <tr><td class="k">اسم الفني</td><td>${d.technician_name ?? '—'}</td><td class="k">تليفون الفني</td><td>${d.technician_phone ?? '—'}</td></tr>
    <tr><td class="k">المندوب</td><td>${repName(d.rep_user_id)}</td><td class="k">التاجر / محل الشراء</td><td>${d.purchase_shop ?? '—'}</td></tr>
    <tr><td class="k">نوع الزيارة</td><td>${d.visit_type}</td><td class="k">رقم المستند</td><td>${d.document_number}</td></tr>
  </table>
  <table class="items">
    <thead><tr><th>الصنف</th><th>الكمية</th><th>النقاط</th><th>الإجمالي</th></tr></thead>
    <tbody>${linesHtml || '<tr><td colspan="4">بدون أصناف</td></tr>'}</tbody>
  </table>
  <div class="total">إجمالي النقاط: ${fmt(d.total_points)}</div>
  <div class="foot">
    <div class="sig">توقيع الفني</div>
    <div class="sig">توقيع المندوب</div>
    <div class="sig">ختم الشركة</div>
  </div>
</div>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) {
      message.error('اسمح بفتح النوافذ المنبثقة للطباعة');
      return;
    }
    win.document.write(html);
    win.document.close();
    try {
      const { data } = await api.post<InspectionRecord>(`/inspections/${detail.id}/mark-printed`);
      patchDetail(data);
    } catch {
      /* الطباعة نفسها تمت — تحديث الحالة فشل فقط */
    }
  };

  const totalPoints = rows
    .filter((r) => r.status === 'accepted')
    .reduce((s, r) => s + Number(r.total_points || 0), 0);

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="عدد المعاينات" value={rows.length} prefix={<MobileOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="مقبولة"
              value={rows.filter((r) => r.status === 'accepted').length}
              valueStyle={{ color: '#2e9e6b' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="مرفوضة"
              value={rows.filter((r) => r.status === 'rejected').length}
              valueStyle={{ color: '#d64545' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="نقاط المقبولة" value={totalPoints} precision={3} />
          </Card>
        </Col>
      </Row>

      <Card title="مراجعة زيارات المناديب (المعاينات)">
        <Space wrap style={{ marginBottom: 16 }}>
          <DatePicker.RangePicker
            value={range as any}
            onChange={(v) => setRange(v as any)}
            allowClear
          />
          <InputNumber
            placeholder="رقم الشهادة"
            style={{ width: 130 }}
            value={certNo}
            onChange={(v) => setCertNo(v as number | null)}
            controls={false}
          />
          <Input
            placeholder="المالك"
            style={{ width: 140 }}
            value={ownerF}
            onChange={(e) => setOwnerF(e.target.value)}
            allowClear
            onPressEnter={load}
          />
          <Input
            placeholder="الفني"
            style={{ width: 140 }}
            value={technicianF}
            onChange={(e) => setTechnicianF(e.target.value)}
            allowClear
            onPressEnter={load}
          />
          <Input
            placeholder="التاجر"
            style={{ width: 140 }}
            value={traderF}
            onChange={(e) => setTraderF(e.target.value)}
            allowClear
            onPressEnter={load}
          />
          <Select
            placeholder="المندوب"
            style={{ width: 160 }}
            allowClear
            showSearch
            optionFilterProp="label"
            value={repId}
            onChange={setRepId}
            options={users.map((u) => ({ value: u.id, label: u.full_name || u.username }))}
          />
          <Select
            placeholder="حالة الشهادة"
            style={{ width: 130 }}
            allowClear
            value={statusF}
            onChange={setStatusF}
            options={[
              { value: 'accepted', label: 'مقبولة' },
              { value: 'rejected', label: 'مرفوضة' },
            ]}
          />
          <Select
            placeholder="حالة الطباعة"
            style={{ width: 135 }}
            allowClear
            value={printedF}
            onChange={setPrintedF}
            options={[
              { value: 'true', label: 'تم الطباعة' },
              { value: 'false', label: 'غير مطبوعة' },
            ]}
          />
          <Select
            placeholder="نوع الزيارة"
            style={{ width: 120 }}
            allowClear
            value={visitTypeF}
            onChange={setVisitTypeF}
            options={visitTypeOptions.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Select
            placeholder="نوع التسجيل"
            style={{ width: 135 }}
            allowClear
            value={kind}
            onChange={setKind}
            options={[
              { value: 'technician', label: 'معاينة فنيين' },
              { value: 'regular', label: 'زيارة عادية' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            تحديث
          </Button>
        </Space>

        <Table<InspectionRecord>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          onRow={(record) => ({ onClick: () => openDetail(record), style: { cursor: 'pointer' } })}
          pagination={{ pageSize: 20, showTotal: (t) => `إجمالي ${t}` }}
          columns={[
            {
              title: 'رقم الشهادة',
              dataIndex: 'certificate_number',
              width: 110,
              render: (v: number | null) => <b>{v ?? '—'}</b>,
            },
            { title: 'اسم المالك', dataIndex: 'owner_name' },
            { title: 'تاريخ المعاينة', dataIndex: 'inspection_date', width: 115 },
            { title: 'اسم الفني', dataIndex: 'technician_name', width: 140 },
            { title: 'المندوب', dataIndex: 'rep_user_id', width: 130, render: repName },
            {
              title: 'الحالة',
              dataIndex: 'status',
              width: 90,
              render: (v: string) =>
                v === 'rejected' ? <Tag color="red">مرفوضة</Tag> : <Tag color="green">مقبولة</Tag>,
            },
            {
              title: 'الطباعة',
              dataIndex: 'printed',
              width: 90,
              align: 'center' as const,
              render: (v: boolean) => (v ? <Tag color="blue">تم</Tag> : <Tag>غير مطبوعة</Tag>),
            },
            { title: 'التاجر', dataIndex: 'purchase_shop', width: 120 },
            {
              title: 'عدد النقاط',
              dataIndex: 'total_points',
              width: 100,
              align: 'center' as const,
              render: (v: string) => <b>{fmt(v)}</b>,
            },
            {
              title: 'نوع الزيارة',
              dataIndex: 'visit_type',
              width: 100,
              render: (v: string) => (
                <Tag color={v === 'مرمة' ? 'orange' : 'cyan'}>{v}</Tag>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={
          detail
            ? `شهادة ${detail.certificate_number ?? '—'} — ${detail.owner_name}`
            : ''
        }
        open={!!detail}
        onClose={() => setDetail(null)}
        width={620}
        extra={
          detail && (
            <Space>
              {detail.status === 'rejected' ? (
                <Tag color="red">مرفوضة</Tag>
              ) : (
                <Tag color="green">مقبولة</Tag>
              )}
              {detail.printed && <Tag color="blue">تم الطباعة</Tag>}
            </Space>
          )
        }
      >
        {detail && (
          <>
            <Card size="small" style={{ marginBottom: 16 }} title="إجراءات المراجعة">
              <Space wrap>
                <Radio.Group
                  value={visitTypeEdit}
                  onChange={(e) => setVisitTypeEdit(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  options={(visitTypeOptions.length
                    ? visitTypeOptions
                    : [
                        { value: 'معاينة', label: 'معاينة' },
                        { value: 'مرمة', label: 'مرمة' },
                      ]
                  ).map((o: any) => ({ value: o.value, label: o.label || o.value }))}
                />
                <Button
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={saveVisitType}
                  disabled={visitTypeEdit === detail.visit_type}
                >
                  حفظ نوع الزيارة
                </Button>
                <Button type="primary" icon={<PrinterOutlined />} onClick={printCertificate}>
                  طباعة شهادة ضمان
                </Button>
                <Button icon={<FilePdfOutlined />} onClick={printCertificate}>
                  تصدير PDF
                </Button>
                {detail.status !== 'rejected' && (
                  <Popconfirm
                    title="رفض المعاينة؟"
                    description="هيتم إرجاع البضاعة لعهدة المندوب — الرفض نهائي."
                    okText="رفض"
                    cancelText="إلغاء"
                    okButtonProps={{ danger: true }}
                    onConfirm={rejectInspection}
                  >
                    <Button danger icon={<CloseCircleOutlined />}>
                      رفض المعاينة
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </Card>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="رقم المستند">{detail.document_number}</Descriptions.Item>
              <Descriptions.Item label="نوع التسجيل">
                {KIND_LABEL[detail.visit_kind]}
              </Descriptions.Item>
              <Descriptions.Item label="التاريخ">{detail.inspection_date}</Descriptions.Item>
              <Descriptions.Item label="المندوب">{repName(detail.rep_user_id)}</Descriptions.Item>
              <Descriptions.Item label="تليفون المالك">
                {detail.owner_phone || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="رقم البطاقة">{detail.national_id || '—'}</Descriptions.Item>
              <Descriptions.Item label="العنوان">{detail.owner_address || '—'}</Descriptions.Item>
              <Descriptions.Item label="الدور">{detail.floor_number || '—'}</Descriptions.Item>
              <Descriptions.Item label="توصيف المعاينة">
                {detail.description || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="نوع المعاينة">
                {detail.inspection_type || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="اسم الفني">
                {detail.technician_name || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="تليفون الفني">
                {detail.technician_phone || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="التاجر / محل الشراء">
                {detail.purchase_shop || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="تفاصيل الزيارة">
                {detail.visit_details || '—'}
              </Descriptions.Item>
            </Descriptions>
            <Table<InspectionLine>
              rowKey="id"
              style={{ marginTop: 16 }}
              dataSource={detail.items}
              pagination={false}
              size="small"
              columns={[
                { title: 'الصنف', dataIndex: 'item_name' },
                { title: 'الكمية', dataIndex: 'quantity', width: 90, render: fmt },
                { title: 'النقاط', dataIndex: 'points', width: 90, render: fmt },
                { title: 'الإجمالي', dataIndex: 'total', width: 90, render: fmt },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <b>إجمالي النقاط</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} colSpan={3}>
                    <b>{fmt(detail.total_points)}</b>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </>
        )}
      </Drawer>
    </div>
  );
};

export default Inspections;
