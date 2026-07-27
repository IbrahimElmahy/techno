import React, { useEffect, useMemo, useState } from 'react';
import { Button, Col, Empty, Form, Input, Modal, Row, Select, Space, Spin, Tag, message } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { normalizeAr } from './ListToolbar';

/**
 * اختيار الطرف — the first step of every sale/purchase document.
 *
 * Two things this solves that a plain dropdown could not: the list is long enough to need real
 * search and a branch filter, and a party that does not exist yet can be created **without
 * leaving the half-filled document** — walking away to the customers screen used to lose the
 * lines already entered.
 */

export type PartyKind = 'customer' | 'supplier';

export interface Party {
  id: number;
  name: string;
  phone?: string | null;
  address?: string | null;
  branch_id?: number | null;
  balance?: string | null;
}

const KIND_LABEL: Record<PartyKind, string> = { customer: 'العميل', supplier: 'المورد' };
const KIND_ENDPOINT: Record<PartyKind, string> = {
  customer: '/api/v1/customers',
  supplier: '/api/v1/suppliers',
};

export default function PartyPickerModal({
  open, kind, onPick, onCancel,
}: {
  open: boolean;
  kind: PartyKind;
  onPick: (party: Party) => void;
  onCancel: () => void;
}) {
  const [parties, setParties] = useState<Party[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  // A customer must be assigned to a rep and a territory — they are asked for inline so the
  // quick-create stays a genuine shortcut rather than a form that fails on submit.
  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [customerTypes, setCustomerTypes] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState<number | undefined>();
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, bRes, uRes, tRes] = await Promise.all([
        api.get(KIND_ENDPOINT[kind]),
        api.get('/api/v1/branches').catch(() => ({ data: [] })),
        kind === 'customer' ? api.get('/api/v1/users').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        kind === 'customer' ? api.get('/api/v1/territories').catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);
      setParties(pRes.data);
      setBranches(bRes.data || []);
      setReps((uRes.data || []).filter((u: any) => u.role === 'sales_rep'));
      setTerritories(tRes.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { if (open) { load(); setQuery(''); setCreating(false); } }, [open, kind]);

  const visible = useMemo(() => {
    const needle = normalizeAr(query);
    return parties.filter((p) => {
      if (branchId && p.branch_id !== branchId) return false;
      if (!needle) return true;
      return normalizeAr(p.name).includes(needle) || normalizeAr(p.phone).includes(needle);
    });
  }, [parties, query, branchId]);

  /** Create the party inline and hand it straight back — the document keeps everything it had. */
  const handleCreate = async (values: any) => {
    setSaving(true);
    try {
      const payload: any = { name: values.name, phone: values.phone || undefined };
      if (kind === 'customer') {
        payload.customer_type = values.customer_type || 'تاجر';
        payload.rep_id = values.rep_id;
        payload.territory_id = values.territory_id;
      }
      const res = await api.post(KIND_ENDPOINT[kind], payload);
      message.success(`تم إنشاء ${KIND_LABEL[kind]} بنجاح`);
      onPick({ id: res.data.id, name: res.data.name, phone: res.data.phone ?? null,
               address: res.data.address ?? null, balance: '0' });
      createForm.resetFields();
      setCreating(false);
    } catch (err) {
      console.error(err);
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open} onCancel={onCancel} width={780} centered destroyOnHidden
      title={`اختيار ${KIND_LABEL[kind]}`}
      footer={
        <Space>
          {!creating && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {kind === 'customer' ? 'عميل جديد' : 'مورد جديد'}
            </Button>
          )}
          <Button onClick={onCancel}>إغلاق</Button>
        </Space>
      }
    >
      {creating ? (
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="الاسم"
                rules={[{ required: true, message: 'الاسم مطلوب' }]}>
                <Input autoFocus placeholder={`اسم ${KIND_LABEL[kind]}`} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="الهاتف"><Input placeholder="اختياري" /></Form.Item>
            </Col>
          </Row>
          {kind === 'customer' && (
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="rep_id" label="المندوب"
                  rules={[{ required: true, message: 'المندوب مطلوب' }]}>
                  <Select showSearch optionFilterProp="label" placeholder="اختر المندوب"
                    options={reps.map((r: any) => ({
                      value: r.id, label: r.full_name || r.username }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="territory_id" label="المنطقة"
                  rules={[{ required: true, message: 'المنطقة مطلوبة' }]}>
                  <Select showSearch optionFilterProp="label" placeholder="اختر المنطقة"
                    options={territories.map((t: any) => ({ value: t.id, label: t.name }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="customer_type" label="نوع العميل" initialValue="تاجر">
                  <Select options={(customerTypes.length ? customerTypes : [
                    { value: 'تاجر', label: 'تاجر' },
                    { value: 'مستهلك', label: 'مستهلك' },
                  ])} />
                </Form.Item>
              </Col>
            </Row>
          )}
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>حفظ واختيار</Button>
            <Button onClick={() => setCreating(false)}>رجوع للقائمة</Button>
          </Space>
        </Form>
      ) : (
        <>
          <Row gutter={8} style={{ marginBottom: 10 }}>
            <Col xs={24} md={14}>
              <Input allowClear autoFocus prefix={<SearchOutlined />}
                placeholder="بحث بالاسم أو الهاتف"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </Col>
            <Col xs={24} md={10}>
              <Select allowClear style={{ width: '100%' }} placeholder="كل الفروع"
                value={branchId} onChange={(v) => setBranchId(v)}
                options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
            </Col>
          </Row>

          <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #f0f0f0',
                        borderRadius: 8 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
            ) : visible.length === 0 ? (
              <Empty description="لا توجد نتائج — استخدم زر الإنشاء بالأسفل"
                style={{ margin: '32px 0' }} />
            ) : visible.map((p) => (
              <div key={p.id} onClick={() => onPick(p)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 8, padding: '10px 14px', cursor: 'pointer',
                  borderTop: '1px solid #f5f5f5',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f2f9f3'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                <Space size={12}>
                  {p.phone && <span style={{ color: '#8a8a8a', fontSize: 12 }}>{p.phone}</span>}
                  {p.balance != null && Number(p.balance) !== 0 && (
                    <Tag color={Number(p.balance) > 0 ? 'red' : 'green'}>
                      {Number(Math.abs(Number(p.balance))).toLocaleString('ar-EG',
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م
                    </Tag>
                  )}
                </Space>
                <b>{p.name}</b>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, color: '#8a8a8a', fontSize: 12 }}>
            {visible.length} من {parties.length}
          </div>
        </>
      )}
    </Modal>
  );
}
