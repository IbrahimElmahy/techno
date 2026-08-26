import React from 'react';
import { DatePicker } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

export interface DateRangeFilterProps {
  value?: [Dayjs, Dayjs] | null;
  onChange?: (range: [Dayjs, Dayjs] | null) => void;
  style?: React.CSSProperties;
  className?: string;
  placeholder?: [string, string];
  allowClear?: boolean;
  size?: 'small' | 'middle' | 'large';
  showPresets?: boolean;
}

export const DATE_PRESETS: { label: string; value: [Dayjs, Dayjs] }[] = [
  { label: 'اليوم', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
  { label: 'أمس', value: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')] },
  { label: 'هذا الأسبوع', value: [dayjs().startOf('week'), dayjs().endOf('week')] },
  { label: 'هذا الشهر', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
  { label: 'الشهر السابق', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
  { label: 'آخر 30 يوم', value: [dayjs().subtract(30, 'days').startOf('day'), dayjs().endOf('day')] },
  { label: 'هذا العام', value: [dayjs().startOf('year'), dayjs().endOf('year')] },
];

export default function DateRangeFilter({
  value,
  onChange,
  style,
  className,
  placeholder = ['من تاريخ', 'إلى تاريخ'],
  allowClear = true,
  size = 'middle',
}: DateRangeFilterProps) {
  const startVal = value && value[0] ? value[0] : null;
  const endVal = value && value[1] ? value[1] : null;

  const handleStartChange = (date: Dayjs | null) => {
    if (!date && !endVal) {
      onChange?.(null);
    } else {
      onChange?.([date as Dayjs, endVal as Dayjs]);
    }
  };

  const handleEndChange = (date: Dayjs | null) => {
    if (!startVal && !date) {
      onChange?.(null);
    } else {
      onChange?.([startVal as Dayjs, date as Dayjs]);
    }
  };

  return (
    <div
      className={`techno-date-filter-group ${className || ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 120 }}>
        <DatePicker
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #d9d9d9',
            height: 38,
            backgroundColor: '#ffffff',
            fontWeight: 600,
          }}
          size={size}
          allowClear={allowClear}
          placeholder={placeholder[0]}
          suffixIcon={<CalendarOutlined style={{ color: '#6AB42D', fontSize: 15 }} />}
          value={startVal}
          onChange={handleStartChange}
          format="YYYY-MM-DD"
        />
      </div>
      <span style={{ color: '#555555', fontWeight: 'bold', fontSize: 13, flexShrink: 0 }}>إلى</span>
      <div style={{ flex: 1, minWidth: 120 }}>
        <DatePicker
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #d9d9d9',
            height: 38,
            backgroundColor: '#ffffff',
            fontWeight: 600,
          }}
          size={size}
          allowClear={allowClear}
          placeholder={placeholder[1]}
          suffixIcon={<CalendarOutlined style={{ color: '#6AB42D', fontSize: 15 }} />}
          value={endVal}
          onChange={handleEndChange}
          format="YYYY-MM-DD"
        />
      </div>
    </div>
  );
}
