import React, { useEffect, useMemo, useRef } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { Select } from 'antd';
import { TabModal } from './TabModal';

export interface WarehouseOption {
  id?: number | string;
  value?: number | string;
  name?: string;
  label?: string;
  active?: boolean;
  options?: WarehouseOption[];
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
  autoAdvanceIfSingle?: boolean;
}

export default function WarehouseGate({
  open,
  title = 'اختر المخزن',
  subtitle = '',
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
    const leaf = (w: WarehouseOption) => ({
      value: w.value !== undefined ? w.value : w.id,
      label: w.label !== undefined ? w.label : w.name,
    });
    const live = (w: WarehouseOption) => w.active !== false
      || (value != null && String(w.value !== undefined ? w.value : w.id) === String(value));
    return warehouses.filter((w) => w.options || live(w)).map((w) =>
      w.options
        ? { label: w.label !== undefined ? w.label : w.name, options: w.options.filter(live).map(leaf) }
        : leaf(w),
    );
  }, [warehouses, value]);

  const selectableOptions = useMemo(
    () =>
      normalizedOptions.flatMap((o: any) =>
        o.options ? o.options : [o],
      ) as { value?: number | string; label?: string }[],
    [normalizedOptions],
  );

  const optionsKey = selectableOptions.map((o) => String(o.value)).join('|');

  useEffect(() => {
    if (open && autoAdvanceIfSingle && selectableOptions.length === 1) {
      const singleVal = selectableOptions[0].value;
      if (singleVal !== undefined) {
        onChange(singleVal);
        onOk();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoAdvanceIfSingle, optionsKey]);

  if (!open || (autoAdvanceIfSingle && selectableOptions.length === 1)) {
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
          placeholder={placeholder}
          value={value ?? undefined}
          onChange={(v) => {
            selectedRef.current = v;
            onChange(v);
          }}
          options={normalizedOptions} filterOption={searchFilter} filterSort={searchRank}/>
        {subtitle && (
          <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 15 }}>
            {subtitle}
          </div>
        )}
      </div>
    </TabModal>
  );
}
