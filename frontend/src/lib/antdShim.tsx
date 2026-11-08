import React from 'react';
import { DatePicker as BaseDatePicker } from 'antd/es';

export * from 'antd/es';

const TYPED_DATE_FORMATS = [
  'DD/MM/YYYY', 'D/M/YYYY', 'DD-MM-YYYY', 'D-M-YYYY', 'DD.MM.YYYY', 'D.M.YYYY', 'D/M/YY',
];

function acceptTyped(props: any) {
  if (props.picker && props.picker !== 'date') return props.format;
  if (props.showTime) return props.format;
  const shown = props.format ?? 'YYYY-MM-DD';
  return shown === 'YYYY-MM-DD' ? [shown, ...TYPED_DATE_FORMATS] : shown;
}

const Picker = React.forwardRef<any, any>((props, ref) => (
  <BaseDatePicker ref={ref} {...props} format={acceptTyped(props)} />
));

const Range = React.forwardRef<any, any>((props, ref) => (
  <BaseDatePicker.RangePicker ref={ref} {...props} format={acceptTyped(props)} />
));

const statics = BaseDatePicker as any;

export const DatePicker = Object.assign(Picker, {
  RangePicker: Range,
  WeekPicker: statics.WeekPicker,
  MonthPicker: statics.MonthPicker,
  YearPicker: statics.YearPicker,
  QuarterPicker: statics.QuarterPicker,
  TimePicker: statics.TimePicker,
  _InternalPanelDoNotUseOrYouWillBeFired: statics._InternalPanelDoNotUseOrYouWillBeFired,
  _InternalRangePanelDoNotUseOrYouWillBeFired: statics._InternalRangePanelDoNotUseOrYouWillBeFired,
}) as unknown as typeof BaseDatePicker;
