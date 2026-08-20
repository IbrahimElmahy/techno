import React from 'react';
import { Button, Checkbox, Dropdown, Space } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import {
  DEFAULT_PRINT_OPTIONS, PRINT_OPTION_LABELS, PrintOptions, savePrintOptions,
} from '../print/printOptions';

/**
 * مفاتيح الطباعة — the nine switches their فاتوره بيع carries across its header, deciding what
 * lands on the printed page.
 *
 * A dropdown rather than a row of checkboxes on the document: theirs has the room for a strip of
 * them, ours does not, and nine boxes competing with the fields somebody is actually filling in
 * would cost more attention than they are worth. They are set once for a printer and then left
 * alone — so they live one click away, with the count of what is off shown on the button so
 * «why is the logo missing?» has an answer in view.
 */
export default function PrintOptionsMenu({
  value, onChange,
}: {
  value: PrintOptions;
  onChange: (next: PrintOptions) => void;
}) {
  const set = (next: PrintOptions) => { savePrintOptions(next); onChange(next); };
  const offCount = PRINT_OPTION_LABELS.filter((o) => !value[o.key]).length;

  return (
    <Dropdown
      trigger={['click']}
      dropdownRender={() => (
        <div style={{
          background: '#fff', padding: 12, borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: '60vh', overflowY: 'auto',
        }}>
          <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 8 }}>
            اللي بيتطبع على الفاتورة
          </div>
          <Space direction="vertical">
            {PRINT_OPTION_LABELS.map((o) => (
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
              رجّع الكل
            </Button>
          </div>
        </div>
      )}
    >
      <Button icon={<PrinterOutlined />}>
        مفاتيح الطباعة{offCount ? ` (${offCount} مقفول)` : ''}
      </Button>
    </Dropdown>
  );
}
