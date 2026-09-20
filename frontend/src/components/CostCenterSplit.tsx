import React, { useMemo, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { Button, Modal, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { InputNumber } from './NumberInput';
import { DeleteOutlined, PlusOutlined, PartitionOutlined } from '@ant-design/icons';
import { useCostCenters, costCenterLabel } from './CostCenterField';

/**
 * توزيع تحليلي — سطر واحد على أكتر من مركز تكلفة بنِسَب.
 *
 * إيجار المخزن بيخدم المعرض والمشروع مع بعض. اللي كان بيعرف يكتب ده كان بيكتب
 * سطرين بنص المبلغ، فالمستند بيبقى فيه سطور مالهاش وجود في الورقة اللي في إيده.
 *
 * الشرط الوحيد هنا هو نفس شرط السيرفر: المجموع **١٠٠٪ بالظبط**. الزرار بيفضل
 * مقفول لحد ما يتظبط، والفرق مكتوب قدام المستخدم بدل ما الحفظ يرفض ويقوله رقم.
 */

export type Split = Record<string, number>;

const sum = (rows: Row[]) => rows.reduce((t, r) => t + (Number(r.percent) || 0), 0);

interface Row { key: number; cost_center_id: number | null; percent: number | null; }

export function splitLabel(split?: Split | null): string | null {
  if (!split) return null;
  const n = Object.keys(split).length;
  return n ? `موزّع على ${n}` : null;
}

export default function CostCenterSplit({
  value, onChange, disabled, size = 'small',
}: {
  value?: Split | null;
  onChange?: (v: Split | null) => void;
  disabled?: boolean;
  size?: 'small' | 'middle';
}) {
  const centers = useCostCenters();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const openModal = () => {
    const entries = Object.entries(value || {});
    setRows(entries.length
      ? entries.map(([cc, pct], i) => ({ key: i, cost_center_id: Number(cc), percent: Number(pct) }))
      : [{ key: 0, cost_center_id: null, percent: null }]);
    setOpen(true);
  };

  const total = useMemo(() => sum(rows), [rows]);
  const ready = Math.abs(total - 100) < 0.0001
    && rows.every((r) => r.cost_center_id && Number(r.percent) > 0)
    && new Set(rows.map((r) => r.cost_center_id)).size === rows.length;

  const set = (key: number, field: keyof Row, v: any) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: v } : r)));

  const save = () => {
    if (!ready) return;
    const out: Split = {};
    rows.forEach((r) => { out[String(r.cost_center_id)] = Number(r.percent); });
    onChange?.(out);
    setOpen(false);
  };

  const clear = () => { onChange?.(null); setOpen(false); };

  // «اقسمها بالتساوي» — أكتر تقسيمة بتتكتب، وكتابتها بإيد على تلاتة بتدّي ٩٩٫٩٩.
  const even = () => {
    const n = rows.length;
    if (!n) return;
    const each = Math.floor((100 / n) * 100) / 100;
    setRows(rows.map((r, i) => ({
      ...r,
      percent: i === n - 1 ? Number((100 - each * (n - 1)).toFixed(2)) : each,
    })));
  };

  const label = splitLabel(value);

  return (
    <>
      <Tooltip title="توزيع السطر على أكتر من مركز تكلفة بنِسَب">
        <Button size={size} type={label ? 'primary' : 'default'} ghost={!!label}
                icon={<PartitionOutlined />} disabled={disabled} onClick={openModal}>
          {label || 'توزيع'}
        </Button>
      </Tooltip>
      <Modal
        open={open}
        title="توزيع على مراكز التكلفة"
        onCancel={() => setOpen(false)}
        width={560}
        destroyOnHidden
        footer={[
          <Button key="clear" danger onClick={clear}>إلغاء التوزيع</Button>,
          <Button key="even" onClick={even}>بالتساوي</Button>,
          <Button key="ok" type="primary" disabled={!ready} onClick={save}>حفظ</Button>,
        ]}
      >
        <Table<Row>
          rowKey="key" size="small" pagination={false} dataSource={rows}
          columns={[
            {
              title: 'المركز',
              key: 'cc',
              render: (_: unknown, r) => (
                <Select
                  showSearch optionFilterProp="label" style={{ width: '100%' }}
                  placeholder="اختر المركز"
                  value={r.cost_center_id ?? undefined}
                  onChange={(v) => set(r.key, 'cost_center_id', v)}
                  options={centers.map((c) => ({ value: c.id, label: costCenterLabel(c) }))} filterOption={searchFilter} filterSort={searchRank}/>
              ),
            },
            {
              title: 'النسبة %',
              key: 'pct',
              width: 130,
              render: (_: unknown, r) => (
                <InputNumber min={0} max={100} step={1} style={{ width: '100%' }}
                  value={r.percent ?? undefined}
                  onChange={(v) => set(r.key, 'percent', v as number)} />
              ),
            },
            {
              title: '',
              key: 'x',
              width: 50,
              render: (_: unknown, r) => (
                <Button type="text" danger icon={<DeleteOutlined />}
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))} />
              ),
            },
          ]}
          footer={() => (
            <Space>
              <Button size="small" type="dashed" icon={<PlusOutlined />}
                onClick={() => setRows([...rows,
                  { key: Math.max(0, ...rows.map((r) => r.key)) + 1, cost_center_id: null, percent: null }])}>
                مركز
              </Button>
              <Tag color={Math.abs(total - 100) < 0.0001 ? 'green' : 'red'}>
                المجموع {total.toFixed(2)}٪
              </Tag>
              {Math.abs(total - 100) >= 0.0001 && (
                <span style={{ color: '#888' }}>
                  فاضل {(100 - total).toFixed(2)}٪ — المجموع لازم يبقى ١٠٠٪ بالظبط.
                </span>
              )}
            </Space>
          )}
        />
      </Modal>
    </>
  );
}

export function useSplitGuard() {
  return (split: Split | null | undefined) => {
    if (!split) return true;
    const total = Object.values(split).reduce((t, v) => t + Number(v || 0), 0);
    if (Math.abs(total - 100) >= 0.0001) {
      message.error('مجموع نِسَب التوزيع لازم يساوي ١٠٠٪.');
      return false;
    }
    return true;
  };
}
