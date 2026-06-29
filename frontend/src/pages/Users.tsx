import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, Select, Tag, message } from 'antd';
import { UserAddOutlined, LockOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth, RoleName } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';

interface UserRecord {
  id: number;
  username: string;
  role: RoleName;
  full_name: string;
  branch_id: number | null;
  territory_id: number | null;
  active: boolean;
}

const ROLE_LABELS: Record<RoleName, string> = {
  system_admin: 'مدير النظام الرئيسي',
  branch_manager: 'مدير الفرع',
  purchasing_manager: 'مدير المشتريات',
  sales_manager: 'مدير المبيعات',
  after_sales_staff: 'موظف خدمة ما بعد البيع',
  sales_rep: 'مندوب مبيعات',
  accountant: 'المحاسب',
};

export default function Users() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [form] = Form.useForm();
  const { user: currentUser } = useAuth();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/users');
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLookups = async () => {
    try {
      const [branchesRes, territoriesRes] = await Promise.all([
        api.get('/api/v1/branches'),
        api.get('/api/v1/territories'),
      ]);
      setBranches(branchesRes.data);
      setTerritories(territoriesRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchLookups();
  }, []);

  const handleDeactivate = (record: UserRecord) => {
    showDeactivationConfirm({
      title: `تعطيل حساب ${record.full_name}`,
      content: `هل أنت متأكد من تعطيل حساب المستخدم "${record.username}"؟ لن يتمكن من تسجيل الدخول إلى النظام بعد الآن.`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/users/${record.id}/deactivate`);
          message.success('تم تعطيل حساب المستخدم بنجاح');
          fetchUsers();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const onFinish = async (values: any) => {
    try {
      const payload = {
        ...values,
        branch_id: values.branch_id || null,
        territory_id: values.territory_id || null,
      };

      await api.post('/api/v1/users', payload);
      message.success('تم إنشاء حساب المستخدم بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    {
      title: 'الاسم الكامل',
      dataIndex: 'full_name',
      key: 'full_name',
    },
    {
      title: 'اسم المستخدم',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: 'الدور',
      dataIndex: 'role',
      key: 'role',
      render: (role: RoleName) => ROLE_LABELS[role] || role,
    },
    {
      title: 'الفرع',
      dataIndex: 'branch_id',
      key: 'branch_id',
      render: (branchId: number | null) => {
        if (!branchId) return 'عام (كل الفروع)';
        const branch = branches.find((b) => b.id === branchId);
        return branch ? branch.name : `فرع #${branchId}`;
      },
    },
    {
      title: 'المنطقة',
      dataIndex: 'territory_id',
      key: 'territory_id',
      render: (territoryId: number | null) => {
        if (!territoryId) return '-';
        const territory = territories.find((t) => t.id === territoryId);
        return territory ? territory.name : `منطقة #${territoryId}`;
      },
    },
    {
      title: 'الحالة',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>{active ? 'نشط' : 'معطل'}</Tag>
      ),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: UserRecord) => (
        <Space size="middle">
          {record.active && record.username !== currentUser?.username && (
            <Button type="primary" danger onClick={() => handleDeactivate(record)}>
              تعطيل الحساب
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="إدارة مستخدمي النظام"
        extra={
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setDrawerVisible(true)}>
            إضافة مستخدم
          </Button>
        }
      >
        <Table
          dataSource={users}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Drawer
        title="إضافة مستخدم جديد"
        width={450}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="full_name"
            label="الاسم الكامل للموظف"
            rules={[{ required: true, message: 'يرجى إدخال الاسم الكامل!' }]}
          >
            <Input placeholder="مثال: أحمد محمد علي" />
          </Form.Item>

          <Form.Item
            name="username"
            label="اسم المستخدم (تسجيل الدخول)"
            rules={[{ required: true, message: 'يرجى إدخال اسم المستخدم!' }]}
          >
            <Input placeholder="مثال: ahmed_m" />
          </Form.Item>

          <Form.Item
            name="password"
            label="كلمة المرور"
            rules={[{ required: true, message: 'يرجى إدخال كلمة المرور!' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="كلمة مرور الموظف" />
          </Form.Item>

          <Form.Item
            name="role"
            label="الدور الوظيفي والصلاحيات"
            rules={[{ required: true, message: 'يرجى تحديد صلاحية الدور!' }]}
          >
            <Select placeholder="اختر دور الموظف">
              {Object.entries(ROLE_LABELS)
                .filter(([key]) => key !== 'sales_rep') // Sales Rep is mobile only
                .map(([key, label]) => (
                  <Select.Option key={key} value={key}>
                    {label}
                  </Select.Option>
                ))}
            </Select>
          </Form.Item>

          {/* Conditional field displays: branch managers, sales managers, purchasing managers MUST be scoped */}
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.role !== curr.role}>
            {({ getFieldValue }) => {
              const selectedRole = getFieldValue('role');
              const isScoped = [
                'branch_manager',
                'purchasing_manager',
                'sales_manager',
              ].includes(selectedRole);

              return (
                <Form.Item
                  name="branch_id"
                  label="الفرع المسؤول عنه"
                  rules={[
                    { required: isScoped, message: 'هذا الدور يتطلب تحديد فرع!' },
                  ]}
                >
                  <Select placeholder="اختر الفرع للربط التنظيمي" allowClear>
                    {branches.map((b) => (
                      <Select.Option key={b.id} value={b.id}>
                        {b.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item
            name="territory_id"
            label="المنطقة الجغرافية (اختياري)"
          >
            <Select placeholder="حدد المنطقة إن وجدت" allowClear>
              {territories.map((t) => (
                <Select.Option key={t.id} value={t.id}>
                  {t.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ وإضافة الموظف
              </Button>
              <Button onClick={() => setDrawerVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
