import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Descriptions, Input, InputNumber, Modal, Popconfirm, Radio, Row, Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import {
  ReloadOutlined,
  MobileOutlined,
  PrinterOutlined,
  FilePdfOutlined,
  CloseCircleOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { printDocument } from '../print/brand';
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
      const { data } = await api.get<InspectionRecord[]>('/api/v1/inspections', { params });
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
      .get<UserRecord[]>('/api/v1/users')
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
      const { data } = await api.patch<InspectionRecord>(`/api/v1/inspections/${detail.id}`, {
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
      const { data } = await api.post<InspectionRecord>(`/api/v1/inspections/${detail.id}/reject`);
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
    printDocument(
      {
        title: 'شهادة ضمان',
        number: d.certificate_number ? `رقم ${d.certificate_number}` : d.document_number,
        meta: [
          ['اسم المالك', d.owner_name],
          ['تليفون المالك', d.owner_phone ?? '—'],
          ['العنوان', d.owner_address ?? '—'],
          ['الدور', d.floor_number ?? '—'],
          ['توصيف المعاينة', d.description ?? '—'],
          ['نوع المعاينة', d.inspection_type ?? '—'],
          ['اسم الفني', d.technician_name ?? '—'],
          ['تليفون الفني', d.technician_phone ?? '—'],
          ['المندوب', repName(d.rep_user_id)],
          ['التاجر / محل الشراء', d.purchase_shop ?? '—'],
          ['نوع الزيارة', d.visit_type],
          ['التاريخ', d.inspection_date],
        ],
        note: 'الضمان ساري وفق شروط الشركة المعتمدة ومن تاريخ التركيب.',
      },
      `<table class="grid">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>النقاط</th><th>الإجمالي</th></tr></thead>
        <tbody>${linesHtml || '<tr><td colspan="4">بدون أصناف</td></tr>'}</tbody>
      </table>
      <table class="totals">
        <tr><td>إجمالي النقاط</td><td style="text-align:left">${fmt(d.total_points)}</td></tr>
      </table>
      <div class="signatures">
        <div class="sig">توقيع الفني</div>
        <div class="sig">توقيع المندوب</div>
        <div class="sig">ختم الشركة</div>
      </div>`,
    );
    try {
      const { data } = await api.post<InspectionRecord>(`/api/v1/inspections/${detail.id}/mark-printed`);
      patchDetail(data);
    } catch {
      /* الطباعة نفسها تمت — تحديث الحالة فشل فقط */
    }
  };

  const totalPoints = rows
    .filter((r) => r.status === 'accepted')
    .reduce((s, r) => s + Number(r.total_points || 0), 0);

  /**
   * صفحة الشهادة — نفس الصفحة اللي المعاينة بتتراجع منها.
   *
   * The certificate opened in a Modal over the list: a review sheet that carried real decisions —
   * accept, reject, change the visit type — inside a popup. The list steps aside while one is
   * open, so the decision is taken on the document rather than on top of the register.
   */
  return (
    <div>
      {!detail && (
      <>
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
          pagination={{ defaultPageSize: 20, showTotal: (t) => `إجمالي ${t}` }}
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
      </>
      )}

      {detail && (
      <Card
        title={(
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />}
              onClick={() => setDetail(null)}>رجوع</Button>
            <span>{`شهادة ${detail.certificate_number ?? '—'} — ${detail.owner_name}`}</span>
          </Space>
        )}
        extra={
          (
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
        {(
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

        <div style={{ marginTop: 16, textAlign: 'left' }}>
          <Button size="large" onClick={() => setDetail(null)}>إغلاق</Button>
        </div>
      </Card>
      )}
    </div>
  );
};

export default Inspections;
