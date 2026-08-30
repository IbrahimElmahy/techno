import React, { useEffect, useMemo, useRef } from 'react';
import { Select } from 'antd';
import { TabModal } from './TabModal';

export interface WarehouseOption {
  id?: number | string;
  value?: number | string;
  name?: string;
  label?: string;
}

export interface WarehouseGateProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  value?: number | string | null;
  onChange: (value: any) => void;
  warehouses: WarehouseOption[];
  onOk: () => void;
  onCancel: () => void;
  okText?: string;
  cancelText?: string;
  placeholder?: string;
  /** Whether to automatically skip gate if only 1 warehouse is available (default: true) */
  autoAdvanceIfSingle?: boolean;
}

export default function WarehouseGate({
  open,
  title = 'اختر المخزن',
  subtitle = 'ده المخزن الافتراضي للسطور الجديدة. تقدر تغيّر مخزن أي سطر من عمود «المخزن».',
  value,
  onChange,
  warehouses,
  onOk,
  onCancel,
  okText = 'التالي',
  cancelText = 'رجوع',
  placeholder = 'اختر المخزن',
  autoAdvanceIfSingle = true,
}: WarehouseGateProps) {
  const selectedRef = useRef<number | string | null>(value ?? null);
  selectedRef.current = value ?? null;

  const normalizedOptions = useMemo(() => {
    return warehouses.map((w) => ({
      value: w.value !== undefined ? w.value : w.id,
      label: w.label !== undefined ? w.label : w.name,
    }));
  }, [warehouses]);

  /** بصمة الخيارات كنص — الاعتماد على المصفوفة نفسها بيعمل حلقة.
   *
   *  فيه نداء بيمرّر `locationOptions.filter(...)` (وجهة التحويل، اللي بتستبعد المصدر)،
   *  ودي مصفوفة جديدة كل رندر. الـ`useMemo` بيعيد الحساب معاها، فالـeffect يشوف
   *  اعتماد اتغيّر ويشتغل تاني — ولو الخيار واحد بينده `onChange` و`onOk` كل رندر،
   *  يعني رندر لا نهائي. البصمة بتتغيّر لما المحتوى يتغيّر فعلاً بس. */
  const optionsKey = normalizedOptions.map((o) => String(o.value)).join('|');

  // لو المستخدم عنده مخزن واحد بس متاح، ما نسألوش — نحطّه ونعدّي على طول
  useEffect(() => {
    if (open && autoAdvanceIfSingle && normalizedOptions.length === 1) {
      const singleVal = normalizedOptions[0].value;
      if (singleVal !== undefined) {
        onChange(singleVal);
        onOk();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoAdvanceIfSingle, optionsKey]);

  if (!open || (autoAdvanceIfSingle && normalizedOptions.length === 1)) {
    return null;
  }

  const isOkDisabled = value === null || value === undefined;

  return (
    <TabModal
      open={open}
      title={title}
      okText={okText}
      cancelText={cancelText}
      okButtonProps={{ disabled: isOkDisabled }}
      onCancel={onCancel}
      onOk={onOk}
      destroyOnHidden
    >
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
          if (selectedRef.current === null || selectedRef.current === undefined) return;
          e.preventDefault();
          onOk();
        }}
      >
        <Select
          autoFocus
          style={{ width: '100%' }}
          size="large"
          showSearch
          optionFilterProp="label"
          placeholder={placeholder}
          value={value ?? undefined}
          onChange={(v) => {
            selectedRef.current = v;
            onChange(v);
          }}
          options={normalizedOptions}
        />
        {subtitle && (
          <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
            {subtitle}
          </div>
        )}
      </div>
    </TabModal>
  );
}
