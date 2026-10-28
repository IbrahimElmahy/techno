import React from 'react';
import { Button, Checkbox, Dropdown, Space, message } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import {
  DEFAULT_PRINT_OPTIONS, PRINT_OPTION_LABELS, PrintOptions, savePrintOptions,
} from '../print/printOptions';

export default function PrintOptionsMenu<T extends object = PrintOptions>({
  value, onChange, hideKeys, labels, defaults, save, title,
}: {
  value: T;
  onChange: (next: T) => void;
  hideKeys?: (keyof T)[];
  labels?: { key: keyof T; label: string }[];
  defaults?: T;
  save?: (next: T) => Promise<void>;
  title?: string;
}) {
  const allLabels = (labels ?? PRINT_OPTION_LABELS) as { key: keyof T; label: string }[];
  const set = (next: T) => {
    onChange(next);
    (save ?? (savePrintOptions as unknown as (n: T) => Promise<void>))(next).catch((err: any) => {
      message.warning(err?.response?.status === 403
        ? 'التعديل اتطبق على جهازك بس — حفظه لكل الأجهزة لمدير النظام'
        : 'تعذر حفظ مفاتيح الطباعة على النظام');
    });
  };
  const shown = allLabels.filter((o) => !(hideKeys || []).includes(o.key));
  const offCount = shown.filter((o) => !value[o.key]).length;

  return (
    <Dropdown
      trigger={['click']}
      dropdownRender={() => (
        <div style={{
          background: '#fff', padding: 12, borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: '60vh', overflowY: 'auto',
        }}>
          <div style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 8 }}>
            {title ?? 'ما يُطبع على الفاتورة'}
          </div>
          <Space direction="vertical">
            {shown.map((o) => (
              <Checkbox
                key={String(o.key)}
                checked={Boolean(value[o.key])}
                onChange={(e) => set({ ...value, [o.key]: e.target.checked })}
              >
                {o.label}
              </Checkbox>
            ))}
          </Space>
          <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
            <Button size="small" type="link" onClick={() => set((defaults ?? DEFAULT_PRINT_OPTIONS) as T)}>
              استعادة الكل
            </Button>
          </div>
        </div>
      )}
    >
      <Button icon={<PrinterOutlined />}>
        مفاتيح الطباعة{offCount ? ` (${offCount} مغلق)` : ''}
      </Button>
    </Dropdown>
  );
}
