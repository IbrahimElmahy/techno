import React, { useState } from 'react';
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
  /**
   * **الفترة الناقصة مابتطلعش برّه المكوّن.**
   *
   * كان بيبعت `[null, Dayjs]` أو `[Dayjs, null]` والنوع بيقول `[Dayjs, Dayjs]` —
   * `as Dayjs` بتكدب على المترجم. فكل شاشة بتستقبله اتكتبت وهي مصدّقة إن الطرفين
   * موجودين: `if (range) { range[0].format(...) }` — وأول ما اللي قدام الشاشة يمسح
   * طرف واحد ويسيب التاني، `.format` بترمي على `null` **وتفضّي الشاشة**.
   *
   * ده كان في **٥٢ موضع في ١٩ شاشة**. إصلاحهم واحد واحد معناه إن الشاشة الجاية
   * هتتكتب بنفس الافتراض وتقع من تاني — فالمنع هنا: المكوّن بيبعت فترة كاملة أو
   * `null`، ومابيبعتش نُص فترة أبداً.
   *
   * **والنص المكتوب بيفضل ظاهر.** اللي اختار «من» ولسه ما اختارش «إلى» بيشوف
   * اختياره في الخانة؛ اللي بيتغيّر إن الشاشة ماتفلترش لحد ما الطرفين يكملوا —
   * وده الصح: نُص فترة مش فترة.
   */
  const [half, setHalf] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const startVal = half ? half[0] : (value && value[0] ? value[0] : null);
  const endVal = half ? half[1] : (value && value[1] ? value[1] : null);

  /** بيبلّغ الأب بفترة كاملة أو `null`، وبيمسك الناقصة عنده لحد ما تكمل. */
  const settle = (start: Dayjs | null, end: Dayjs | null) => {
    if (start && end) {
      setHalf(null);
      onChange?.([start, end]);
      return;
    }
    setHalf(start || end ? [start, end] : null);
    // كانت فترة كاملة وبقت ناقصة ⇒ الفلتر يرفع إيده.
    if (value && value[0] && value[1]) onChange?.(null);
  };

  const handleStartChange = (date: Dayjs | null) => settle(date, endVal);
  const handleEndChange = (date: Dayjs | null) => settle(startVal, date);

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
