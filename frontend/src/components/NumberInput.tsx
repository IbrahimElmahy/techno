import React from 'react';
import { InputNumber as AntInputNumber } from 'antd';
import type { InputNumberProps } from 'antd';

const AR = '٠١٢٣٤٥٦٧٨٩';
const AR_DECIMAL = '٫';

export const toArabicDigits = (s: string): string => s
  .replace(/[0-9]/g, (d) => AR[Number(d)])
  .replace(/\./g, AR_DECIMAL);

export const toLatinDigits = (s: string): string => s
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(new RegExp(AR_DECIMAL, 'g'), '.')
  .replace(/٬/g, '');

export const InputNumber = React.forwardRef<HTMLInputElement, InputNumberProps<any>>(
  ({ formatter, parser, ...rest }, ref) => (
    <AntInputNumber
      {...rest}
      ref={ref as any}
      formatter={formatter ?? ((v) => toArabicDigits(String(v ?? '')))}
      parser={parser ?? ((v) => toLatinDigits(String(v ?? '')) as any)}
    />
  ),
);
InputNumber.displayName = 'InputNumber';

export default InputNumber;
