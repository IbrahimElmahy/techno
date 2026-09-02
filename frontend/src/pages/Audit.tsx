import React, { useEffect, useState } from 'react';
import { Table, Card, Tag, Button, Descriptions, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import DocumentAuditModal from '../components/DocumentAuditModal';
import { useTableColumns } from '../components/ColumnSettings';

interface AuditLog {
  id: number;
  actor_user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  created_at: string;
}

/**
 * أسماء العمليات.
 *
 * السجل بقى فيه نوعين من الأسماء: اللي الخدمات بتكتبه بإيدها (`sale.edit`) واللي الميدل
 * وير بتشتقه من المسار (`transfers.self-approve`). الاتنين شكلهم واحد — `مورد.فعل` —
 * فالترجمة بتتم على كل جزء لوحده وبتتلمّ، بدل جدول بيحاول يعدّ كل تركيبة ممكنة.
 */
const ACTION_LABEL: Record<string, string> = {
  login: 'دخول',
  login_failed: 'فشل الدخول',
  logout: 'خروج',
  create: 'إنشاء',
  update: 'تعديل',
  edit: 'تعديل',
  delete: 'حذف',
  reverse: 'عكس',
  post: 'ترحيل',
  approve: 'اعتماد',
  'self-approve': 'اعتماد ذاتي',
  reject: 'رفض',
  cancel: 'إلغاء',
  lines: 'سطور',
  returns: 'مرتجع',
  redeem: 'استبدال',
  print: 'طباعة',
};

const ENTITY_LABEL: Record<string, string> = {
  user: 'مستخدم',
  invoice: 'فاتورة',
  voucher: 'سند',
  account: 'حساب',
  item: 'صنف',
  customer: 'عميل',
  supplier: 'مورد',
  treasury: 'خزينة',
  branch: 'فرع',
  warehouse: 'مخزن',
  journal_entry: 'قيد يومية',
  cost_center: 'مركز تكلفة',
  employee: 'موظف',
  sales: 'فواتير المبيعات',
  sales_invoice: 'فاتورة بيع',
  sales_return: 'مرتجع مبيعات',
  purchases: 'المشتريات',
  transfers: 'أذون التحويل',
  vouchers: 'السندات',
  stock: 'المخزون',
  users: 'المستخدمين',
  catalog: 'الأصناف',
  customers: 'العملاء',
  suppliers: 'الموردين',
  coupons: 'الكوبونات',
  coupon_receipts: 'استلام كوبونات',
  accounting: 'المحاسبة',
  settings: 'الإعدادات',
  reservations: 'الحجوزات',
  orders: 'الطلبات',
  inspections: 'المعاينات',
  payroll: 'الرواتب',
};

const seg = (x: string) => ACTION_LABEL[x] ?? ENTITY_LABEL[x] ?? x;
const actionLabel = (a: string) =>
  (ACTION_LABEL[a] ?? (a.includes('.') ? a.split('.').map(seg).reverse().join(' — ') : a));
const entityLabel = (e: string | null) => (e ? ENTITY_LABEL[e] ?? e : '-');

/** الطلب المرفوض بيتسجّل زي الناجح — وده أهم صف في الشاشة، فلازم يبان من غير ما يتفتح. */
const outcomeOf = (l: { after: Record<string, any> | null }) => {
  const st = l.after?.src === 'http' ? l.after?.status : undefined;
  if (typeof st !== 'number') return null;
  return { status: st, ok: st < 400 };
};

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/audit');
      setLogs(res.data);   // السيرفر بيرجّع الأحدث الأول
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/api/v1/users');
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchUsers();
  }, []);

  const getActorName = (userId: number | null) => {
    if (!userId) return 'النظام';
    const user = users.find((u) => u.id === userId);
    return user ? `${user.full_name} (${user.username})` : `مستخدم #${userId}`;
  };

  const filter = useListFilter(logs, {
    search: (l) => [l.action, l.entity_type, actionLabel(l.action),
      l.entity_type ? entityLabel(l.entity_type) : '', l.entity_id, getActorName(l.actor_user_id)],
    filters: {
      action: (l, v) => l.action === v,
      entity_type: (l, v) => l.entity_type === v,
      actor_user_id: (l, v) => (v === 0 ? l.actor_user_id === null : l.actor_user_id === v),
    },
    dateOf: (l) => l.created_at,
  });

  const actionOptions = Array.from(new Set(logs.map((l) => l.action).filter(Boolean)))
    .map((a) => ({ value: a, label: actionLabel(a) }));
  const entityOptions = Array.from(new Set(logs.map((l) => l.entity_type).filter(Boolean)))
    .map((e) => ({ value: e as string, label: entityLabel(e as string) }));

  const columns = [
    {
      title: 'التاريخ والوقت',
      dataIndex: 'created_at',
      key: 'created_at',
      ...dateColumn<AuditLog>((r) => r.created_at),
      render: (dateStr: string) => new Date(dateStr).toLocaleString('ar-EG'),
      width: '20%',
    },
    {
      title: 'العملية المسجلة',
      dataIndex: 'action',
      key: 'action',
      ...textColumn(logs, (r: AuditLog) => actionLabel(r.action)),
      render: (action: string) => {
        let color = 'blue';
        if (action.includes('fail') || action.includes('delete') || action.includes('deactivate')) {
          color = 'volcano';
        } else if (action.includes('success') || action.includes('create')) {
          color = 'green';
        }
        return <Tag color={color}>{actionLabel(action)}</Tag>;
      },
      width: '20%',
    },
    {
      title: 'المنفذ',
      dataIndex: 'actor_user_id',
      key: 'actor_user_id',
      ...textColumn(logs, (r: AuditLog) => getActorName(r.actor_user_id)),
      render: (userId: number | null) => getActorName(userId),
      width: '25%',
    },
    {
      title: 'النتيجة',
      dataIndex: 'id',
      key: 'outcome',
      width: '10%',
      render: (_: any, r: AuditLog) => {
        const o = outcomeOf(r);
        if (!o) return <Tag color="blue">تم</Tag>;
        return o.ok
          ? <Tag color="green">تم</Tag>
          : <Tag color="volcano">مرفوض ({o.status})</Tag>;
      },
    },
    {
      title: 'نوع الكيان',
      dataIndex: 'entity_type',
      key: 'entity_type',
      ...textColumn(logs, (r: AuditLog) => entityLabel(r.entity_type)),
      render: (type: string | null) => entityLabel(type),
      width: '20%',
    },
    {
      title: 'رقم الكيان',
      dataIndex: 'entity_id',
      key: 'entity_id',
      ...numberColumn<AuditLog>((r) => r.entity_id),
      render: (id: number | null) => (id ? <Tag>#{id}</Tag> : '-'),
      width: '15%',
    },
  ];

  const tableCols = useTableColumns('audit', columns, {
    export: { name: 'سجل المراجعة والعمليات', rows: filter.filtered },
  });

  const [trail, setTrail] = useState<{ type: string; id: number } | null>(null);
  const kb = useTableKeyboard<AuditLog>({
    rows: filter.filtered, rowKey: (r) => r.id,
    onOpen: (r) => { if (r.entity_type && r.entity_id)
      setTrail({ type: r.entity_type, id: r.entity_id }); },
  });

  return (
    <div>
      <Card
        title="سجل المراجعة والعمليات (Audit Logs)"
        extra={
          <Space>
            {tableCols.control}
            <Button type="dashed" icon={<ReloadOutlined />} onClick={fetchLogs}>
              تحديث السجل
            </Button>
          </Space>
        }
      >
        <ListToolbar
          searchPlaceholder="بحث بالعملية أو الكيان أو المنفذ"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset}
          total={logs.length} shown={filter.filtered.length}
          searchSpan={5}
          filters={[
            { key: 'action', placeholder: 'العملية', options: actionOptions, span: 4 },
            { key: 'entity_type', placeholder: 'نوع الكيان', options: entityOptions, span: 4 },
            { key: 'actor_user_id', placeholder: 'المنفذ', span: 4,
              options: [{ value: 0, label: 'النظام' },
                ...users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.username})` }))] },
          ]}
        />

        <Table
          {...kb.tableProps}
          dataSource={filter.filtered}
          columns={tableCols.columns}
          rowKey="id"
          loading={loading}
          pagination={{ defaultPageSize: 15, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
          expandable={{
            expandedRowRender: (record: AuditLog) => (
              <div style={{ padding: 16, backgroundColor: '#fafafa', borderRadius: 6 }}>
                <Descriptions title="تفاصيل حالة البيانات (قبل / بعد)" bordered size="small" column={1}>
                  <Descriptions.Item label="الحالة قبل التعديل (Before)">
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                      {record.before ? JSON.stringify(record.before, null, 2) : 'لا يوجد'}
                    </pre>
                  </Descriptions.Item>
                  <Descriptions.Item label="الحالة بعد التعديل (After)">
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                      {record.after ? JSON.stringify(record.after, null, 2) : 'لا يوجد'}
                    </pre>
                  </Descriptions.Item>
                </Descriptions>
              </div>
            ),
          }}
        />
      </Card>

      <DocumentAuditModal
        entityType={trail?.type || ''} entityId={trail?.id ?? null}
        title={trail ? `سجل العمليات — ${trail.type} #${trail.id}` : undefined}
        userNames={Object.fromEntries(users.map((u: any) => [u.id, u.full_name || u.username]))}
        onClose={() => setTrail(null)}
      />
    </div>
  );
}
