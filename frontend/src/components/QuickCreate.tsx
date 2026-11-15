import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, Form, Input, Modal, Row, Select, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { InputNumber } from './NumberInput';
import EmployeeFormModal from './EmployeeFormModal';
import { useAuth } from './AuthProvider';
import { useLookup } from '../hooks/useLookup';
import { searchFilter, searchRank } from '../utils/arabicSort';

export type QuickKind = 'employee' | 'warehouse' | 'department' | 'job_title' | 'item';

const LABELS: Record<QuickKind, string> = {
  employee: 'موظف جديد',
  warehouse: 'مخزن جديد',
  department: 'قسم جديد',
  job_title: 'وظيفة جديدة',
  item: 'صنف جديد',
};

type Request = { kind: QuickKind; defaults?: Record<string, any>; resolve: (row: any | null) => void };

let open: ((req: Request) => void) | null = null;

export function quickCreate(kind: QuickKind, defaults?: Record<string, any>): Promise<any | null> {
  return new Promise((resolve) => {
    if (!open) { resolve(null); return; }
    open({ kind, defaults, resolve });
  });
}

export function AddNewButton({ kind, onCreated, defaults, label }: {
  kind: QuickKind; onCreated: (row: any) => void; defaults?: Record<string, any>; label?: string;
}) {
  const run = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((r) => setTimeout(r, 60));
    const row = await quickCreate(kind, defaults);
    if (row) onCreated(row);
  };
  return (
    <Button type="link" size="small" icon={<PlusOutlined />}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); void run(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void run(); } }}>
      {label || LABELS[kind]}
    </Button>
  );
}

export function addNew(kind: QuickKind, onCreated: (row: any) => void,
  defaults?: Record<string, any>) {
  return (menu: React.ReactElement) => (
    <>
      {menu}
      <div style={{ borderTop: '1px solid #f0f0f0', padding: 4 }}>
        <AddNewButton kind={kind} onCreated={onCreated} defaults={defaults} />
      </div>
    </>
  );
}

const URLS: Partial<Record<QuickKind, string>> = {
  warehouse: '/api/v1/warehouses',
  department: '/api/v1/hr/departments',
  job_title: '/api/v1/job-titles',
  item: '/api/v1/items',
};

function SimpleForm({ req, onDone }: { req: Request; onDone: (row: any | null) => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const { user } = useAuth();
  const { options: uomOptions } = useLookup('unit_of_measure');
  const { options: categoryOptions } = useLookup('item_category');
  const { kind } = req;
  const nameRef = useRef<any>(null);

  useEffect(() => {
    if (kind !== 'warehouse') return;
    api.get('/api/v1/branches').then((r) => {
      const list = r.data || [];
      setBranches(list);
      if (list.length === 1 && !form.getFieldValue('branch_id')) form.setFieldsValue({ branch_id: list[0].id });
    }).catch(() => {});
  }, [kind]);

  useEffect(() => {
    const base: Record<string, any> = {};
    if (kind === 'warehouse') {
      base.warehouse_type = 'branch';
      base.branch_id = user?.branch_id ?? undefined;
    }
    if (kind === 'item') {
      base.kind = 'product';
      base.unit_of_measure = uomOptions[0]?.value;
    }
    form.setFieldsValue({ ...base, ...(req.defaults || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body: any = { ...(req.defaults || {}), ...v, name: String(v.name).trim() };
      if (kind === 'item') {
        if (body.purchase_price != null) body.purchase_price = String(body.purchase_price);
        if (body.sale_price != null) body.sale_price = String(body.sale_price);
      }
      const res = await api.post(URLS[kind]!, body);
      message.success('تم الحفظ');
      onDone(res.data);
    } catch {
    } finally { setSaving(false); }
  };

  return (
    <Modal open title={LABELS[kind]} onCancel={() => onDone(null)} onOk={submit}
      confirmLoading={saving} okText="حفظ واختيار" cancelText="إلغاء" destroyOnHidden
      afterOpenChange={(o) => { if (o) setTimeout(() => nameRef.current?.focus(), 30); }}
      width={kind === 'item' ? 620 : 420}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="name" label="الاسم" rules={[{ required: true, message: 'الاسم مطلوب' }]}>
          <Input ref={nameRef} autoFocus onPressEnter={submit} />
        </Form.Item>
        {kind === 'warehouse' ? (
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item name="warehouse_type" label="النوع">
                <Select options={[{ value: 'branch', label: 'مخزن فرع' },
                  { value: 'central', label: 'مخزن رئيسي' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branch_id" label="الفرع" dependencies={['warehouse_type']}
                rules={[({ getFieldValue }) => ({
                  required: getFieldValue('warehouse_type') === 'branch', message: 'اختر الفرع' })]}>
                <Select allowClear options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
          </Row>
        ) : null}
        {kind === 'item' ? (
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item name="category" label="الفئة">
                <Select showSearch allowClear options={categoryOptions}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="unit_of_measure" label="الوحدة"
                rules={[{ required: true, message: 'اختر الوحدة' }]}>
                <Select showSearch options={uomOptions} filterOption={searchFilter} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="kind" label="النوع">
                <Select options={[{ value: 'product', label: 'منتج' },
                  { value: 'raw_material', label: 'خامة' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="purchase_price" label="سعر الشراء">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sale_price" label="سعر البيع">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        ) : null}
      </Form>
    </Modal>
  );
}

export function QuickCreateHost() {
  const [stack, setStack] = useState<(Request & { id: number })[]>([]);

  useEffect(() => {
    let seq = 0;
    open = (r) => setStack((st) => [...st, { ...r, id: ++seq }]);
    return () => { open = null; };
  }, []);

  const finish = (id: number, resolve: Request['resolve'], row: any | null) => {
    resolve(row);
    setStack((st) => st.filter((x) => x.id !== id));
  };

  return (
    <>
      {stack.map((req) => (req.kind === 'employee' ? (
        <EmployeeFormModal key={req.id} open employee={null} defaults={req.defaults as any}
          onClose={() => setTimeout(() => finish(req.id, req.resolve, null), 0)}
          onSaved={(e) => finish(req.id, req.resolve, e)} />
      ) : (
        <SimpleForm key={req.id} req={req} onDone={(row) => finish(req.id, req.resolve, row)} />
      )))}
    </>
  );
}
