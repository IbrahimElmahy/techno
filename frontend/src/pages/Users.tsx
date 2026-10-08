import React, { useEffect, useRef, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import {
  Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, message
} from 'antd';
import {
  UserAddOutlined, LockOutlined, EditOutlined, DeleteOutlined,
  ExclamationCircleOutlined, TeamOutlined, SearchOutlined, ClearOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
import { api } from '../api/client';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useAuth, RoleName } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useListFilter } from '../components/ListToolbar';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

interface UserRecord {
  id: number;
  username: string;
  role: RoleName;
  full_name: string;
  branch_id: number | null;
  territory_id: number | null;
  active: boolean;
  supervisor_id?: number | null;
}

const ROLE_LABELS: Record<RoleName, string> = {
  owner: 'المالك',
  system_admin: 'مدير النظام الرئيسي',
  branch_manager: 'مدير الفرع',
  purchasing_manager: 'مدير المشتريات',
  sales_manager: 'مدير المبيعات',
  after_sales_staff: 'موظف خدمة ما بعد البيع',
  sales_rep: 'مندوب مبيعات',
  accountant: 'المحاسب',
  viewer: 'قارئ (عرض فقط)',
  rep_supervisor: 'مشرف مناديب',
};

const BRANCH_SCOPED_ROLES = ['branch_manager', 'purchasing_manager', 'sales_manager'];

export default function Users() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [form] = Form.useForm();
  const [editVisible, setEditVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editForm] = Form.useForm();
  const { user: currentUser } = useAuth();
  const isAdminUser = currentUser?.role === 'owner' || currentUser?.role === 'system_admin';
  const BELOW_BM = ['sales_rep', 'sales_manager', 'purchasing_manager', 'accountant', 'after_sales_staff', 'viewer', 'rep_supervisor'];
  const roleEntries = Object.entries(ROLE_LABELS).filter(([k]) => isAdminUser || BELOW_BM.includes(k));

  const supervisors = users.filter((u) => u.role === 'rep_supervisor' && u.active);
  const supervisorName = (id: number | null | undefined) => {
    if (!id) return null;
    const s = users.find((u) => u.id === id);
    return s ? (s.full_name || s.username) : `#${id}`;
  };
  const supervisorField = (branchId: number | null | undefined) => {
    const mine = supervisors.filter((s) => branchId && s.branch_id === branchId);
    return (
      <Form.Item
        name="supervisor_id"
        label="المشرف"
        extra={!branchId ? 'اختر فرع المندوب أولاً'
          : mine.length ? undefined
            : 'لا يوجد «مشرف مناديب» على هذا الفرع بعد'}
      >
        <Select allowClear showSearch placeholder="بدون مشرف" filterOption={searchFilter} filterSort={searchRank}
          options={mine.map((s) => ({ value: s.id, label: s.full_name || s.username }))} />
      </Form.Item>
    );
  };

  const filter = useListFilter(users, {
    search: (u) => [u.username, u.full_name, ROLE_LABELS[u.role]],
    filters: {
      role: (u, v) => u.role === v,
      branch_id: (u, v) => u.branch_id === v,
      active: (u, v) => u.active === (v === 'active'),
    },
  });

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const kb = useTableKeyboard<UserRecord>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  const territoriesForBranch = (branchId: number | null | undefined) =>
    territories.filter(
      (t) => !branchId || t.branch_id === undefined || t.branch_id === null || t.branch_id === branchId,
    );

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

  const handleDelete = (record: UserRecord) => {
    Modal.confirm({
      title: `حذف حساب ${record.full_name}`,
      icon: <ExclamationCircleOutlined />,
      okText: 'حذف نهائي',
      okButtonProps: { danger: true },
      cancelText: 'إلغاء',
      content: (
        <span>
          سيُحذف الحساب «{record.username}» من النظام نهائياً ولا يمكن التراجع.
          <br />
          إن كان عليه أي عمل مسجّل فسيرفض النظام الحذف ويبيّن نوعه، وعندها استخدم
          «تعطيل الحساب».
        </span>
      ),
      onOk: async () => {
        try {
          await api.delete(`/api/v1/users/${record.id}`);
          message.success('تم حذف الحساب');
          fetchUsers();
        } catch (err: any) {
          const d = err?.response?.data?.detail;
          message.error(d?.message ?? 'تعذّر حذف الحساب', 8);
        }
      },
    });
  };

  const onFinish = async (values: any) => {
    try {
      const payload = {
        ...values,
        branch_id: (isAdminUser ? values.branch_id : currentUser?.branch_id) || null,
        territory_id: values.territory_id || null,
        supervisor_id: values.role === 'sales_rep' ? (values.supervisor_id || null) : null,
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

  const openEdit = (record: UserRecord) => {
    setEditingUser(record);
    editForm.setFieldsValue({
      username: record.username,
      full_name: record.full_name,
      role: record.role,
      branch_id: record.branch_id ?? undefined,
      territory_id: record.territory_id ?? undefined,
      supervisor_id: record.supervisor_id ?? undefined,
      active: record.active,
      password: undefined,
    });
    setEditVisible(true);
  };

  const onEditFinish = async (values: any) => {
    if (!editingUser) return;
    try {
      const payload: any = {
        username: values.username,
        full_name: values.full_name,
        role: values.role,
        branch_id: values.branch_id || null,
        territory_id: values.territory_id || null,
        supervisor_id: values.role === 'sales_rep' ? (values.supervisor_id || null) : null,
        active: values.active,
      };
      if (values.password) payload.password = values.password;

      await api.patch(`/api/v1/users/${editingUser.id}`, payload);
      message.success('تم تعديل بيانات المستخدم بنجاح');
      setEditVisible(false);
      editForm.resetFields();
      setEditingUser(null);
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
      title: 'المشرف',
      dataIndex: 'supervisor_id',
      key: 'supervisor_id',
      render: (id: number | null | undefined, r: UserRecord) =>
        r.role === 'sales_rep' ? (supervisorName(id) ?? '-') : '-',
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
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            تعديل
          </Button>
          {record.active && record.username !== currentUser?.username && (
            <Button size="small" type="primary" danger onClick={() => handleDeactivate(record)}>
              تعطيل الحساب
            </Button>
          )}
          {record.username !== currentUser?.username && (
            <Button size="small" danger icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}>
              حذف
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const tableCols = useTableColumns('users', columns, {
    export: { name: 'مستخدمي النظام', rows: filter.filtered },
  });

  const multiSelect = (key: string, placeholder: string, options: { value: any; label: string }[]) => (
    <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder={placeholder}
      value={filter.values[key]}
      onChange={(v) => filter.setValue(key, Array.isArray(v) && !v.length ? undefined : v)}
      options={options} filterOption={searchFilter} filterSort={searchRank} />
  );

  return (
    <>
      <ListPage
        icon={<TeamOutlined />}
        title="المستخدمين"
        muted="(إدارة مستخدمي النظام)"
        actions={(<>
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<UserAddOutlined />}
            onClick={() => setDrawerVisible(true)}>
            إضافة مستخدم
          </Button>
          {tableCols.control}
        </>)}
        filters={(<>
          <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
            placeholder="بحث بالاسم أو اسم المستخدم" prefix={<SearchOutlined />}
            onChange={(e) => filter.setQuery(e.target.value)} />
          {multiSelect('role', 'الدور',
            Object.entries(ROLE_LABELS).map(([v, l]) => ({ value: v, label: l })))}
          {multiSelect('branch_id', 'الفرع', branches.map((b) => ({ value: b.id, label: b.name })))}
          {multiSelect('active', 'الحالة',
            [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'موقوف' }])}
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>)}
      >
        <Table
          {...kb.tableProps}
          className="sl-table"
          size="small"
          dataSource={filter.filtered}
          columns={tableCols.columns}
          rowKey="id"
          loading={loading}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
            showTotal: () => (
              <span className="sl-foot">
                <span>المعروض: <b>{filter.filtered.length}</b> من {users.length}</span>
                <span>النشطين: <b className="is-pos">{users.filter((u) => u.active).length}</b></span>
              </span>
            ) }}
        />
      </ListPage>

      <TabModal footer={null} centered
        title="إضافة مستخدم جديد"
        width={450}
        onCancel={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}
          initialValues={isAdminUser ? undefined : { branch_id: currentUser?.branch_id ?? undefined }}>
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
              {roleEntries.map(([key, label]) => (
                <Select.Option key={key} value={key}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) =>
              prev.role !== curr.role || prev.branch_id !== curr.branch_id
            }
          >
            {({ getFieldValue }) => {
              const selectedRole = getFieldValue('role');
              const isRep = selectedRole === 'sales_rep';
              const isScoped = isRep || selectedRole === 'rep_supervisor' || BRANCH_SCOPED_ROLES.includes(selectedRole);
              const branchId = getFieldValue('branch_id');

              return (
                <>
                  <Form.Item
                    name="branch_id"
                    label="الفرع المسؤول عنه"
                    rules={[{ required: isScoped, message: 'هذا الدور يتطلب تحديد فرع!' }]}
                  >
                    <Select
                      placeholder="اختر الفرع للربط التنظيمي"
                      disabled={!isAdminUser}
                      allowClear
                      onChange={() => form.setFieldsValue({ territory_id: undefined, supervisor_id: undefined })}
                    >
                      {branches.map((b) => (
                        <Select.Option key={b.id} value={b.id}>
                          {b.name}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  <Form.Item
                    name="territory_id"
                    label={isRep ? 'المنطقة الجغرافية' : 'المنطقة الجغرافية (اختياري)'}
                    rules={[{ required: isRep, message: 'مندوب المبيعات يتطلب تحديد منطقة!' }]}
                  >
                    <Select showSearch placeholder="حدد المنطقة إن وجدت" allowClear filterOption={searchFilter} filterSort={searchRank}>
                      {territoriesForBranch(branchId).map((t) => (
                        <Select.Option key={t.id} value={t.id}>
                          {t.name}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  {isRep && supervisorField(branchId)}
                </>
              );
            }}
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
      </TabModal>

      <TabModal footer={null} centered
        title={editingUser ? `تعديل بيانات ${editingUser.username}` : 'تعديل بيانات المستخدم'}
        width={450}
        onCancel={() => {
          setEditVisible(false);
          setEditingUser(null);
        }}
        open={editVisible}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={onEditFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label="اسم الدخول"
            rules={[
              { required: true, message: 'يرجى إدخال اسم الدخول!' },
              { min: 2, message: 'حرفان على الأقل' },
            ]}
          >
            <Input placeholder="مثال: ahmed" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="full_name"
            label="الاسم الكامل للموظف"
            rules={[{ required: true, message: 'يرجى إدخال الاسم الكامل!' }]}
          >
            <Input placeholder="مثال: أحمد محمد علي" />
          </Form.Item>

          <Form.Item
            name="role"
            label="الدور الوظيفي والصلاحيات"
            rules={[{ required: true, message: 'يرجى تحديد صلاحية الدور!' }]}
          >
            <Select placeholder="اختر دور الموظف">
              {roleEntries.map(([key, label]) => (
                <Select.Option key={key} value={key}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) =>
              prev.role !== curr.role || prev.branch_id !== curr.branch_id
            }
          >
            {({ getFieldValue }) => {
              const selectedRole = getFieldValue('role');
              const isRep = selectedRole === 'sales_rep';
              const isScoped = isRep || selectedRole === 'rep_supervisor' || BRANCH_SCOPED_ROLES.includes(selectedRole);
              const branchId = getFieldValue('branch_id');

              return (
                <>
                  <Form.Item
                    name="branch_id"
                    label="الفرع المسؤول عنه"
                    rules={[{ required: isScoped, message: 'هذا الدور يتطلب تحديد فرع!' }]}
                  >
                    <Select
                      placeholder="اختر الفرع للربط التنظيمي"
                      disabled={!isAdminUser}
                      allowClear
                      onChange={() => editForm.setFieldsValue({ territory_id: undefined, supervisor_id: undefined })}
                    >
                      {branches.map((b) => (
                        <Select.Option key={b.id} value={b.id}>
                          {b.name}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  <Form.Item
                    name="territory_id"
                    label={isRep ? 'المنطقة الجغرافية' : 'المنطقة الجغرافية (اختياري)'}
                    rules={[{ required: isRep, message: 'مندوب المبيعات يتطلب تحديد منطقة!' }]}
                  >
                    <Select showSearch placeholder="حدد المنطقة إن وجدت" allowClear filterOption={searchFilter} filterSort={searchRank}>
                      {territoriesForBranch(branchId).map((t) => (
                        <Select.Option key={t.id} value={t.id}>
                          {t.name}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  {isRep && supervisorField(branchId)}
                </>
              );
            }}
          </Form.Item>

          <Form.Item
            name="password"
            label="إعادة تعيين كلمة المرور (اختياري)"
          >
            <Input.Password prefix={<LockOutlined />} placeholder="كلمة مرور جديدة" />
          </Form.Item>

          <Form.Item name="active" label="حالة الحساب" valuePropName="checked">
            <Switch checkedChildren="نشط" unCheckedChildren="معطل" />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ التعديلات
              </Button>
              <Button
                onClick={() => {
                  setEditVisible(false);
                  setEditingUser(null);
                }}
              >
                إلغاء
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </TabModal>
    </>
  );
}
