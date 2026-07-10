import React, { useEffect, useState } from 'react';
import { Card, Tabs, Table, Button, Space, Modal, Form, Input, Select, Checkbox, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';

export default function Org() {
  const [activeTab, setActiveTab] = useState('branches');
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  // Edit state
  const [editVisible, setEditVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [editForm] = Form.useForm();
  
  // Data states
  const [branches, setBranches] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [custodies, setCustodies] = useState<any[]>([]);
  const [governorates, setGovernorates] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'branches') {
        const [branchesRes, govRes] = await Promise.all([
          api.get('/api/v1/branches'),
          api.get('/api/v1/governorates'),
        ]);
        setBranches(branchesRes.data);
        setGovernorates(govRes.data);
      } else if (activeTab === 'warehouses') {
        const [warehousesRes, branchesRes] = await Promise.all([
          api.get('/api/v1/warehouses'),
          api.get('/api/v1/branches'),
        ]);
        setWarehouses(warehousesRes.data);
        setBranches(branchesRes.data);
      } else if (activeTab === 'custodies') {
        const [custodiesRes, repsRes, warehousesRes] = await Promise.all([
          api.get('/api/v1/custodies'),
          api.get('/api/v1/users'),
          api.get('/api/v1/warehouses'),
        ]);
        setCustodies(custodiesRes.data);
        setReps(repsRes.data.filter((u: any) => u.role === 'sales_rep'));
        setWarehouses(warehousesRes.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const handleCreate = async (values: any) => {
    try {
      if (activeTab === 'branches') {
        await api.post('/api/v1/branches', {
          name: values.name,
          governorate_id: values.governorate_id,
          is_head_office: values.is_head_office || false,
        });
        message.success('تم إنشاء الفرع بنجاح');
      } else if (activeTab === 'warehouses') {
        await api.post('/api/v1/warehouses', {
          name: values.name,
          warehouse_type: values.warehouse_type,
          branch_id: values.warehouse_type === 'branch' ? values.branch_id : null,
        });
        message.success('تم إنشاء المستودع بنجاح');
      } else if (activeTab === 'custodies') {
        await api.post('/api/v1/custodies', {
          holder_type: values.holder_type,
          rep_id: values.holder_type === 'rep' ? values.rep_id : null,
          warehouse_id: values.holder_type === 'warehouse' ? values.warehouse_id : null,
        });
        message.success('تم ربط وإعداد العهدة بنجاح');
      }
      setModalVisible(false);
      form.resetFields();
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (record: any) => {
    setEditingRecord(record);
    if (activeTab === 'branches') {
      editForm.setFieldsValue({ name: record.name, governorate_id: record.governorate_id });
    } else if (activeTab === 'warehouses') {
      editForm.setFieldsValue({ name: record.name });
    }
    setEditVisible(true);
  };

  const handleEdit = async (values: any) => {
    if (!editingRecord) return;
    try {
      if (activeTab === 'branches') {
        await api.patch(`/api/v1/branches/${editingRecord.id}`, {
          name: values.name,
          governorate_id: values.governorate_id,
        });
        message.success('تم تعديل الفرع بنجاح');
      } else if (activeTab === 'warehouses') {
        await api.patch(`/api/v1/warehouses/${editingRecord.id}`, {
          name: values.name,
        });
        message.success('تم تعديل المستودع بنجاح');
      }
      setEditVisible(false);
      editForm.resetFields();
      setEditingRecord(null);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeactivate = (record: any) => {
    const label =
      activeTab === 'branches' ? 'الفرع' : activeTab === 'warehouses' ? 'المستودع' : 'العهدة';
    const endpoint =
      activeTab === 'branches'
        ? `/api/v1/branches/${record.id}`
        : activeTab === 'warehouses'
        ? `/api/v1/warehouses/${record.id}`
        : `/api/v1/custodies/${record.id}`;
    showDeactivationConfirm({
      title: `إلغاء تفعيل ${label}`,
      content: `هل أنت متأكد من إلغاء تفعيل ${label}؟ لن يعود متاحًا للاستخدام في العمليات الجديدة.`,
      onOk: async () => {
        try {
          await api.delete(endpoint);
          message.success(`تم إلغاء تفعيل ${label} بنجاح`);
          fetchData();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Columns definition
  const branchColumns = [
    { title: 'كود الفرع', dataIndex: 'id', key: 'id' },
    { title: 'اسم الفرع', dataIndex: 'name', key: 'name' },
    {
      title: 'المحافظة',
      dataIndex: 'governorate_id',
      key: 'governorate_id',
      render: (govId: number) => {
        const gov = governorates.find((g: any) => g.id === govId);
        return gov ? gov.name : `محافظة #${govId}`;
      },
    },
    {
      title: 'نوع الفرع',
      dataIndex: 'is_head_office',
      key: 'is_head_office',
      render: (isHead: boolean) => (isHead ? <Tag color="blue">المركز الرئيسي</Tag> : <Tag>فرع إقليمي</Tag>),
    },
    {
      title: 'الحالة',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => <Tag color={active ? 'green' : 'red'}>{active ? 'نشط' : 'معطل'}</Tag>,
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space size="middle">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            تعديل
          </Button>
          {record.active && (
            <Button size="small" danger icon={<StopOutlined />} onClick={() => handleDeactivate(record)}>
              إلغاء تفعيل
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const warehouseColumns = [
    { title: 'كود المستودع', dataIndex: 'id', key: 'id' },
    { title: 'اسم المستودع', dataIndex: 'name', key: 'name' },
    {
      title: 'نوع المستودع',
      dataIndex: 'warehouse_type',
      key: 'warehouse_type',
      render: (type: string) => (type === 'central' ? <Tag color="orange">مستودع مركزي</Tag> : <Tag color="cyan">مستودع فرعي</Tag>),
    },
    {
      title: 'الفرع التابع له',
      dataIndex: 'branch_id',
      key: 'branch_id',
      render: (branchId: number | null) => {
        if (!branchId) return '-';
        const branch = branches.find((b: any) => b.id === branchId);
        return branch ? branch.name : `فرع #${branchId}`;
      },
    },
    {
      title: 'الحالة',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => <Tag color={active ? 'green' : 'red'}>{active ? 'نشط' : 'معطل'}</Tag>,
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space size="middle">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            تعديل
          </Button>
          {record.active && (
            <Button size="small" danger icon={<StopOutlined />} onClick={() => handleDeactivate(record)}>
              إلغاء تفعيل
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const custodyColumns = [
    { title: 'رقم العهدة', dataIndex: 'id', key: 'id' },
    {
      title: 'نوع الحائز (المسؤول)',
      dataIndex: 'holder_type',
      key: 'holder_type',
      render: (type: string) => (type === 'rep' ? <Tag color="purple">مندوب مبيعات</Tag> : <Tag color="blue">مستودع</Tag>),
    },
    {
      title: 'اسم المسؤول / المستودع',
      key: 'holder_name',
      render: (_: any, record: any) => {
        if (record.holder_type === 'rep') {
          const rep = reps.find((r: any) => r.id === record.rep_id);
          return rep ? rep.full_name : `مندوب #${record.rep_id}`;
        } else {
          const wh = warehouses.find((w: any) => w.id === record.warehouse_id);
          return wh ? wh.name : `مستودع #${record.warehouse_id}`;
        }
      },
    },
    {
      title: 'الحالة',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => <Tag color={active ? 'green' : 'red'}>{active ? 'نشط' : 'معطل'}</Tag>,
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: any) =>
        record.active ? (
          <Button size="small" danger icon={<StopOutlined />} onClick={() => handleDeactivate(record)}>
            إلغاء تفعيل
          </Button>
        ) : null,
    },
  ];

  const tabItems = [
    {
      key: 'branches',
      label: 'الفروع والمكاتب',
      children: (
        <Table dataSource={branches} columns={branchColumns} rowKey="id" loading={loading} />
      ),
    },
    {
      key: 'warehouses',
      label: 'المستودعات والمخازن',
      children: (
        <Table dataSource={warehouses} columns={warehouseColumns} rowKey="id" loading={loading} />
      ),
    },
    {
      key: 'custodies',
      label: 'العهد المالية والعينية',
      children: (
        <Table dataSource={custodies} columns={custodyColumns} rowKey="id" loading={loading} />
      ),
    },
  ];

  return (
    <div>
      <Card
        title="إدارة البنية التنظيمية"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
            {activeTab === 'branches' ? 'إضافة فرع' : activeTab === 'warehouses' ? 'إضافة مستودع' : 'إعداد عهدة'}
          </Button>
        }
      >
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </Card>

      <Modal
        title={activeTab === 'branches' ? 'إضافة فرع جديد' : activeTab === 'warehouses' ? 'إضافة مستودع جديد' : 'إعداد عهدة جديدة'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
        okText="حفظ البيانات"
        cancelText="إلغاء"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} requiredMark={false}>
          {activeTab === 'branches' && (
            <>
              <Form.Item
                name="name"
                label="اسم الفرع"
                rules={[{ required: true, message: 'يرجى إدخال اسم الفرع!' }]}
              >
                <Input placeholder="مثال: فرع الإسكندرية" />
              </Form.Item>

              <Form.Item
                name="governorate_id"
                label="المحافظة التابع لها"
                rules={[{ required: true, message: 'يرجى تحديد المحافظة!' }]}
              >
                <Select placeholder="اختر المحافظة">
                  {governorates.map((g) => (
                    <Select.Option key={g.id} value={g.id}>
                      {g.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item name="is_head_office" valuePropName="checked">
                <Checkbox>هل هذا الفرع هو المركز الرئيسي للشركة؟</Checkbox>
              </Form.Item>
            </>
          )}

          {activeTab === 'warehouses' && (
            <>
              <Form.Item
                name="name"
                label="اسم المستودع"
                rules={[{ required: true, message: 'يرجى إدخال اسم المستودع!' }]}
              >
                <Input placeholder="مثال: مخزن الخامات الرئيسي" />
              </Form.Item>

              <Form.Item
                name="warehouse_type"
                label="نوع المستودع"
                rules={[{ required: true, message: 'يرجى تحديد نوع المستودع!' }]}
              >
                <Select placeholder="اختر نوع المستودع">
                  <Select.Option value="central">مستودع مركزي (معتمد لكل الفروع)</Select.Option>
                  <Select.Option value="branch">مستودع فرعي (تابع لفرع محدد)</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                noStyle
                shouldUpdate={(prev, curr) => prev.warehouse_type !== curr.warehouse_type}
              >
                {({ getFieldValue }) =>
                  getFieldValue('warehouse_type') === 'branch' ? (
                    <Form.Item
                      name="branch_id"
                      label="الفرع المنسوب إليه"
                      rules={[{ required: true, message: 'يرجى تحديد الفرع للمستودع الفرعي!' }]}
                    >
                      <Select placeholder="اختر الفرع التابع له">
                        {branches.map((b) => (
                          <Select.Option key={b.id} value={b.id}>
                            {b.name}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
            </>
          )}

          {activeTab === 'custodies' && (
            <>
              <Form.Item
                name="holder_type"
                label="نوع المسؤول (الحائز)"
                rules={[{ required: true, message: 'يرجى تحديد حائز العهدة!' }]}
              >
                <Select placeholder="اختر نوع الحائز">
                  <Select.Option value="rep">مندوب مبيعات (Sales Rep)</Select.Option>
                  <Select.Option value="warehouse">أمين مستودع (Warehouse)</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                noStyle
                shouldUpdate={(prev, curr) => prev.holder_type !== curr.holder_type}
              >
                {({ getFieldValue }) => {
                  const type = getFieldValue('holder_type');
                  if (type === 'rep') {
                    return (
                      <Form.Item
                        name="rep_id"
                        label="المندوب المسؤول"
                        rules={[{ required: true, message: 'يرجى اختيار المندوب!' }]}
                      >
                        <Select placeholder="اختر المندوب للربط بالعهدة">
                          {reps.map((r) => (
                            <Select.Option key={r.id} value={r.id}>
                              {r.full_name}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    );
                  } else if (type === 'warehouse') {
                    return (
                      <Form.Item
                        name="warehouse_id"
                        label="المستودع المسؤول"
                        rules={[{ required: true, message: 'يرجى اختيار المستودع!' }]}
                      >
                        <Select placeholder="اختر المستودع للربط بالعهدة">
                          {warehouses.map((w) => (
                            <Select.Option key={w.id} value={w.id}>
                              {w.name}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    );
                  }
                  return null;
                }}
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <Modal
        title={activeTab === 'branches' ? 'تعديل بيانات الفرع' : 'تعديل بيانات المستودع'}
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          setEditingRecord(null);
        }}
        onOk={() => editForm.submit()}
        okText="حفظ التعديلات"
        cancelText="إلغاء"
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit} requiredMark={false}>
          {activeTab === 'branches' && (
            <>
              <Form.Item
                name="name"
                label="اسم الفرع"
                rules={[{ required: true, message: 'يرجى إدخال اسم الفرع!' }]}
              >
                <Input placeholder="مثال: فرع الإسكندرية" />
              </Form.Item>

              <Form.Item
                name="governorate_id"
                label="المحافظة التابع لها"
                rules={[{ required: true, message: 'يرجى تحديد المحافظة!' }]}
              >
                <Select placeholder="اختر المحافظة">
                  {governorates.map((g) => (
                    <Select.Option key={g.id} value={g.id}>
                      {g.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </>
          )}

          {activeTab === 'warehouses' && (
            <Form.Item
              name="name"
              label="اسم المستودع"
              rules={[{ required: true, message: 'يرجى إدخال اسم المستودع!' }]}
            >
              <Input placeholder="مثال: مخزن الخامات الرئيسي" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
