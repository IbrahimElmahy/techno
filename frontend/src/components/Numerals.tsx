import { Checkbox, Segmented, Space, Tooltip } from 'antd';
import {
  NUMERALS_LABELS, type Numerals, ROUNDING_LABELS, ROUNDING_ORDER, type Rounding, setGrouping, setNumerals,
  setRounding, useGrouping, useNumerals, useRounding,
} from '../utils/numerals';

export function RoundingControl() {
  const rounding = useRounding();
  return (
    <Segmented
      size="small"
      value={rounding}
      onChange={(v) => setRounding(v as Rounding)}
      options={ROUNDING_ORDER.map((k) => ({
        value: k, label: ROUNDING_LABELS[k] }))}
      {...{ 'aria-label': 'تقريب المبالغ' }}
    />
  );
}

export default function NumeralsControl() {
  const numerals = useNumerals();
  const grouping = useGrouping();
  return (
    <Space size={6}>
      <Tooltip title="شكل الأرقام المعروضة">
        <Segmented
          size="small"
          value={numerals}
          onChange={(v) => setNumerals(v as Numerals)}
          options={[
            { value: 'arabic', label: NUMERALS_LABELS.arabic },
            { value: 'latin', label: NUMERALS_LABELS.latin },
          ]}
          {...{ 'aria-label': 'شكل الأرقام' }}
        />
      </Tooltip>
      <Tooltip title="فاصلة الآلاف في الأرقام (1,000,000.00)">
        <Checkbox checked={grouping} onChange={(e) => setGrouping(e.target.checked)}>1,000</Checkbox>
      </Tooltip>
    </Space>
  );
}
