import React, { useEffect, useState } from 'react';
import { Table, Card, Tag, Input, Space, Button, Descriptions } from 'antd';
import { FileSearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/client';

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

  // Simple local search filters
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

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

  // Local filter logic
  const filteredLogs = logs.filter((log) => {
    const matchAction = log.action.toLowerCase().includes(actionFilter.toLowerCase());
    const matchEntity = log.entity_type
      ? log.entity_type.toLowerCase().includes(entityFilter.toLowerCase())
      : true;
    return matchAction && matchEntity;
  });

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
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="تصفية بالعملية"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ width: 200 }}
          />
          <Input
            placeholder="تصفية بنوع الكيان"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            style={{ width: 200 }}
          />
        </Space>

        <Table
          dataSource={filteredLogs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 15 }}
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
    </div>
  );
}
