import React, { useEffect, useState } from 'react';
import { Table, Card, Tag, Button, Descriptions } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import DocumentAuditModal from '../components/DocumentAuditModal';

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

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/audit');
      setLogs(res.data.reverse()); // Show newest first
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
    search: (l) => [l.action, l.entity_type, l.entity_id, getActorName(l.actor_user_id)],
    filters: {
      action: (l, v) => l.action === v,
      entity_type: (l, v) => l.entity_type === v,
      actor_user_id: (l, v) => (v === 0 ? l.actor_user_id === null : l.actor_user_id === v),
    },
    dateOf: (l) => l.created_at,
  });

  const actionOptions = Array.from(new Set(logs.map((l) => l.action).filter(Boolean)))
    .map((a) => ({ value: a, label: a }));
  const entityOptions = Array.from(new Set(logs.map((l) => l.entity_type).filter(Boolean)))
    .map((e) => ({ value: e as string, label: e as string }));

  const columns = [
    {
      title: 'التاريخ والوقت',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (dateStr: string) => new Date(dateStr).toLocaleString('ar-EG'),
      width: '20%',
    },
    {
      title: 'العملية المسجلة',
      dataIndex: 'action',
      key: 'action',
      render: (action: string) => {
        let color = 'blue';
        if (action.includes('fail') || action.includes('delete') || action.includes('deactivate')) {
          color = 'volcano';
        } else if (action.includes('success') || action.includes('create')) {
          color = 'green';
        }
        return <Tag color={color}>{action}</Tag>;
      },
      width: '20%',
    },
    {
      title: 'المنفذ',
      dataIndex: 'actor_user_id',
      key: 'actor_user_id',
      render: (userId: number | null) => getActorName(userId),
      width: '25%',
    },
    {
      title: 'نوع الكيان',
      dataIndex: 'entity_type',
      key: 'entity_type',
      render: (type: string | null) => type || '-',
      width: '20%',
    },
    {
      title: 'رقم الكيان',
      dataIndex: 'entity_id',
      key: 'entity_id',
      render: (id: number | null) => (id ? <Tag>#{id}</Tag> : '-'),
      width: '15%',
    },
  ];

  // «إيه اللي حصل على المستند ده كله؟» — قراية سطر واحد في السجل بتفتح السؤال ده دايماً، وكان
  // لازم تفلتر بإيدك بنوع الكيان ورقمه. السطر بيفتح السجل المشترك مقصور على كيانه.
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
          <Button type="dashed" icon={<ReloadOutlined />} onClick={fetchLogs}>
            تحديث السجل
          </Button>
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
          columns={columns}
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

      {/* السجل المشترك، مقصور على الكيان اللي في السطر — نفس النافذة اللي إذن التحويل بيفتحها،
          عشان «سجل المستند» يبقى شكل واحد في النظام كله مش شكل لكل شاشة. */}
      <DocumentAuditModal
        entityType={trail?.type || ''} entityId={trail?.id ?? null}
        title={trail ? `سجل العمليات — ${trail.type} #${trail.id}` : undefined}
        userNames={Object.fromEntries(users.map((u: any) => [u.id, u.full_name || u.username]))}
        onClose={() => setTrail(null)}
      />
    </div>
  );
}
