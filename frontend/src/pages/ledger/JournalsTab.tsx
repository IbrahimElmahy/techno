/**
 * جزء من شاشة الأستاذ العام — اتفصل عن `GeneralLedger.tsx` لما الملف وصل ١٤٠٠ سطر
 * وخمس تبويبات. الشاشة والمسار زي ما هما بالظبط؛ اللي اتغيّر هو إن كل تبويب بقى
 * ملف لوحده، فالتعديل في «الدفاتر» مابيفتحش «ميزان المراجعة» قدامك.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tooltip, message, Radio,
} from 'antd';
import { InputNumber } from '../../components/NumberInput';
import {
  PlusOutlined, RollbackOutlined, BookOutlined, FileAddOutlined, BankOutlined,
  ReloadOutlined, SearchOutlined, DownloadOutlined, PrinterOutlined,
  ProfileOutlined, CheckCircleOutlined, EditOutlined, StopOutlined, LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import CostCenterSplit from '../../components/CostCenterSplit';
import { api } from '../../api/client';
import { useQueryTab } from '../../components/useQueryTab';
import {
  APPEARS_IN_LABEL, CostCenter, MAIN_LEVELS, NATURE_COLOR, NATURE_LABEL, egp,
} from '../../utils/accounts';
import { showReversalConfirm } from '../../components/ConfirmationDialog';
import ListToolbar, { useListFilter, normalizeAr } from '../../components/ListToolbar';
import { useTableKeyboard } from '../../components/keyboard';
import { textColumn, numberColumn, choiceColumn, dateColumn } from '../../components/gridColumns';
import { entryTypeLabel } from '../../components/labels';
import PartyField from '../../components/PartyField';
import { TabModal } from '../../components/TabModal';
import { useTableColumns } from '../../components/ColumnSettings';
import { exportCsv } from '../../utils/exportCsv';
import DateRangeFilter from '../../components/DateRangeFilter';
import { printReport } from '../../print/reportSheet';
import { Journal } from './types';

export default function JournalsTab() {
  const [rows, setRows] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<Journal | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/v1/journals');
      setRows(data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); form.resetFields(); setDrawer(true); };
  const openEdit = (j: Journal) => {
    setEditing(j);
    form.setFieldsValue({ code: j.code, name: j.name, kind: j.kind, sort_order: j.sort_order });
    setDrawer(true);
  };

  const onSave = async (v: any) => {
    try {
      if (editing) {
        await api.patch(`/api/v1/journals/${editing.id}`,
          { name: v.name, kind: v.kind, sort_order: v.sort_order });
        message.success('اتحفظ الدفتر');
      } else {
        await api.post('/api/v1/journals', v);
        message.success('اتضاف الدفتر');
      }
      setDrawer(false); form.resetFields(); setEditing(null); load();
    } catch (err) { console.error(err); }
  };

  const toggleActive = async (j: Journal) => {
    try {
      await api.patch(`/api/v1/journals/${j.id}`, { active: !j.active });
      message.success(j.active ? 'اتقفل الدفتر' : 'اتفتح الدفتر'); load();
    } catch (err) { console.error(err); }
  };

  // التشغيل قرار مالوش رجعة: أول ما يتجزّأ قيد في الدفتر، السلسلة موجودة في القاعدة
  // والسيرفر بيرفض إطفاءها — عشان ماتفضلش موجودة وبلا حارس.
  const toggleHash = async (j: Journal) => {
    try {
      await api.patch(`/api/v1/journals/${j.id}`, { restrict_mode_hash: !j.restrict_mode_hash });
      message.success(j.restrict_mode_hash ? 'اتقفلت السلسلة' : 'اتشغّلت السلسلة'); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'مانفعش');
    }
  };

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 90,
      render: (c: string) => <Tag color="purple">{c}</Tag> },
    { title: 'الاسم', dataIndex: 'name', key: 'name' },
    { title: 'النوع', dataIndex: 'kind_label', key: 'kind_label', width: 120 },
    { title: 'الترتيب', dataIndex: 'sort_order', key: 'sort_order', width: 90 },
    { title: 'الحالة', dataIndex: 'active', key: 'active', width: 110,
      render: (a: boolean, r: Journal) => (
        <Space size={4}>
          <Tag color={a ? 'green' : 'default'}>{a ? 'شغّال' : 'مقفول'}</Tag>
          {r.is_system && <Tag color="blue">نظام</Tag>}
        </Space>
      ) },
    { title: 'سلسلة التجزئة', dataIndex: 'restrict_mode_hash', key: 'restrict_mode_hash', width: 190,
      render: (on: boolean, r: Journal) => (
        <Tooltip title={on
          ? 'شغّالة. الإطفاء بيترفض بعد ما يتجزّأ أول قيد.'
          : 'التشغيل بيدّي كل قيد جديد بصمة — ومايرجعش مسودة ولا يتحذف، ومستنده مايتعدّلش.'}>
          <Space size={6}>
            <Switch size="small" checked={!!on} onChange={() => toggleHash(r)} />
            <span style={{ color: '#888' }}>{on ? 'شغّالة' : 'مقفولة'}</span>
          </Space>
        </Tooltip>
      ) },
    { title: '', key: 'actions', width: 160,
      render: (_: any, r: Journal) => (
        <Space size={0}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>تعديل</Button>
          {/* دفتر النظام مايتقفلش — فيه كود بيوجّه قيود عليه. */}
          {!r.is_system && (
            <Button type="link" danger={r.active} onClick={() => toggleActive(r)}>
              {r.active ? 'قفل' : 'فتح'}
            </Button>
          )}
        </Space>
      ) },
  ];

  return (
    <Card
      title="دفاتر اليومية"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>دفتر جديد</Button>
        </Space>
      }
    >
      <div style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>
        كل قيد بيعيش في دفتر، والدفتر بيدّيه رقمه المتسلسل — <code>INV/2026/00001</code>.
        الترقيم بيتصفّر مع كل سنة، والسنة بتتاخد من تاريخ القيد مش من تاريخ النهارده.
        <br />
        <b>سلسلة التجزئة</b> بتدّي كل قيد بصمة محسوبة من محتواه ومن بصمة اللي قبله، فأي
        تغيير من ورا النظام بيبان في «سلامة الدفاتر». تشغيلها بيقفل الدفتر على نفسه —
        قيده مايرجعش مسودة ومايتحذفش — وبتتشغّل على الدفتر اللي فواتيره اتسلّمت بس.
      </div>
      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns}
        pagination={false} size="small" />

      <TabModal footer={null} centered width={520} destroyOnHidden
        title={editing ? `تعديل دفتر ${editing.code}` : 'دفتر جديد'}
        open={drawer} onCancel={() => { setDrawer(false); setEditing(null); }}>
        <Form form={form} layout="vertical" onFinish={onSave} requiredMark={false}
          initialValues={{ kind: 'general', sort_order: 100 }}>
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="code" label="الكود" rules={[{ required: true, message: 'أدخل الكود' }]}
                tooltip="بادئة الترقيم — حروف لاتينية قصيرة">
                <Input placeholder="MISC" disabled={!!editing} maxLength={12} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="name" label="الاسم" rules={[{ required: true, message: 'أدخل الاسم' }]}>
                <Input placeholder="قيود متنوعة" maxLength={120} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="kind" label="النوع" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'sale', label: 'مبيعات' },
                  { value: 'purchase', label: 'مشتريات' },
                  { value: 'cash', label: 'نقدية' },
                  { value: 'bank', label: 'بنك' },
                  { value: 'general', label: 'عام' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="sort_order" label="الترتيب">
                <InputNumber min={1} max={999} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" block>حفظ</Button>
        </Form>
      </TabModal>
    </Card>
  );
}
