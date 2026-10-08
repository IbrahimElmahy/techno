import React from 'react';
import { Button, Checkbox, Dropdown, Space } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import {
  DEFAULT_PRINT_OPTIONS, PRINT_OPTION_LABELS, PrintOptions, savePrintOptions,
} from '../print/printOptions';

export default function PrintOptionsMenu({
  value, onChange, hideKeys,
}: {
  value: PrintOptions;
  onChange: (next: PrintOptions) => void;
  hideKeys?: (keyof PrintOptions)[];
}) {
  const set = (next: PrintOptions) => { savePrintOptions(next); onChange(next); };
  const shown = PRINT_OPTION_LABELS.filter((o) => !(hideKeys || []).includes(o.key));
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
            ما يُطبع على الفاتورة
          </div>
          <Space direction="vertical">
            {shown.map((o) => (
              <Checkbox
                key={o.key}
                checked={value[o.key]}
                onChange={(e) => set({ ...value, [o.key]: e.target.checked })}
              >
                {o.label}
              </Checkbox>
            ))}
          </Space>
          <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
            <Button size="small" type="link" onClick={() => set(DEFAULT_PRINT_OPTIONS)}>
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
