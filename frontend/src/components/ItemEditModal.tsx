import React, { useEffect, useState } from 'react';
import {
  Modal, Form, Input, InputNumber, Select, Switch, Divider, Row, Col, Spin, message,
} from 'antd';
import { api } from '../api/client';
import { useLookup } from '../hooks/useLookup';

/**
 * ONE edit form for an item: its data, its five tier prices AND its loyalty point value.
 *
 * These used to live in three separate places (the row's edit modal, a «الأسعار» popup and an
 * inline points cell), so changing an item meant three round trips through three UIs. Saving
 * still hits the three endpoints they belong to — only the screen is unified.
 */

const TIERS: [string, string][] = [
  ['commercial', 'تجاري'],
  ['semi_commercial', 'نصف تجاري'],
  ['wholesale', 'جملة'],
  ['semi_wholesale', 'نصف جملة'],
  ['consumer', 'مستهلك'],
];

export default function ItemEditModal({
  itemId, open, onClose, onSaved, canEditPrices = true, canEditPoints = true,
}: {
  itemId: number | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  canEditPrices?: boolean;
  canEditPoints?: boolean;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [item, setItem] = useState<any>(null);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const { options: categoryOptions } = useLookup('item_category');
  const { options: uomOptions } = useLookup('unit_of_measure');

  useEffect(() => {
    if (!open || !itemId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [itemRes, whRes] = await Promise.all([
          api.get(`/api/v1/items/${itemId}/profile`),
          api.get('/api/v1/warehouses'),
        ]);
        if (cancelled) return;
        const it = itemRes.data.item;
        setItem(it);
        setWarehouses(whRes.data);

        const tiers: Record<string, number | undefined> = {};
        (itemRes.data.tier_prices || []).forEach((t: any) => {
          tiers[t.tier] = Number(t.price);
        });

        // Points only exist for products; a raw material simply has none.
        let points: number | undefined;
        if (it.kind === 'product') {
          try {
            const p = await api.get(`/api/v1/products/${itemId}/point-value`);
            points = parseFloat(p.data.point_value) || 0;
          } catch { /* no point value set yet */ }
        }

        form.setFieldsValue({
          name: it.name,
          code: it.code,
          unit_of_measure: it.unit_of_measure,
          category: it.category ?? undefined,
          sale_price: it.sale_price != null ? Number(it.sale_price) : undefined,
          purchase_price: it.purchase_price != null ? Number(it.purchase_price) : undefined,
          default_discount_pct: it.default_discount_pct != null
            ? Number(it.default_discount_pct) : 0,
          default_warehouse_id: it.default_warehouse_id ?? undefined,
          is_serialized: !!it.is_serialized,
          is_perishable: !!it.is_perishable,
          min_stock: it.min_stock != null ? Number(it.min_stock) : undefined,
          max_stock: it.max_stock != null ? Number(it.max_stock) : undefined,
          active: !!it.active,
          point_value: points,
          ...tiers,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, itemId]);

  const onFinish = async (v: any) => {
    if (!itemId || !item) return;
    setSaving(true);
    try {
      // 1) The item's own fields (price moves get logged server-side).
      await api.patch(`/api/v1/items/${itemId}`, {
        name: v.name,
        code: v.code,
        unit_of_measure: v.unit_of_measure,
        category: v.category ?? null,
        sale_price: item.kind === 'product' ? v.sale_price ?? null : null,
        purchase_price: item.kind === 'raw_material' ? v.purchase_price ?? null : null,
        default_discount_pct: v.default_discount_pct ?? 0,
        default_warehouse_id: v.default_warehouse_id ?? null,
        is_serialized: v.is_serialized,
        // (011) advisory limits + expiry tracking
        is_perishable: v.is_perishable,
        min_stock: v.min_stock ?? null,
        max_stock: v.max_stock ?? null,
        active: v.active,
      });

      // 2) Tier prices — products only, and only the tiers actually filled in.
      if (item.kind === 'product' && canEditPrices) {
        const tiers = TIERS
          .filter(([key]) => v[key] !== undefined && v[key] !== null && v[key] !== '')
          .map(([key]) => ({ tier: key, price: String(v[key]) }));
        if (tiers.length) {
          await api.put(`/api/v1/items/${itemId}/prices`, { tiers });
        }
      }

      // 3) Loyalty point value — products only.
      if (item.kind === 'product' && canEditPoints && v.point_value !== undefined
          && v.point_value !== null) {
        await api.put(`/api/v1/products/${itemId}/point-value`,
                      { point_value: v.point_value });
      }

      message.success('تم حفظ بيانات الصنف');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const isProduct = item?.kind === 'product';

  return (
    <Modal
      open={open}
      title={item ? `تعديل الصنف: ${item.name}` : 'تعديل الصنف'}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="حفظ"
      cancelText="إلغاء"
      confirmLoading={saving}
      width={720}
      centered
      destroyOnHidden
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="اسم الصنف"
                rules={[{ required: true, message: 'اكتب اسم الصنف' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="code" label="كود الصنف">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="unit_of_measure" label="وحدة القياس">
                <Select showSearch options={uomOptions.map((o) => ({ value: o.value, label: o.label }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="category" label="الفئة">
                <Select allowClear showSearch
                  options={categoryOptions.map((o) => ({ value: o.value, label: o.label }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              {isProduct ? (
                <Form.Item name="sale_price" label="سعر البيع المرجعي">
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter="ج.م" />
                </Form.Item>
              ) : (
                <Form.Item name="purchase_price" label="سعر الشراء المرجعي">
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter="ج.م" />
                </Form.Item>
              )}
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="default_discount_pct" label="نسبة الخصم الافتراضية %">
                <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="default_warehouse_id" label="المخزن الافتراضي"
                extra="التصنيع يسحب/يودع هذا الصنف هنا تلقائياً">
                <Select allowClear showSearch
                  filterOption={(i, o) => String(o?.label ?? '').includes(i)}
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
              </Form.Item>
            </Col>
            {/* (011) Planning limits — advisory only: they drive the reorder report, they never
                block a sale. */}
            <Col xs={12} md={6}>
              <Form.Item name="min_stock" label="حد إعادة الطلب (الأدنى)"
                extra="تنبيه فقط — لا يمنع البيع">
                <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="اختياري" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="max_stock" label="الحد الأقصى">
                <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="اختياري" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="is_perishable" label="له صلاحية"
                valuePropName="checked" extra="يُستلم ويُباع بالتشغيلات (الأقدم صلاحية أولاً)">
                <Switch checkedChildren="نعم" unCheckedChildren="لا" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="is_serialized" label="بسريال" valuePropName="checked">
                <Switch checkedChildren="نعم" unCheckedChildren="لا" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="active" label="الحالة" valuePropName="checked">
                <Switch checkedChildren="نشط" unCheckedChildren="معطل" />
              </Form.Item>
            </Col>
          </Row>

          {isProduct && canEditPrices && (
            <>
              <Divider orientation="right" style={{ margin: '4px 0 12px' }}>
                الأسعار حسب الفئة
              </Divider>
              <Row gutter={12}>
                {TIERS.map(([key, label]) => (
                  <Col xs={12} md={8} key={key}>
                    <Form.Item name={key} label={label}>
                      <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter="ج.م" />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </>
          )}

          {isProduct && canEditPoints && (
            <>
              <Divider orientation="right" style={{ margin: '4px 0 12px' }}>
                نقاط الولاء
              </Divider>
              <Form.Item name="point_value" label="قيمة نقاط المنتج"
                extra="قيمة كسرية مسموحة — مثال: 6 قطع = 1 نقطة ⇒ 0.167">
                <InputNumber min={0} step={0.001} style={{ width: 220 }} />
              </Form.Item>
            </>
          )}
        </Form>
      )}
    </Modal>
  );
}
